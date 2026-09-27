import { useCallback, useEffect, useState } from 'react';

import {
  cancelAccountDeletion,
  fetchPrivacyStatus,
  requestAccountDeletion,
  setNickname,
  setProfilePrivacy,
  withdrawLocationConsent,
  type LogVisibility,
  type PrivacyStatus,
} from '../features/account/account-api';
import { errorMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';

export function usePrivacy(userId?: string) {
  const [status, setStatus] = useState<PrivacyStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId || !supabase) {
      setStatus(null);
      return;
    }
    setIsLoading(true);
    try {
      setStatus(await fetchPrivacyStatus());
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 모든 변경은 서버 상태를 다시 읽어 반영한다. 낙관적 갱신을 하지 않는 이유는
  // 공개 범위·동의 상태가 화면과 어긋나면 사용자가 실제보다 더 공개되어 있다고
  // 오해할 수 있기 때문이다.
  const run = useCallback(async (action: () => Promise<string>) => {
    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
      throw reason;
    } finally {
      setIsBusy(false);
    }
  }, [refresh]);

  const savePrivacy = useCallback((input: {
    discoveryEnabled: boolean;
    profileVisibility: LogVisibility;
    logDefaultVisibility: LogVisibility;
  }) => run(async () => {
    await setProfilePrivacy(input);
    return input.discoveryEnabled
      ? '공개 설정을 저장했어요.'
      : '공개 설정을 저장했고, 이미 노출된 발견 카드도 회수했어요.';
  }), [run]);

  const changeNickname = useCallback((nickname: string) => run(async () => {
    const availableAt = await setNickname(nickname);
    const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long' }).format(new Date(availableAt));
    return `닉네임을 변경했어요. 다음 변경은 ${date}부터 가능해요.`;
  }), [run]);

  const withdrawLocation = useCallback(() => run(async () => {
    const affected = await withdrawLocationConsent();
    return `위치 동의를 철회했어요. 러닝 ${affected}건의 원본 GPS가 파기 대상이 되고 발견은 중단됩니다.`;
  }), [run]);

  const requestDeletion = useCallback((reason: string | null) => run(async () => {
    const purgeAfter = await requestAccountDeletion(reason);
    const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long' }).format(new Date(purgeAfter));
    return `계정 삭제를 신청했어요. ${date}까지는 로그인해서 되돌릴 수 있어요.`;
  }), [run]);

  const cancelDeletion = useCallback(() => run(async () => {
    await cancelAccountDeletion();
    return '계정 삭제 신청을 되돌렸어요. 발견 노출은 직접 다시 켜 주세요.';
  }), [run]);

  return {
    status,
    isLoading,
    isBusy,
    error,
    notice,
    refresh,
    savePrivacy,
    changeNickname,
    withdrawLocation,
    requestDeletion,
    cancelDeletion,
  };
}

export type PrivacyController = ReturnType<typeof usePrivacy>;
