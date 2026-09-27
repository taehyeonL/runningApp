export type RunTrackingMode = 'background' | 'foreground';
export type ActiveRunStatus = 'recording' | 'paused' | 'finishing';

export type StoredRunPoint = {
  recordedAt: number;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  speedMps: number | null;
  headingDegrees: number | null;
};

export type AcceptedRunPoint = Pick<
  StoredRunPoint,
  'recordedAt' | 'latitude' | 'longitude'
>;

export type RunDiagnostics = {
  foregroundTransitions: number;
  backgroundTransitions: number;
  restoreCount: number;
  syncFailureCount: number;
  maxPendingPoints: number;
};

/**
 * 좌표를 하나씩 받아 거리·이동시간·정확도를 누적하는 상태.
 *
 * 폰 실시간 기록과 워치 이관이 **같은 판정을 두 번 적지 않도록** 따로 뽑았다.
 * 품질 필터가 한쪽에만 반영되면 같은 러닝이 기기에 따라 다른 거리로 남는다.
 * 누적 규칙은 `accumulateRunPoint` 한 곳에만 있다.
 */
export type RunPointAccumulator = {
  distanceMeters: number;
  movingMs: number;
  totalPoints: number;
  acceptedPoints: number;
  rejectedPoints: number;
  accuracyTotalMeters: number;
  accuracySamples: number;
  lastAcceptedPoint: AcceptedRunPoint | null;
};

export type ActiveRunState = RunPointAccumulator & {
  version: 1;
  sessionId: string;
  userId: string;
  sourceRecordId: string;
  status: ActiveRunStatus;
  trackingMode: RunTrackingMode;
  startedAt: number;
  pausedAt: number | null;
  totalPausedMs: number;
  latestRecordedAt: number | null;
  pendingPoints: StoredRunPoint[];
  lastSyncError: string | null;
  diagnostics?: RunDiagnostics;
  updatedAt: number;
};

export type RunSummary = {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  movingSeconds: number;
  distanceMeters: number;
  averagePaceSeconds: number | null;
  totalPoints: number;
  acceptedPoints: number;
  rejectedPoints: number;
  trackingMode: RunTrackingMode;
  diagnostics: RunDiagnostics;
  serverStatus: 'processing';
};

export type RunListItem = {
  id: string;
  status: 'recording' | 'processing' | 'completed';
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  distanceMeters: number;
  averagePaceSeconds: number | null;
  visibility: 'private' | 'friends' | 'profile' | 'matching';
};

/**
 * 워치가 단독으로 기록해 폰으로 넘긴 러닝 한 건.
 *
 * 워치는 서버에 직접 쓰지 않는다. 로그인 세션과 동의 판정이 폰에만 있고,
 * 원본 좌표를 다루는 경로를 하나로 유지해야 하기 때문이다. 워치는 파일만
 * 넘기고, `location_points` 적재와 `submit_running_session` 호출은 폰이 한다.
 */
export type WatchRunPayload = {
  version: 1;
  sourceRecordId: string;
  /** epoch ms */
  startedAt: number;
  /** epoch ms. 워치가 종료를 기록하지 못한 채 끊기면 null이 아니라 마지막 좌표 시각이 들어온다. */
  endedAt: number;
  /** 워치가 일시정지에 머문 총 시간(ms). 경과 시간에서 뺀다. */
  totalPausedMs: number;
  /** 워치 앱이 종료를 못 찍고 죽어서 마지막 좌표로 끝을 추정한 기록. */
  recovered: boolean;
  points: StoredRunPoint[];
};
