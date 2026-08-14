import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchChatThreads,
  fetchMessages,
  markMessagesRead,
  reportMessage,
  sendMessage,
  type ChatMessage,
  type ChatThread,
  type ReportReason,
} from '../features/chat/chat-api';
import { subscribeToChat } from '../features/chat/chat-realtime';
import { supabase } from '../lib/supabase';

export function useChat(userId?: string) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [openPartnerId, setOpenPartnerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshThreads = useCallback(async () => {
    if (!userId || !supabase) {
      setThreads([]);
      return;
    }
    setIsLoading(true);
    try {
      setThreads(await fetchChatThreads());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  // 열려 있는 대화를 구독 콜백에서 읽어야 하는데, openPartnerId를 의존성에
  // 넣으면 대화를 열 때마다 구독을 끊고 다시 맺게 된다. ref로 최신 값만 본다.
  const openPartnerRef = useRef<string | null>(null);
  openPartnerRef.current = openPartnerId;

  useEffect(() => {
    if (!userId || !supabase) return;

    return subscribeToChat(userId, {
      onIncoming: (message) => {
        const isOpenThread = openPartnerRef.current === message.senderId;
        if (isOpenThread) {
          // 이미 있는 메시지면 다시 넣지 않는다. 직접 보낸 뒤의 재조회와
          // 실시간 이벤트가 겹칠 수 있다.
          setMessages((current) => (
            current.some((item) => item.id === message.id)
              ? current
              : [...current, message]
          ));
          // 보고 있는 대화이므로 바로 읽음 처리한다. 실패해도 화면은 유지한다.
          void markMessagesRead(message.senderId).catch(() => 0);
        }
        // 목록의 미리보기와 안 읽음 배지는 서버 계산값을 그대로 따른다.
        void refreshThreads();
      },
      onReadReceipt: (message) => {
        setMessages((current) => current.map((item) => (
          item.id === message.id ? { ...item, readAt: message.readAt } : item
        )));
      },
    });
  }, [refreshThreads, userId]);

  // 대화를 열면 받은 메시지를 읽음으로 표시한다. 실패해도 대화는 보여줘야
  // 하므로 읽음 처리 오류로 화면을 막지는 않는다.
  const openThread = useCallback(async (partnerId: string) => {
    if (!userId) return;
    setOpenPartnerId(partnerId);
    setIsLoading(true);
    setError(null);
    setNotice(null);
    try {
      setMessages(await fetchMessages(userId, partnerId));
      await markMessagesRead(partnerId).catch(() => 0);
      await refreshThreads();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsLoading(false);
    }
  }, [refreshThreads, userId]);

  const closeThread = useCallback(() => {
    setOpenPartnerId(null);
    setMessages([]);
    setNotice(null);
  }, []);

  const send = useCallback(async (body: string) => {
    if (!userId || !openPartnerId) return;
    setIsSending(true);
    setError(null);
    try {
      await sendMessage(userId, openPartnerId, body);
      setMessages(await fetchMessages(userId, openPartnerId));
      await refreshThreads();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setIsSending(false);
    }
  }, [openPartnerId, refreshThreads, userId]);

  const report = useCallback(async (messageId: string, reason: ReportReason, details: string | null) => {
    setIsSending(true);
    setError(null);
    setNotice(null);
    try {
      await reportMessage(messageId, reason, details);
      setNotice('신고를 접수했어요. 운영팀이 메시지 원문을 근거로 확인합니다.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      throw failure;
    } finally {
      setIsSending(false);
    }
  }, []);

  const openThreadSummary = threads.find((thread) => thread.partnerId === openPartnerId) ?? null;
  const totalUnread = threads.reduce((total, thread) => total + thread.unreadCount, 0);

  return {
    threads,
    messages,
    openPartnerId,
    openThreadSummary,
    totalUnread,
    isLoading,
    isSending,
    error,
    notice,
    refreshThreads,
    openThread,
    closeThread,
    send,
    report,
  };
}

export type ChatController = ReturnType<typeof useChat>;
