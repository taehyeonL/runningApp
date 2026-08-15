import { requireUuid } from '../../lib/ids';
import { supabase } from '../../lib/supabase';

export type ChatThread = {
  partnerId: string;
  partnerNickname: string;
  lastMessageBody: string | null;
  lastMessageAt: string | null;
  lastMessageMine: boolean;
  unreadCount: number;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

export const reportReasons = [
  { key: 'sexual', label: '성적인 메시지' },
  { key: 'stalking', label: '스토킹·집착' },
  { key: 'hate', label: '혐오·모욕' },
  { key: 'location_privacy', label: '위치 캐묻기' },
  { key: 'fraud', label: '사기·광고' },
  { key: 'minor', label: '미성년자로 의심' },
  { key: 'other', label: '기타' },
] as const;

export type ReportReason = (typeof reportReasons)[number]['key'];

type ThreadRow = {
  partner_id: string;
  partner_nickname: string;
  last_message_body: string | null;
  last_message_at: string | null;
  last_message_mine: boolean | null;
  unread_count: number | null;
};

type MessageRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

function requireClient() {
  if (!supabase) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  return supabase;
}

export async function fetchChatThreads(): Promise<ChatThread[]> {
  const { data, error } = await requireClient().rpc('list_chat_threads');
  if (error) throw error;
  return ((data ?? []) as ThreadRow[]).map((row) => ({
    partnerId: row.partner_id,
    partnerNickname: row.partner_nickname,
    lastMessageBody: row.last_message_body,
    lastMessageAt: row.last_message_at,
    lastMessageMine: row.last_message_mine ?? false,
    unreadCount: row.unread_count ?? 0,
  }));
}

// 대화는 상호 수락된 상대에게만 열린다. 서버 정책이 그것을 강제하므로
export const MESSAGE_PAGE_SIZE = 40;

// 여기서는 양방향 조건만 걸고 접근 판단은 하지 않는다.
//
// 정렬은 항상 최신순으로 가져온 뒤 뒤집는다. 오름차순 + limit으로 가져오면
// 가장 "오래된" N건이 잡혀서, 대화가 길어질수록 사용자는 옛날 메시지만 보고
// 정작 최근 대화를 못 본다.
export async function fetchMessages(
  userId: string,
  partnerId: string,
  options: { before?: string; limit?: number } = {},
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const limit = options.limit ?? MESSAGE_PAGE_SIZE;
  // 두 사람 사이의 대화는 "보낸 사람과 받는 사람이 모두 이 둘"과 같다.
  // messages에 sender_id <> recipient_id 제약이 있어 (나→상대), (상대→나)
  // 두 조합만 남는다. or() 문자열을 직접 조립하지 않아도 되므로, 값이 필터
  // 문법으로 해석될 여지 자체가 없어진다.
  const pair = [
    requireUuid(userId, '내 계정'),
    requireUuid(partnerId, '상대 계정'),
  ];
  let query = requireClient()
    .from('messages')
    .select('id,sender_id,recipient_id,body,created_at,read_at')
    .in('sender_id', pair)
    .in('recipient_id', pair)
    .order('created_at', { ascending: false })
    // 한 건 더 받아 다음 페이지가 있는지 판단한다.
    .limit(limit + 1);
  if (options.before) query = query.lt('created_at', options.before);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as MessageRow[];
  const hasMore = rows.length > limit;
  return {
    hasMore,
    messages: rows.slice(0, limit).reverse().map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      recipientId: row.recipient_id,
      body: row.body,
      createdAt: row.created_at,
      readAt: row.read_at,
    })),
  };
}

export async function sendMessage(userId: string, partnerId: string, body: string) {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new Error('보낼 내용을 입력해 주세요.');
  if (trimmed.length > 2000) throw new Error('메시지는 2000자까지 보낼 수 있어요.');

  const { error } = await requireClient()
    .from('messages')
    .insert({ sender_id: userId, recipient_id: partnerId, body: trimmed });
  if (error) throw error;
}

export async function markMessagesRead(partnerId: string) {
  const { data, error } = await requireClient().rpc('mark_messages_read', {
    p_partner_id: partnerId,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

// 증거는 클라이언트가 아니라 서버가 원문에서 복사한다. 여기서 본문을 함께
// 올리면 조작된 증거를 만들 수 있으므로 메시지 id만 넘긴다.
export async function reportMessage(messageId: string, reason: ReportReason, details: string | null) {
  const { data, error } = await requireClient().rpc('report_message', {
    p_message_id: messageId,
    p_reason: reason,
    p_details: details && details.trim().length > 0 ? details.trim() : null,
  });
  if (error) throw error;
  return data as string;
}
