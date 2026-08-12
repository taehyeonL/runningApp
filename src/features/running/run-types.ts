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

export type ActiveRunState = {
  version: 1;
  sessionId: string;
  userId: string;
  sourceRecordId: string;
  status: ActiveRunStatus;
  trackingMode: RunTrackingMode;
  startedAt: number;
  pausedAt: number | null;
  totalPausedMs: number;
  distanceMeters: number;
  movingMs: number;
  totalPoints: number;
  acceptedPoints: number;
  rejectedPoints: number;
  accuracyTotalMeters: number;
  accuracySamples: number;
  latestRecordedAt: number | null;
  lastAcceptedPoint: AcceptedRunPoint | null;
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
