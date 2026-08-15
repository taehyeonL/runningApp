import type { RealtimeChannel } from '@supabase/supabase-js';

import { requireUuid } from '../../lib/ids';
import { supabase } from '../../lib/supabase';
import type { ChatMessage } from './chat-api';

type MessageRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

/**
 * 로그인한 사용자의 대화 변화를 구독한다.
 *
 * 서버는 구독자의 JWT로 messages의 RLS를 그대로 평가하므로, 여기서 오는 행은
 * 이미 "볼 수 있는 메시지"만이다. 그래도 필터를 거는 이유는 트래픽을 줄이기
 * 위해서지 접근을 막기 위해서가 아니다.
 */
export function subscribeToChat(userId: string, handlers: {
  onIncoming: (message: ChatMessage) => void;
  onReadReceipt: (message: ChatMessage) => void;
}): () => void {
  const client = supabase;
  if (!client) return () => undefined;

  // Realtime 필터는 문자열로만 받을 수 있어 값을 넣기 전에 형식을 확인한다.
  requireUuid(userId, '내 계정');

  const channel: RealtimeChannel = client
    .channel(`chat:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `recipient_id=eq.${userId}`,
      },
      (payload) => handlers.onIncoming(toMessage(payload.new as MessageRow)),
    )
    .on(
      'postgres_changes',
      {
        // 내가 보낸 메시지를 상대가 읽으면 읽음 표시를 갱신한다.
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `sender_id=eq.${userId}`,
      },
      (payload) => handlers.onReadReceipt(toMessage(payload.new as MessageRow)),
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
