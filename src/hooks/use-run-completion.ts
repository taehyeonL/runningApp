import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { RunListItem } from '../features/running/run-types';
import { errorMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';

/** Owner-only record status, independent of garden participation or deployment. */
export function useRunCompletion(sessionId: string | null) {
  const [run, setRun] = useState<RunListItem | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setRun(null); setError('');
    const read = async () => {
      if (timer) clearTimeout(timer);
      if (!sessionId || !supabase || !active) return;
      const ticket = ++generation;
      let retry = true;
      try {
        const { data, error: reason } = await supabase.from('running_sessions')
          .select('id,status,started_at,ended_at,duration_seconds,distance_meters,average_pace_seconds,visibility')
          .eq('id', sessionId).single();
        if (reason) throw reason;
        if (!active || ticket !== generation) return;
        setRun({ id: data.id, status: data.status, startedAt: data.started_at, endedAt: data.ended_at,
          durationSeconds: data.duration_seconds, distanceMeters: Number(data.distance_meters),
          averagePaceSeconds: data.average_pace_seconds, visibility: data.visibility });
        setError('');
        retry = data.status === 'processing';
      } catch (reason) {
        if (!active || ticket !== generation) return;
        setError(errorMessage(reason, '검증 상태를 확인하지 못했어요. 연결되면 다시 확인합니다.'));
      }
      if (active && ticket === generation && retry && AppState.currentState === 'active') timer = setTimeout(read, 5000);
    };
    void read();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void read();
      else { ++generation; if (timer) clearTimeout(timer); }
    });
    return () => { active = false; ++generation; if (timer) clearTimeout(timer); subscription.remove(); };
  }, [sessionId]);
  return { run: run?.id === sessionId ? run : null, error };
}
