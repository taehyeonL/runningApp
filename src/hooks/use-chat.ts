import { useCallback, useEffect, useState } from 'react';

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
