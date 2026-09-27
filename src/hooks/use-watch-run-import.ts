import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { importPendingWatchRuns, type WatchRunImportResult } from '../features/running/watch-run-import';
import { subscribeToWatchRunTransfers } from '../features/running/watch-session';
import { errorMessage } from '../lib/errors';

/**
 * 워치가 넘긴 러닝을 서버로 올린다.
 *
 * 이관을 시도하는 시점은 셋이다. 로그인 직후, 워치가 파일을 넘겨 왔을 때,
 * 앱이 다시 앞으로 나올 때. 앱이 꺼져 있는 동안 배달된 파일은 앞의 둘로는
 * 잡히지 않으므로 세 번째가 필요하다.
 */
export function useWatchRunImport(userId: string | undefined, onImported: () => void) {
  const [lastImported, setLastImported] = useState<WatchRunImportResult[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 같은 파일을 두 경로가 동시에 집으면 세션이 두 번 만들어질 수 있다.
  const inFlight = useRef(false);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  const importNow = useCallback(async () => {
    if (!userId || inFlight.current) return;
    inFlight.current = true;
    setIsImporting(true);
    try {
      const outcome = await importPendingWatchRuns(userId);
      if (outcome.imported.length > 0) {
        setLastImported(outcome.imported);
        onImportedRef.current();
      }
      setError(outcome.failures.length > 0 ? outcome.failures[0].message : null);
    } catch (reason) {
      setError(errorMessage(reason, '워치 기록을 가져오지 못했어요.'));
    } finally {
      inFlight.current = false;
      setIsImporting(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void importNow();
    const unsubscribe = subscribeToWatchRunTransfers(() => void importNow());
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void importNow();
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [importNow, userId]);

  const dismiss = useCallback(() => setLastImported([]), []);

  return { lastImported, isImporting, error, importNow, dismiss };
}
