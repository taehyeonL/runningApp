import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export type WatchRunSnapshot = {
  state: 'idle' | 'recording' | 'paused' | 'finishing';
  distanceMeters: number;
  elapsedSeconds: number;
  averagePaceSeconds: number | null;
};

export type WatchRunCommand = 'start' | 'pause' | 'resume' | 'finish';

type WatchSessionNativeModule = {
  updateRun(snapshot: WatchRunSnapshot): void;
  pendingWatchRuns(): Promise<string[]>;
  clearWatchRun(sourceRecordId: string): Promise<boolean>;
};

const nativeModule = Platform.OS === 'ios'
  ? NativeModules.WatchSession as WatchSessionNativeModule | undefined
  : undefined;

export function syncWatchRun(snapshot: WatchRunSnapshot) {
  nativeModule?.updateRun(snapshot);
}

export function subscribeToWatchCommands(listener: (command: WatchRunCommand) => void) {
  if (!nativeModule || Platform.OS !== 'ios') return () => undefined;
  const emitter = new NativeEventEmitter(NativeModules.WatchSession);
  const subscription = emitter.addListener('WatchSessionCommand', (value: unknown) => {
    if (typeof value !== 'string' || !['start', 'pause', 'resume', 'finish'].includes(value)) return;
    listener(value as WatchRunCommand);
  });
  return () => subscription.remove();
}

/**
 * 워치가 넘겨 아직 서버에 올리지 못한 러닝의 원본 JSON.
 *
 * 이벤트가 아니라 디스크를 진실로 삼는다. 파일은 앱이 꺼져 있는 동안에도
 * 배달되므로, 앱이 살아 있을 때 온 이벤트만 믿으면 기록을 잃는다.
 */
export async function readPendingWatchRunPayloads(): Promise<string[]> {
  if (!nativeModule?.pendingWatchRuns) return [];
  try {
    const payloads = await nativeModule.pendingWatchRuns();
    return Array.isArray(payloads) ? payloads.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** 서버 적재가 끝난 워치 러닝 파일을 지운다. 적재 전에는 부르지 않는다. */
export async function clearWatchRun(sourceRecordId: string) {
  if (!nativeModule?.clearWatchRun) return;
  try {
    await nativeModule.clearWatchRun(sourceRecordId);
  } catch {
    // 지우지 못해도 서버에는 남았다. 다음 이관에서 중복으로 걸러진다.
  }
}

/** 워치가 러닝 파일을 새로 넘겨 왔을 때 알린다. */
export function subscribeToWatchRunTransfers(listener: () => void) {
  if (!nativeModule || Platform.OS !== 'ios') return () => undefined;
  const emitter = new NativeEventEmitter(NativeModules.WatchSession);
  const subscription = emitter.addListener('WatchRunReceived', () => listener());
  return () => subscription.remove();
}
