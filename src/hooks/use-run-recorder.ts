import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import {
  averagePaceSeconds,
  discardRun,
  elapsedRunSeconds,
  finishRun,
  pauseRun,
  recordRunAppStateTransition,
  restoreRunTracking,
  resumeRun,
  startRun,
} from '../features/running/run-recorder';
import { readActiveRun, subscribeActiveRun } from '../features/running/run-storage';
import type { ActiveRunState, RunSummary } from '../features/running/run-types';
import type { RunListItem } from '../features/running/run-types';
import { supabase } from '../lib/supabase';

export function useRunRecorder(userId?: string) {
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunListItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const refreshHistory = useCallback(async () => {
    if (!userId || !supabase) {
      setRecentRuns([]);
      return;
    }
    setIsHistoryLoading(true);
    try {
      const { data, error: historyError } = await supabase
        .from('running_sessions')
        .select('id,status,started_at,ended_at,duration_seconds,distance_meters,average_pace_seconds,visibility')
        .eq('user_id', userId)
        .in('status', ['processing', 'completed'])
        .order('started_at', { ascending: false })
        .limit(50);
      if (historyError) throw historyError;
      setRecentRuns((data ?? []).map((run) => ({
        id: run.id,
        status: run.status,
        startedAt: run.started_at,
        endedAt: run.ended_at,
        durationSeconds: run.duration_seconds,
        distanceMeters: Number(run.distance_meters),
        averagePaceSeconds: run.average_pace_seconds,
        visibility: run.visibility,
      })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsHistoryLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    let mounted = true;
    void readActiveRun().then((state) => {
      if (mounted && (!state || state.userId === userId)) setActiveRun(state);
    });
    const unsubscribe = subscribeActiveRun((state) => {
      if (!state || state.userId === userId) setActiveRun(state);
    });
    const appState = AppState.addEventListener('change', (next) => {
      void recordRunAppStateTransition(next);
      if (next !== 'active') return;
      void readActiveRun().then((state) => {
        if (!state || state.userId === userId) setActiveRun(state);
      });
    });
    return () => {
      mounted = false;
      unsubscribe();
      appState.remove();
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void restoreRunTracking(userId).catch((reason) => setError(String(reason)));
  }, [userId]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (!activeRun) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [activeRun]);

  const runAction = useCallback(async <T,>(action: () => Promise<T>) => {
    setIsBusy(true);
    setError(null);
    try {
      return await action();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      throw reason;
    } finally {
      setIsBusy(false);
    }
  }, []);

  const start = useCallback((preferBackground: boolean) => {
    if (!userId) return Promise.reject(new Error('러닝을 시작하려면 먼저 로그인해 주세요.'));
    return runAction(() => startRun(userId, preferBackground));
  }, [runAction, userId]);

  const pause = useCallback(() => runAction(pauseRun), [runAction]);
  const resume = useCallback(() => runAction(resumeRun), [runAction]);
  const discard = useCallback(() => runAction(discardRun), [runAction]);
  const finish = useCallback(() => runAction(async () => {
    const summary = await finishRun();
    setLastRun(summary);
    await refreshHistory();
    return summary;
  }), [refreshHistory, runAction]);

  const metrics = useMemo(() => ({
    elapsedSeconds: activeRun ? elapsedRunSeconds(activeRun, now) : 0,
    distanceMeters: activeRun?.distanceMeters ?? 0,
    averagePaceSeconds: activeRun ? averagePaceSeconds(activeRun) : null,
    pendingPoints: activeRun?.pendingPoints.length ?? 0,
    totalPoints: activeRun?.totalPoints ?? 0,
    acceptedPoints: activeRun?.acceptedPoints ?? 0,
    rejectedPoints: activeRun?.rejectedPoints ?? 0,
  }), [activeRun, now]);

  return {
    activeRun,
    lastRun,
    recentRuns,
    metrics,
    isBusy,
    isHistoryLoading,
    error,
    start,
    pause,
    resume,
    finish,
    discard,
    refreshHistory,
  };
}

export type RunRecorderController = ReturnType<typeof useRunRecorder>;
