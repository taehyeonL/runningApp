import { useCallback, useEffect, useState } from 'react';

import {
  fetchSocialSnapshot,
  sendConnectionRequest,
  transitionConnectionRequest,
} from '../features/social/social-api';
import type {
  ConnectionRequestSummary,
  DiscoveryCandidate,
  RequestTemplateKey,
} from '../features/social/social-types';
import { errorMessage } from '../lib/errors';

function socialErrorMessage(reason: unknown) {
  const message = errorMessage(reason);
  if (message.includes('Request is not eligible')) return '아직 같이 뛰기 요청 조건을 충족하지 않았어요.';
  if (message.includes('Daily request limit reached')) return '오늘 보낼 수 있는 요청 수를 모두 사용했어요.';
  if (message.includes('Request cooldown is active') || message.includes('duplicate key')) return '최근 요청한 러너에게는 7일 뒤 다시 요청할 수 있어요.';
  if (message.includes('Candidate does not match')) return '발견 후보가 만료되었어요. 발견 화면을 새로고침해 주세요.';
  return message;
}

export function useSocial(userId?: string) {
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [requests, setRequests] = useState<ConnectionRequestSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionRequestId, setActionRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setCandidates([]);
      setRequests([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const snapshot = await fetchSocialSnapshot(userId);
      setCandidates(snapshot.candidates);
      setRequests(snapshot.requests);
    } catch (reason) {
      setError(socialErrorMessage(reason));
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const send = useCallback(async (candidate: DiscoveryCandidate, template: RequestTemplateKey) => {
    setActionRequestId(candidate.id);
    setError(null);
    try {
      const requestId = await sendConnectionRequest(candidate, template);
      await refresh();
      return requestId;
    } catch (reason) {
      setError(socialErrorMessage(reason));
      throw reason;
    } finally {
      setActionRequestId(null);
    }
  }, [refresh]);

  const transition = useCallback(async (
    requestId: string,
    action: 'accept' | 'decline' | 'cancel',
  ) => {
    setActionRequestId(requestId);
    setError(null);
    try {
      await transitionConnectionRequest(requestId, action);
      await refresh();
    } catch (reason) {
      setError(socialErrorMessage(reason));
      throw reason;
    } finally {
      setActionRequestId(null);
    }
  }, [refresh]);

  return {
    candidates,
    requests,
    isLoading,
    actionRequestId,
    error,
    refresh,
    send,
    accept: (requestId: string) => transition(requestId, 'accept'),
    decline: (requestId: string) => transition(requestId, 'decline'),
    cancel: (requestId: string) => transition(requestId, 'cancel'),
  };
}

export type SocialController = ReturnType<typeof useSocial>;
