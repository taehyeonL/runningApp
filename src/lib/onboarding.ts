import type { Session } from '@supabase/supabase-js';

import { POLICY_VERSION } from './policy';
import { supabase } from './supabase';

export type OnboardingInput = {
  intent: '친구' | '러닝 메이트' | '연애 가능' | '상관없음';
  runningStyle: string;
  visibility: '비공개' | '친구 공개' | '프로필 공개' | '매칭 공개';
};

const visibilityValues = {
  비공개: 'private',
  '친구 공개': 'friends',
  '프로필 공개': 'profile',
  '매칭 공개': 'matching',
} as const;
const intentValues = {
  친구: 'friends',
  '러닝 메이트': 'running_mate',
  '연애 가능': 'dating_open',
  상관없음: 'no_preference',
} as const;
const styleValues: Record<string, string> = {
  '기록보다 꾸준함': 'consistency_first',
  '대화 없이 러닝 집중': 'quiet_focus',
  '주말 러닝 메이트': 'weekend_runner',
  '초보 환영': 'beginner_friendly',
};

function nicknameFromSession(session: Session) {
  const metadata = session.user.user_metadata ?? {};
  const candidate = [metadata.preferred_username, metadata.name, metadata.full_name]
    .find((value) => typeof value === 'string' && value.trim().length >= 2) as string | undefined;
  const emailName = session.user.email?.split('@')[0];
  const cleaned = (candidate ?? emailName ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return cleaned.length >= 2 ? cleaned : `러너${session.user.id.slice(0, 6)}`;
}

export async function saveOnboarding(session: Session, input: OnboardingInput) {
  if (!supabase) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');

  const profile = {
    nickname: nicknameFromSession(session),
    relationship_intents: [intentValues[input.intent]],
    running_style_tags: [styleValues[input.runningStyle] ?? 'consistency_first'],
    profile_visibility: visibilityValues[input.visibility],
    log_default_visibility: 'private',
    discovery_enabled: input.visibility !== '비공개',
  };
  const existing = await supabase
    .from('profiles')
    .select('id')
    .eq('id', session.user.id)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const saved = existing.data
    ? await supabase.from('profiles').update(profile).eq('id', session.user.id)
    : await supabase.from('profiles').insert({ id: session.user.id, ...profile });
  if (saved.error) throw saved.error;

  // These are product consent records. OS location permission is requested
  // separately at the moment a run begins.
  for (const consentType of ['adult_confirmation', 'terms', 'privacy', 'location']) {
    const { error } = await supabase.rpc('record_consent', {
      consent_type: consentType,
      policy_version: POLICY_VERSION,
      granted: true,
    });
    if (error) throw error;
  }
}

export async function hasCompletedOnboarding(userId: string) {
  if (!supabase) return false;
  const client = supabase;
  const [profile, ...consents] = await Promise.all([
    client.from('profiles').select('id').eq('id', userId).maybeSingle(),
    ...['adult_confirmation', 'terms', 'privacy', 'location'].map((consentType) =>
      client.rpc('has_current_consent', { required_consent_type: consentType }),
    ),
  ]);
  if (profile.error) throw profile.error;
  for (const consent of consents) {
    if (consent.error) throw consent.error;
  }
  return Boolean(profile.data) && consents.every((consent) => consent.data === true);
}
