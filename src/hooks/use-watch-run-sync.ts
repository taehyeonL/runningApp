import { useEffect } from 'react';

import { subscribeToWatchCommands, syncWatchRun, type WatchRunCommand } from '../features/running/watch-session';
import type { RunRecorderController } from './use-run-recorder';

export function useWatchRunSync(recorder: RunRecorderController, onStart: () => void, onFinish: () => void) {
  useEffect(() => {
    const activeRun = recorder.activeRun;
    syncWatchRun({
      state: activeRun?.status ?? 'idle',
      distanceMeters: recorder.metrics.distanceMeters,
      elapsedSeconds: recorder.metrics.elapsedSeconds,
      averagePaceSeconds: recorder.metrics.averagePaceSeconds,
    });
  }, [recorder.activeRun, recorder.metrics.averagePaceSeconds, recorder.metrics.distanceMeters, recorder.metrics.elapsedSeconds]);

  useEffect(() => subscribeToWatchCommands((command: WatchRunCommand) => {
    if (command === 'start' && !recorder.activeRun && !recorder.isBusy) {
      onStart();
    } else if (command === 'pause' && recorder.activeRun?.status === 'recording' && !recorder.isBusy) {
      void recorder.pause().catch(() => undefined);
    } else if (command === 'resume' && recorder.activeRun?.status === 'paused' && !recorder.isBusy) {
      void recorder.resume().catch(() => undefined);
    } else if (command === 'finish' && recorder.activeRun && !recorder.isBusy) {
      onFinish();
    }
  }), [onFinish, onStart, recorder]);
}
