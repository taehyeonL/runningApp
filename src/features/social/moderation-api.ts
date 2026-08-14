import { supabase } from '../../lib/supabase';

export const reportReasonOptions = [
  { key: 'sexual', label: '성희롱·성적 불쾌감' },
  { key: 'stalking', label: '스토킹·원치 않는 접촉' },
  { key: 'fraud', label: '사칭·사기' },
  { key: 'hate', label: '혐오·폭언' },
  { key: 'location_privacy', label: '위치·개인정보 노출' },
  { key: 'minor', label: '미성년자 의심' },
  { key: 'other', label: '기타' },
] as const;

export type ProfileReportReason = (typeof reportReasonOptions)[number]['key'];

export type ModerationNotice = {
  id: string;
  actionType: string;
  startsAt: string;
  endsAt: string | null;
  userNotice: string | null;
  createdAt: string;
};

type NoticeRow = {
  id: string;
  action_type: string;
  starts_at: string;
  ends_at: string | null;
  user_notice: string | null;
  created_at: string;
};

function requireClient() {
  if (!supabase) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  return supabase;
}

// 증거는 서버가 신고 시점 프로필에서 복사한다. 클라이언트는 대상과 사유만 넘긴다.
export async function reportProfile(
  reportedId: string,
  reason: ProfileReportReason,
  details: string | null,
) {
  const { data, error } = await requireClient().rpc('report_profile', {
    p_reported_id: reportedId,
    p_reason: reason,
    p_details: details && details.trim().length > 0 ? details.trim() : null,
  });
  if (error) throw error;
  return data as string;
}

export async function blockUser(userId: string, blockedId: string) {
  const { error } = await requireClient()
    .from('user_blocks')
    .insert({ blocker_id: userId, blocked_id: blockedId });
  if (error) throw error;
}

// 제재 안내에는 신고자나 내부 메모가 들어 있지 않다. 뷰가 그 컬럼을 아예
// 노출하지 않으므로 여기서 걸러낼 것도 없다.
export async function fetchModerationNotices(): Promise<ModerationNotice[]> {
  const { data, error } = await requireClient()
    .from('my_moderation_notices')
    .select('id,action_type,starts_at,ends_at,user_notice,created_at');
  if (error) throw error;
  return ((data ?? []) as NoticeRow[]).map((row) => ({
    id: row.id,
    actionType: row.action_type,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    userNotice: row.user_notice,
    createdAt: row.created_at,
  }));
}
