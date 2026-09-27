import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

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
import { errorMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';

export function useChat(userId?: string) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [openPartnerId, setOpenPartnerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const identity = useRef(userId);
  identity.current = userId;
  const generation = useRef(0);
  const threadRequest = useRef(0);
  const openPartnerRef = useRef<string | null>(null);

  useEffect(() => {
    generation.current++;
    openPartnerRef.current = null;
    setOpenPartnerId(null); setMessages([]); setThreads([]);
    setHasOlder(false); setIsSending(false); setIsLoadingOlder(false);
    setError(null); setNotice(null);
    return () => { generation.current++; threadRequest.current++; };
  }, [userId]);

  const refreshThreads = useCallback(async () => {
    if (!userId || !supabase) {
      setThreads([]);
      return;
    }
    const request = ++threadRequest.current;
    try {
      const result = await fetchChatThreads();
      if (identity.current !== userId || request !== threadRequest.current) return;
      setThreads(result);
      if (openPartnerRef.current && !result.some(t => t.partnerId === openPartnerRef.current)) {
        generation.current++;
        openPartnerRef.current = null;
        setOpenPartnerId(null); setMessages([]); setHasOlder(false);
        setIsLoading(false); setIsLoadingOlder(false); setIsSending(false);
      }
      setError(null);
    } catch (reason) {
      if (identity.current !== userId || request !== threadRequest.current) return;
      setThreads([]); setMessages([]); setError(errorMessage(reason));
    }
  }, [userId]);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  // 상대의 차단/제재는 메시지 INSERT 이벤트를 만들지 않는다. 열린 대화도
  // 포그라운드 복귀와 주기적 서버 확인으로 오래된 접근 상태를 버린다.
  useEffect(() => {
    if (!userId || !openPartnerId) return;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshThreads();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refreshThreads();
    }, 15_000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [userId, openPartnerId, refreshThreads]);

  // 열려 있는 대화를 구독 콜백에서 읽어야 하는데, openPartnerId를 의존성에
  // 넣으면 대화를 열 때마다 구독을 끊고 다시 맺게 된다. ref로 최신 값만 본다.

  useEffect(() => {
    if (!userId || !supabase) return;

    return subscribeToChat(userId, {
      onIncoming: (message) => {
        if (identity.current !== userId) return;
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
        if (identity.current !== userId) return;
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
    const ticket = ++generation.current;
    openPartnerRef.current = partnerId;
    setOpenPartnerId(partnerId);
    setMessages([]); setHasOlder(false); setIsLoadingOlder(false); setIsSending(false);
    setIsLoading(true);
    setError(null);
    setNotice(null);
    try {
      const page = await fetchMessages(userId, partnerId);
      if (ticket !== generation.current || identity.current !== userId) return;
      setMessages(page.messages);
      setHasOlder(page.hasMore);
      await markMessagesRead(partnerId).catch(() => 0);
      await refreshThreads();
    } catch (reason) {
      if (ticket === generation.current) setError(errorMessage(reason));
    } finally {
      if (ticket === generation.current) setIsLoading(false);
    }
  }, [refreshThreads, userId]);

  // 위로 스크롤해 과거를 더 불러온다. 가장 오래된 메시지 시각을 커서로 쓰므로
  // 그 사이에 새 메시지가 도착해도 페이지가 어긋나지 않는다.
  const loadOlder = useCallback(async () => {
    if (!userId || !openPartnerId || isLoadingOlder || !hasOlder) return;
    const oldest = messages[0];
    if (!oldest) return;
    const ticket = generation.current;
    setIsLoadingOlder(true);
    try {
      const page = await fetchMessages(userId, openPartnerId, { before: oldest.createdAt });
      if (ticket !== generation.current || identity.current !== userId) return;
      setMessages((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...page.messages.filter((item) => !known.has(item.id)), ...current];
      });
      setHasOlder(page.hasMore);
    } catch (reason) {
      if (ticket === generation.current) setError(errorMessage(reason));
    } finally {
      if (ticket === generation.current) setIsLoadingOlder(false);
    }
  }, [hasOlder, isLoadingOlder, messages, openPartnerId, userId]);

  const closeThread = useCallback(() => {
    generation.current++;
    openPartnerRef.current = null;
    setIsLoading(false); setIsSending(false); setIsLoadingOlder(false); setError(null);
    setOpenPartnerId(null);
    setMessages([]);
    setHasOlder(false);
    setNotice(null);
  }, []);

  const send = useCallback(async (body: string) => {
    if (!userId || !openPartnerId) return;
    const ticket = generation.current;
    setIsSending(true);
    setError(null);
    try {
      await sendMessage(userId, openPartnerId, body);
      // 최신 페이지만 다시 읽고 병합한다. 통째로 갈아끼우면 위로 스크롤해
      // 불러온 과거 메시지가 사라진다.
      const page = await fetchMessages(userId, openPartnerId);
      if (ticket !== generation.current || identity.current !== userId) return;
      setMessages((current) => {
        const known = new Set(current.map((item) => item.id));
        const merged = [...current, ...page.messages.filter((item) => !known.has(item.id))];
        return merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      });
      await refreshThreads();
    } catch (reason) {
      if (ticket === generation.current) setError(errorMessage(reason));
      throw reason;
    } finally {
      if (ticket === generation.current) setIsSending(false);
    }
  }, [openPartnerId, refreshThreads, userId]);

  const report = useCallback(async (messageId: string, reason: ReportReason, details: string | null) => {
    const ticket = generation.current;
    setIsSending(true);
    setError(null);
    setNotice(null);
    try {
      await reportMessage(messageId, reason, details);
      if (ticket === generation.current) setNotice('신고를 접수했어요. 운영팀이 메시지 원문을 근거로 확인합니다.');
      await refreshThreads();
    } catch (failure) {
      if (ticket === generation.current) setError(errorMessage(failure));
      throw failure;
    } finally {
      if (ticket === generation.current) setIsSending(false);
    }
  }, [refreshThreads]);

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
    isLoadingOlder,
    hasOlder,
    error,
    notice,
    refreshThreads,
    openThread,
    closeThread,
    loadOlder,
    send,
    report,
  };
}

export type ChatController = ReturnType<typeof useChat>;
