import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform, type AppStateStatus } from 'react-native';

import { errorMessage } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { readActiveRun, replaceActiveRun, updateActiveRun } from './run-storage';
import type {
  AcceptedRunPoint,
  ActiveRunState,
  RunDiagnostics,
  RunPointAccumulator,
  RunSummary,
  RunTrackingMode,
  StoredRunPoint,
} from './run-types';

export const RUN_LOCATION_TASK = 'running-mate-location-v1';
export const MAX_METRIC_ACCURACY_METERS = 30;
const MAX_RUNNING_SPEED_MPS = 12;
const MAX_SEGMENT_SECONDS = 120;
const UPLOAD_BATCH_SIZE = 100;

let foregroundSubscription: Location.LocationSubscription | null = null;

function runDiagnostics(state: ActiveRunState): RunDiagnostics {
  return state.diagnostics ?? {
    foregroundTransitions: 0,
    backgroundTransitions: 0,
    restoreCount: 0,
    syncFailureCount: 0,
    maxPendingPoints: state.pendingPoints.length,
  };
}

export function haversineMeters(a: AcceptedRunPoint, b: AcceptedRunPoint) {
  const radius = 6_371_000;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const latitude1 = radians(a.latitude);
  const latitude2 = radians(b.latitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function toStoredPoint(location: Location.LocationObject): StoredRunPoint | null {
  const { coords } = location;
  if (
    !Number.isFinite(location.timestamp)
    || !Number.isFinite(coords.latitude)
    || !Number.isFinite(coords.longitude)
    || coords.latitude < -90
    || coords.latitude > 90
    || coords.longitude < -180
    || coords.longitude > 180
  ) return null;

  const nonNegative = (value: number | null) =>
    value !== null && Number.isFinite(value) && value >= 0 ? value : null;

  return {
    recordedAt: Math.round(location.timestamp),
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracyMeters: nonNegative(coords.accuracy),
    altitudeMeters: coords.altitude !== null && Number.isFinite(coords.altitude) ? coords.altitude : null,
    speedMps: nonNegative(coords.speed),
    headingDegrees: coords.heading !== null
      && Number.isFinite(coords.heading)
      && coords.heading >= 0
      && coords.heading <= 360
      ? coords.heading
      : null,
  };
}

export function createRunPointAccumulator(): RunPointAccumulator {
  return {
    distanceMeters: 0,
    movingMs: 0,
    totalPoints: 0,
    acceptedPoints: 0,
    rejectedPoints: 0,
    accuracyTotalMeters: 0,
    accuracySamples: 0,
    lastAcceptedPoint: null,
  };
}

/**
 * 좌표 하나를 누적한다. 폰 실시간 기록과 워치 이관이 **같은 판정**을 쓰도록
 * 여기 한 곳에만 둔다. 정확도·구간 길이·속도 상한을 통과하지 못한 점은
 * 거리에 더하지 않고 rejected로만 센다.
 */
export function accumulateRunPoint(state: RunPointAccumulator, point: StoredRunPoint) {
  state.totalPoints += 1;
  if (point.accuracyMeters !== null) {
    state.accuracyTotalMeters += point.accuracyMeters;
    state.accuracySamples += 1;
  }

  const accurate = point.accuracyMeters !== null
    && point.accuracyMeters <= MAX_METRIC_ACCURACY_METERS;
  if (!accurate) {
    state.rejectedPoints += 1;
    return;
  }

  const previous = state.lastAcceptedPoint;
  if (!previous) {
    state.acceptedPoints += 1;
    state.lastAcceptedPoint = point;
    return;
  }

  const elapsedSeconds = (point.recordedAt - previous.recordedAt) / 1000;
  const distance = haversineMeters(previous, point);
  const impliedSpeed = elapsedSeconds > 0 ? distance / elapsedSeconds : Number.POSITIVE_INFINITY;
  if (
    elapsedSeconds <= 0
    || elapsedSeconds > MAX_SEGMENT_SECONDS
    || impliedSpeed > MAX_RUNNING_SPEED_MPS
  ) {
    state.rejectedPoints += 1;
    return;
  }

  state.acceptedPoints += 1;
  state.distanceMeters += distance;
  if (distance >= 1 || (point.speedMps ?? 0) >= 0.3) {
    state.movingMs += elapsedSeconds * 1000;
  }
  state.lastAcceptedPoint = point;
}

export async function ensureFreshSession() {
  if (!supabase) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');

  if ((data.session.expires_at ?? 0) * 1000 - Date.now() < 60_000) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) {
      throw refreshed.error ?? new Error('로그인 세션을 갱신하지 못했습니다.');
    }
  }
}

export const RUN_UPLOAD_BATCH_SIZE = UPLOAD_BATCH_SIZE;

/**
 * 원본 좌표를 서버에 적재한다. 폰 실시간 기록과 워치 이관이 같은 컬럼·같은
 * 충돌 규칙을 쓰도록 한 곳에 둔다. `session_id,recorded_at` 중복은 무시하므로
 * 같은 배치를 다시 보내도 안전하다.
 */
export async function insertLocationPoints(
  sessionId: string,
  userId: string,
  points: StoredRunPoint[],
) {
  if (points.length === 0) return;
  if (!supabase) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  const { error } = await supabase.from('location_points').upsert(
    points.map((point) => ({
      session_id: sessionId,
      user_id: userId,
      recorded_at: new Date(point.recordedAt).toISOString(),
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy_meters: point.accuracyMeters,
      altitude_meters: point.altitudeMeters,
      speed_mps: point.speedMps,
      heading_degrees: point.headingDegrees,
    })),
    { onConflict: 'session_id,recorded_at', ignoreDuplicates: true },
  );
  if (error) throw error;
}

async function uploadPendingUnlocked(state: ActiveRunState) {
  if (state.pendingPoints.length === 0) {
    state.lastSyncError = null;
    return;
  }

  try {
    await ensureFreshSession();
    const batch = state.pendingPoints.slice(0, UPLOAD_BATCH_SIZE);
    await insertLocationPoints(state.sessionId, state.userId, batch);
    state.pendingPoints.splice(0, batch.length);
    state.lastSyncError = null;
  } catch (error) {
    state.lastSyncError = errorMessage(error);
    const diagnostics = runDiagnostics(state);
    diagnostics.syncFailureCount += 1;
    diagnostics.maxPendingPoints = Math.max(diagnostics.maxPendingPoints, state.pendingPoints.length);
    state.diagnostics = diagnostics;
  }
}

export async function ingestLocations(locations: Location.LocationObject[]) {
  await updateActiveRun(async (state) => {
    if (!state || state.status !== 'recording') return state;

    const points = locations
      .map(toStoredPoint)
      .filter((point): point is StoredRunPoint => point !== null)
      .sort((a, b) => a.recordedAt - b.recordedAt);
    for (const point of points) {
      if (point.recordedAt < state.startedAt || point.recordedAt > Date.now() + 60_000) continue;
      if (point.recordedAt <= (state.latestRecordedAt ?? 0)) continue;
      state.latestRecordedAt = point.recordedAt;
      state.pendingPoints.push(point);
      accumulateRunPoint(state, point);
    }
    const diagnostics = runDiagnostics(state);
    diagnostics.maxPendingPoints = Math.max(diagnostics.maxPendingPoints, state.pendingPoints.length);
    state.diagnostics = diagnostics;
    state.updatedAt = Date.now();
    await uploadPendingUnlocked(state);
    return { ...state, pendingPoints: [...state.pendingPoints] };
  });
}

async function stopTracking() {
  foregroundSubscription?.remove();
  foregroundSubscription = null;
  if (Platform.OS !== 'web' && await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(RUN_LOCATION_TASK);
  }
}

async function startTracking(mode: RunTrackingMode) {
  if (mode === 'background') {
    if (!await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK)) {
      await Location.startLocationUpdatesAsync(RUN_LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        activityType: Location.ActivityType.Fitness,
        distanceInterval: 5,
        timeInterval: 5_000,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: '같이뛰어 러닝 기록 중',
          notificationBody: '위치는 러닝 기록과 서버 검증에만 사용됩니다.',
          killServiceOnDestroy: false,
        },
      });
    }
    return;
  }

  foregroundSubscription?.remove();
  foregroundSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 5,
      timeInterval: 5_000,
    },
    (location) => void ingestLocations([location]),
  );
}

async function chooseTrackingMode(preferBackground: boolean): Promise<RunTrackingMode> {
  if (!preferBackground || Platform.OS === 'web') return 'foreground';
  const [taskManagerAvailable, backgroundAvailable] = await Promise.all([
    TaskManager.isAvailableAsync(),
    Location.isBackgroundLocationAvailableAsync(),
  ]);
  if (!taskManagerAvailable || !backgroundAvailable) return 'foreground';

  const permission = await Location.requestBackgroundPermissionsAsync();
  return permission.granted ? 'background' : 'foreground';
}

function initialState(
  sessionId: string,
  userId: string,
  sourceRecordId: string,
  startedAt: number,
  trackingMode: RunTrackingMode,
): ActiveRunState {
  return {
    version: 1,
    sessionId,
    userId,
    sourceRecordId,
    status: 'recording',
    trackingMode,
    startedAt,
    pausedAt: null,
    totalPausedMs: 0,
    distanceMeters: 0,
    movingMs: 0,
    totalPoints: 0,
    acceptedPoints: 0,
    rejectedPoints: 0,
    accuracyTotalMeters: 0,
    accuracySamples: 0,
    latestRecordedAt: null,
    lastAcceptedPoint: null,
    pendingPoints: [],
    lastSyncError: null,
    diagnostics: {
      foregroundTransitions: 0,
      backgroundTransitions: 0,
      restoreCount: 0,
      syncFailureCount: 0,
      maxPendingPoints: 0,
    },
    updatedAt: startedAt,
  };
}

export async function startRun(userId: string, preferBackground: boolean) {
  if (!supabase) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  if (await readActiveRun()) throw new Error('이미 진행 중인 러닝이 있습니다.');
  if (!await Location.hasServicesEnabledAsync()) {
    throw new Error('기기의 위치 서비스를 켠 뒤 다시 시작해 주세요.');
  }

  const foregroundPermission = await Location.requestForegroundPermissionsAsync();
  if (!foregroundPermission.granted) {
    throw new Error('러닝을 기록하려면 앱 사용 중 위치 권한이 필요합니다.');
  }

  const trackingMode = await chooseTrackingMode(preferBackground);
  const startedAt = Date.now();
  const sourceRecordId = `phone-${startedAt}-${Math.random().toString(36).slice(2, 10)}`;
  const { data, error } = await supabase
    .from('running_sessions')
    .insert({
      user_id: userId,
      source: 'phone',
      source_record_id: sourceRecordId,
      started_at: new Date(startedAt).toISOString(),
      visibility: 'private',
    })
    .select('id')
    .single();
  if (error || !data) {
    if (error?.code === '42501' || error?.message.toLowerCase().includes('row-level security')) {
      throw new Error('프로필과 개인위치정보 동의를 저장한 뒤 다시 시작해 주세요.');
    }
    throw new Error(error?.message ?? '러닝 세션을 만들지 못했습니다.');
  }

  const state = initialState(data.id, userId, sourceRecordId, startedAt, trackingMode);
  await replaceActiveRun(state);
  try {
    await startTracking(trackingMode);
  } catch (trackingError) {
    await replaceActiveRun(null);
    await supabase.from('running_sessions').delete().eq('id', data.id);
    throw trackingError;
  }
  return state;
}

export async function pauseRun() {
  await stopTracking();
  return updateActiveRun((state) => {
    if (!state || state.status !== 'recording') return state;
    return { ...state, status: 'paused', pausedAt: Date.now(), updatedAt: Date.now() };
  });
}

export async function resumeRun() {
  const state = await updateActiveRun((current) => {
    if (!current || current.status !== 'paused' || current.pausedAt === null) return current;
    const now = Date.now();
    return {
      ...current,
      status: 'recording',
      totalPausedMs: current.totalPausedMs + now - current.pausedAt,
      pausedAt: null,
      lastAcceptedPoint: null,
      updatedAt: now,
    };
  });
  if (state?.status === 'recording') {
    try {
      await startTracking(state.trackingMode);
    } catch (error) {
      await updateActiveRun((current) => current?.status === 'recording'
        ? { ...current, status: 'paused', pausedAt: Date.now(), updatedAt: Date.now() }
        : current);
      throw error;
    }
  }
  return state;
}

export function elapsedRunSeconds(state: ActiveRunState, now = Date.now()) {
  const end = state.pausedAt ?? now;
  return Math.max(0, Math.floor((end - state.startedAt - state.totalPausedMs) / 1000));
}

export function averagePaceSeconds(state: Pick<RunPointAccumulator, 'distanceMeters' | 'movingMs'>) {
  if (state.distanceMeters < 100) return null;
  const pace = Math.round((state.movingMs / 1000) / (state.distanceMeters / 1000));
  return pace >= 60 && pace <= 7200 ? pace : null;
}

export async function finishRun(): Promise<RunSummary> {
  await stopTracking();
  const state = await updateActiveRun(async (current) => {
    if (!current) return current;
    const now = Date.now();
    if (current.status === 'paused' && current.pausedAt !== null) {
      current.totalPausedMs += now - current.pausedAt;
      current.pausedAt = null;
    }
    current.status = 'finishing';
    current.updatedAt = now;
    while (current.pendingPoints.length > 0) {
      const before = current.pendingPoints.length;
      await uploadPendingUnlocked(current);
      if (current.pendingPoints.length === before) break;
    }
    return { ...current, pendingPoints: [...current.pendingPoints] };
  });
  if (!state) throw new Error('완료할 러닝 기록이 없습니다.');
  if (state.pendingPoints.length > 0) {
    throw new Error('GPS 포인트가 아직 서버에 동기화되지 않았습니다. 네트워크 연결 후 다시 종료해 주세요.');
  }

  await ensureFreshSession();
  const endedAt = new Date();
  const durationSeconds = elapsedRunSeconds(state, endedAt.getTime());
  const pace = averagePaceSeconds(state);
  const movingSeconds = Math.min(durationSeconds, Math.round(state.movingMs / 1000));
  const averageAccuracy = state.accuracySamples > 0
    ? state.accuracyTotalMeters / state.accuracySamples
    : null;
  const { data, error } = await supabase!.rpc('submit_running_session', {
    p_session_id: state.sessionId,
    p_ended_at: endedAt.toISOString(),
    p_duration_seconds: durationSeconds,
    p_distance_meters: Number(state.distanceMeters.toFixed(2)),
    p_average_pace_seconds: pace,
    p_moving_seconds: movingSeconds,
    p_calories: null,
    p_average_heart_rate: null,
    p_gps_quality_summary: {
      total_points: state.totalPoints,
      accepted_points: state.acceptedPoints,
      rejected_points: state.rejectedPoints,
      average_accuracy_meters: averageAccuracy === null ? null : Number(averageAccuracy.toFixed(2)),
      client_accuracy_limit_meters: MAX_METRIC_ACCURACY_METERS,
    },
    p_sync_metadata: {
      source_record_id: state.sourceRecordId,
      tracking_mode: state.trackingMode,
      client: 'expo-location',
      diagnostics: runDiagnostics(state),
    },
  });
  if (error || !data) {
    // The response can be lost after the transaction commits. A retry then
    // legitimately returns false because the session is no longer recording.
    const existing = await supabase!
      .from('running_sessions')
      .select('status')
      .eq('id', state.sessionId)
      .maybeSingle();
    if (existing.error || !['processing', 'completed'].includes(existing.data?.status)) {
      throw error ?? existing.error ?? new Error('서버가 러닝 종료 상태를 승인하지 않았습니다.');
    }
  }

  // The durable detection_jobs row already exists. This best-effort call only
  // wakes the worker immediately; a failed HTTP call does not lose the run.
  void supabase!.functions.invoke('detect-co-running', {
    body: { sessionId: state.sessionId },
  }).catch(() => undefined);

  const summary: RunSummary = {
    sessionId: state.sessionId,
    startedAt: new Date(state.startedAt).toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds,
    movingSeconds,
    distanceMeters: state.distanceMeters,
    averagePaceSeconds: pace,
    totalPoints: state.totalPoints,
    acceptedPoints: state.acceptedPoints,
    rejectedPoints: state.rejectedPoints,
    trackingMode: state.trackingMode,
    diagnostics: runDiagnostics(state),
    serverStatus: 'processing',
  };
  await replaceActiveRun(null);
  return summary;
}

export async function discardRun() {
  await stopTracking();
  const state = await readActiveRun();
  if (!state) return;
  if (!supabase) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  const { error } = await supabase.from('running_sessions').delete().eq('id', state.sessionId);
  if (error) throw error;
  await replaceActiveRun(null);
}

export async function restoreRunTracking(userId: string) {
  const state = await updateActiveRun((current) => {
    if (!current || current.userId !== userId || current.status !== 'recording') return current;
    const diagnostics = runDiagnostics(current);
    diagnostics.restoreCount += 1;
    return { ...current, diagnostics, updatedAt: Date.now() };
  });
  if (!state || state.userId !== userId || state.status !== 'recording') return state;
  await startTracking(state.trackingMode);
  return state;
}

export async function recordRunAppStateTransition(next: AppStateStatus) {
  return updateActiveRun((state) => {
    if (!state) return state;
    const diagnostics = runDiagnostics(state);
    if (next === 'active') diagnostics.foregroundTransitions += 1;
    if (next === 'background') diagnostics.backgroundTransitions += 1;
    return { ...state, diagnostics, updatedAt: Date.now() };
  });
}
