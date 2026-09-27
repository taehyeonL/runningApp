import { supabase } from '../../lib/supabase';
import type {
  ConnectionRequestSummary,
  DiscoveryCandidate,
  RequestTemplateKey,
  SocialProfile,
  SocialSnapshot,
} from './social-types';

type CandidateRow = {
  id: string;
  candidate_profile_id: string;
  similarity_label: DiscoveryCandidate['similarityLabel'];
  reasons: unknown;
  repeat_encounters_30d: number;
  request_eligible: boolean;
  safe_overlap_summary: string | null;
  generated_at: string;
  expires_at: string;
};

type ProfileRow = {
  id: string;
  nickname: string;
  age_band: string | null;
  relationship_intents: unknown;
  running_style_tags: unknown;
  pace_min_seconds: number | null;
  pace_max_seconds: number | null;
  monthly_distance_km: number | string | null;
  completed_run_count: number | null;
  availability_slots: unknown;
  primary_achievement: string | null;
  achievement_codes: unknown;
};

type RequestRow = {
  id: string;
  requester_id: string;
  recipient_id: string;
  candidate_id: string | null;
  template_key: ConnectionRequestSummary['templateKey'];
  message: string | null;
  status: ConnectionRequestSummary['status'];
  created_at: string;
  responded_at: string | null;
  expires_at: string;
};

type SafetyCheckinRow = { id: string; request_id: string; status: 'prepared' | 'completed' };

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function profileFromRow(row: ProfileRow): SocialProfile {
  return {
    id: row.id,
    nickname: row.nickname,
    ageBand: row.age_band,
    relationshipIntents: strings(row.relationship_intents),
    runningStyleTags: strings(row.running_style_tags),
    paceMinSeconds: row.pace_min_seconds,
    paceMaxSeconds: row.pace_max_seconds,
    monthlyDistanceKm: Number(row.monthly_distance_km ?? 0),
    completedRunCount: row.completed_run_count ?? 0,
    availabilitySlots: strings(row.availability_slots),
    primaryAchievement: row.primary_achievement ?? 'beginner',
    achievementCodes: strings(row.achievement_codes),
  };
}

function requireClient() {
  if (!supabase) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  return supabase;
}

export async function fetchSocialSnapshot(userId: string): Promise<SocialSnapshot> {
  const client = requireClient();
  const [candidateResult, requestResult, checkinResult] = await Promise.all([
    client
      .from('encounter_candidates')
      .select('id,candidate_profile_id,similarity_label,reasons,repeat_encounters_30d,request_eligible,safe_overlap_summary,generated_at,expires_at')
      .gt('expires_at', new Date().toISOString())
      .order('generated_at', { ascending: false }),
    client
      .from('connection_request_summaries')
      .select('id,requester_id,recipient_id,candidate_id,template_key,message,status,created_at,responded_at,expires_at,status_changed_at')
      .order('status_changed_at', { ascending: false })
      .limit(50),
    client.from('my_run_safety_checkins').select('id,request_id,status').order('created_at', { ascending: false }),
  ]);
  if (candidateResult.error) throw candidateResult.error;
  if (requestResult.error) throw requestResult.error;
  if (checkinResult.error) throw checkinResult.error;

  const candidateRows = (candidateResult.data ?? []) as CandidateRow[];
  const requestRows = (requestResult.data ?? []) as RequestRow[];
  const checkins = new Map(((checkinResult.data ?? []) as SafetyCheckinRow[]).map((item) => [item.request_id, item]));
  const profileIds = new Set(candidateRows.map((row) => row.candidate_profile_id));
  requestRows.forEach((row) => profileIds.add(row.requester_id === userId ? row.recipient_id : row.requester_id));

  const profiles = new Map<string, SocialProfile>();
  if (profileIds.size > 0) {
    const profileResult = await client
      .from('social_profiles')
      .select('id,nickname,age_band,relationship_intents,running_style_tags,pace_min_seconds,pace_max_seconds,monthly_distance_km,completed_run_count,availability_slots,primary_achievement,achievement_codes')
      .in('id', [...profileIds]);
    if (profileResult.error) throw profileResult.error;
    ((profileResult.data ?? []) as ProfileRow[]).forEach((row) => profiles.set(row.id, profileFromRow(row)));
    const details = await client.from('social_runner_details').select('id,bio,conversation_preference,preferred_distance').in('id', [...profileIds]);
    // Staged rollout: an older server can still provide its existing safe cards.
    // Permission/network errors are never treated as successful detail reads.
    if (details.error && !['PGRST205', '42P01'].includes(details.error.code)) throw details.error;
    for (const row of details.data ?? []) {
      const profile = profiles.get(row.id);
      if (profile) Object.assign(profile, { bio: row.bio, conversationPreference: row.conversation_preference, preferredDistance: row.preferred_distance });
    }
  }

  const candidates = candidateRows.flatMap((row) => {
    const profile = profiles.get(row.candidate_profile_id);
    if (!profile) return [];
    return [{
      id: row.id,
      profile,
      similarityLabel: row.similarity_label,
      reasons: strings(row.reasons),
      repeatEncounters30d: row.repeat_encounters_30d,
      requestEligible: row.request_eligible,
      safeOverlapSummary: row.safe_overlap_summary,
      generatedAt: row.generated_at,
      expiresAt: row.expires_at,
    }];
  });
  const requests = requestRows.map((row) => {
    const counterpartId = row.requester_id === userId ? row.recipient_id : row.requester_id;
    return {
      id: row.id,
      requesterId: row.requester_id,
      recipientId: row.recipient_id,
      candidateId: row.candidate_id,
      templateKey: row.template_key,
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      respondedAt: row.responded_at,
      expiresAt: row.expires_at,
      counterpart: profiles.get(counterpartId) ?? null,
      safetyCheckin: checkins.get(row.id) ?? null,
    };
  });
  return { candidates, requests };
}

export async function prepareRunSafetyCheckin(requestId: string) {
  const { data, error } = await requireClient().rpc('prepare_run_safety_checkin', { p_request_id: requestId });
  if (error) throw error;
  return data as string;
}

export async function completeRunSafetyCheckin(checkinId: string) {
  const { data, error } = await requireClient().rpc('complete_run_safety_checkin', { p_checkin_id: checkinId });
  if (error) throw error;
  if (data !== true) throw new Error('이미 완료했거나 내 안전 체크인이 아닙니다.');
}

export async function sendConnectionRequest(candidate: DiscoveryCandidate, templateKey: RequestTemplateKey) {
  const { data, error } = await requireClient().rpc('send_connection_request', {
    p_target_user_id: candidate.profile.id,
    p_candidate_id: candidate.id,
    p_template_key: templateKey,
    p_message: null,
  });
  if (error) throw error;
  return data as string;
}

export async function transitionConnectionRequest(
  requestId: string,
  action: 'accept' | 'decline' | 'cancel',
) {
  const functionName = action === 'accept'
    ? 'accept_connection_request'
    : action === 'decline'
      ? 'decline_connection_request'
      : 'cancel_connection_request';
  const { data, error } = await requireClient().rpc(functionName, { request_id: requestId });
  if (error) throw error;
  if (data !== true) throw new Error('요청 상태가 이미 변경되었거나 처리 권한이 없습니다.');
}
