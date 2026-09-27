import { POLICY_VERSION } from '../../lib/policy';
import { supabase } from '../../lib/supabase';
import type { RunListItem } from '../running/run-types';

export type LogVisibility = RunListItem['visibility'];

export type PrivacyStatus = {
  nickname: string;
  nicknameChangeAvailableAt: string | null;
  discoveryEnabled: boolean;
  profileVisibility: LogVisibility;
  logDefaultVisibility: LogVisibility;
  ageVerificationComplete: boolean;
  locationConsentGranted: boolean;
  marketingConsentGranted: boolean;
  deletionRequestedAt: string | null;
  deletionPurgeAfter: string | null;
  trainingGoal: string;
  usualPaceSeconds: number | null;
  availabilitySlots: string[];
  primaryAchievement: string;
  achievementCodes: string[];
};

type PrivacyStatusRow = {
  nickname: string;
  nickname_change_available_at: string | null;
  discovery_enabled: boolean;
  profile_visibility: LogVisibility;
  log_default_visibility: LogVisibility;
  age_verification_complete: boolean;
  location_consent_granted: boolean;
  marketing_consent_granted: boolean;
  deletion_requested_at: string | null;
  deletion_purge_after: string | null;
  training_goal: string;
  usual_pace_seconds: number | null;
  availability_slots: unknown;
  primary_achievement: string | null;
  achievement_codes: unknown;
};

function requireClient() {
  if (!supabase) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  return supabase;
}

export async function fetchPrivacyStatus(): Promise<PrivacyStatus | null> {
  const { data, error } = await requireClient()
    .from('my_privacy_status')
    .select('nickname,nickname_change_available_at,discovery_enabled,profile_visibility,log_default_visibility,training_goal,usual_pace_seconds,availability_slots,primary_achievement,achievement_codes,age_verification_complete,location_consent_granted,marketing_consent_granted,deletion_requested_at,deletion_purge_after')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as PrivacyStatusRow;
  return {
    nickname: row.nickname,
    nicknameChangeAvailableAt: row.nickname_change_available_at,
    discoveryEnabled: row.discovery_enabled,
    profileVisibility: row.profile_visibility,
    logDefaultVisibility: row.log_default_visibility,
    ageVerificationComplete: row.age_verification_complete,
    locationConsentGranted: row.location_consent_granted,
    marketingConsentGranted: row.marketing_consent_granted,
    deletionRequestedAt: row.deletion_requested_at,
    deletionPurgeAfter: row.deletion_purge_after,
    trainingGoal: row.training_goal,
    usualPaceSeconds: row.usual_pace_seconds,
    availabilitySlots: Array.isArray(row.availability_slots) ? row.availability_slots.filter((value): value is string => typeof value === 'string') : [],
    primaryAchievement: row.primary_achievement ?? 'beginner',
    achievementCodes: Array.isArray(row.achievement_codes) ? row.achievement_codes.filter((value): value is string => typeof value === 'string') : [],
  };
}

export async function setNickname(nickname: string) {
  const { data, error } = await requireClient().rpc('set_nickname', { p_nickname: nickname });
  if (error) throw error;
  return data as string;
}

export async function setRunVisibility(sessionId: string, visibility: LogVisibility) {
  const { data, error } = await requireClient().rpc('set_running_session_visibility', {
    p_session_id: sessionId,
    p_visibility: visibility,
  });
  if (error) throw error;
  if (data !== true) throw new Error('기록을 찾지 못했거나 아직 검증 중이라 공개 범위를 바꿀 수 없어요.');
}

export async function deleteRun(sessionId: string) {
  const { data, error } = await requireClient().rpc('delete_running_session', {
    p_session_id: sessionId,
  });
  if (error) throw error;
  if (data !== true) throw new Error('이미 삭제되었거나 내 기록이 아닙니다.');
}

export async function setProfilePrivacy(input: {
  discoveryEnabled: boolean;
  profileVisibility: LogVisibility;
  logDefaultVisibility: LogVisibility;
}) {
  const { data, error } = await requireClient().rpc('set_profile_privacy', {
    p_discovery_enabled: input.discoveryEnabled,
    p_profile_visibility: input.profileVisibility,
    p_log_default_visibility: input.logDefaultVisibility,
  });
  if (error) throw error;
  if (data !== true) throw new Error('프로필을 찾지 못해 공개 설정을 저장하지 못했습니다.');
}

// 러닝 기록(거리·시간·페이스)은 사용자의 자산이므로 남고, 원본 GPS만 파기된다.
export async function withdrawLocationConsent() {
  const { data, error } = await requireClient().rpc('withdraw_location_consent', {
    p_policy_version: POLICY_VERSION,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

export async function requestAccountDeletion(reason: string | null) {
  const { data, error } = await requireClient().rpc('request_account_deletion', {
    p_reason: reason,
    p_grace_days: 30,
  });
  if (error) throw error;
  return data as string;
}

export async function cancelAccountDeletion() {
  const { data, error } = await requireClient().rpc('cancel_account_deletion');
  if (error) throw error;
  if (data !== true) throw new Error('되돌릴 수 있는 삭제 신청이 없습니다.');
}
