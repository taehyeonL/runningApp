import { errorMessage } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import {
  MAX_METRIC_ACCURACY_METERS,
  RUN_UPLOAD_BATCH_SIZE,
  accumulateRunPoint,
  averagePaceSeconds,
  createRunPointAccumulator,
  ensureFreshSession,
  insertLocationPoints,
} from './run-recorder';
import { readPendingWatchRunPayloads, clearWatchRun } from './watch-session';
import type { StoredRunPoint, WatchRunPayload } from './run-types';

/**
 * 워치가 넘긴 러닝을 서버에 올린다.
 *
 * 워치는 서버에 직접 쓰지 않는다. 로그인 세션, 위치 이용 동의, 원본 좌표
 * 적재를 전부 폰 한 곳에 두기 위해서다. 워치는 좌표를 날것 그대로 넘기고,
 * 거리·페이스 판정은 폰이 `accumulateRunPoint`로 **다시** 한다. 워치가 계산한
 * 숫자를 그대로 믿으면 같은 러닝이 기기에 따라 다른 거리로 남는다.
 *
 * 올라간 좌표는 폰 러닝과 똑같이 `location_points`에 들어가므로 본인과
 * service role만 읽을 수 있다. 이관이 새 노출 경로를 만들지 않는다.
 */

export type WatchRunImportResult = {
  sourceRecordId: string;
  sessionId: string;
  distanceMeters: number;
  durationSeconds: number;
  acceptedPoints: number;
  recovered: boolean;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parsePoint(value: unknown): StoredRunPoint | null {
  if (typeof value !== 'object' || value === null) return null;
  const point = value as Record<string, unknown>;
  const optional = (key: string) => (isFiniteNumber(point[key]) ? (point[key] as number) : null);
  if (
    !isFiniteNumber(point.recordedAt)
    || !isFiniteNumber(point.latitude)
    || !isFiniteNumber(point.longitude)
    || point.latitude < -90
    || point.latitude > 90
    || point.longitude < -180
    || point.longitude > 180
  ) return null;

  const nonNegative = (key: string) => {
    const candidate = optional(key);
    return candidate !== null && candidate >= 0 ? candidate : null;
  };
  const heading = optional('headingDegrees');
  return {
    recordedAt: Math.round(point.recordedAt),
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyMeters: nonNegative('accuracyMeters'),
    altitudeMeters: optional('altitudeMeters'),
    speedMps: nonNegative('speedMps'),
    headingDegrees: heading !== null && heading >= 0 && heading <= 360 ? heading : null,
  };
}

/** 워치가 준 JSON을 검사한다. 모양이 어긋나면 조용히 버리지 않고 이유를 남긴다. */
export function parseWatchRunPayload(raw: string): WatchRunPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const payload = value as Record<string, unknown>;
  if (payload.version !== 1) return null;
  if (typeof payload.sourceRecordId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(payload.sourceRecordId)) {
    return null;
  }
  if (!isFiniteNumber(payload.startedAt) || !isFiniteNumber(payload.endedAt)) return null;
  if (payload.endedAt < payload.startedAt) return null;
  if (!Array.isArray(payload.points)) return null;

  const points = payload.points
    .map(parsePoint)
    .filter((point): point is StoredRunPoint => point !== null)
    .sort((a, b) => a.recordedAt - b.recordedAt);

  return {
    version: 1,
    sourceRecordId: payload.sourceRecordId,
    startedAt: Math.round(payload.startedAt),
    endedAt: Math.round(payload.endedAt),
    totalPausedMs: isFiniteNumber(payload.totalPausedMs) && payload.totalPausedMs >= 0
      ? payload.totalPausedMs
      : 0,
    recovered: payload.recovered === true,
    points,
  };
}

/**
 * 워치 러닝 한 건을 서버에 올린다.
 *
 * 좌표를 다 올린 뒤에야 `submit_running_session`을 부른다. 순서를 바꾸면
 * 서버 검증이 좌표가 덜 올라온 상태의 러닝을 판정하게 된다.
 */
export async function importWatchRun(
  userId: string,
  payload: WatchRunPayload,
): Promise<WatchRunImportResult> {
  if (!supabase) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  await ensureFreshSession();

  // 폰 러닝과 같은 필터를 통과시킨다. 여기서 나온 값만 서버로 간다.
  const accumulator = createRunPointAccumulator();
  const accepted: StoredRunPoint[] = [];
  let latestRecordedAt = 0;
  for (const point of payload.points) {
    if (point.recordedAt < payload.startedAt || point.recordedAt > payload.endedAt) continue;
    if (point.recordedAt <= latestRecordedAt) continue;
    latestRecordedAt = point.recordedAt;
    accepted.push(point);
    accumulateRunPoint(accumulator, point);
  }

  // 이미 올린 러닝인지 먼저 본다. 파일 삭제가 실패한 채 앱이 죽으면 같은
  // 러닝을 다시 만나게 되는데, 그때 세션을 두 번 만들면 안 된다.
  const existing = await supabase
    .from('running_sessions')
    .select('id,status')
    .eq('user_id', userId)
    .eq('source', 'apple_watch')
    .eq('source_record_id', payload.sourceRecordId)
    .maybeSingle();
  if (existing.error) throw existing.error;

  let existingId = existing.data?.id as string | undefined;
  let alreadySubmitted = existingId !== undefined && existing.data?.status !== 'recording';

  if (!existingId) {
    const created = await supabase
      .from('running_sessions')
      .insert({
        user_id: userId,
        source: 'apple_watch',
        source_record_id: payload.sourceRecordId,
        started_at: new Date(payload.startedAt).toISOString(),
        visibility: 'private',
      })
      .select('id')
      .single();
    if (created.error || !created.data) {
      if (
        created.error?.code === '42501'
        || created.error?.message.toLowerCase().includes('row-level security')
      ) {
        throw new Error('위치 이용 동의를 저장한 뒤 워치 기록을 가져올 수 있어요.');
      }
      throw created.error ?? new Error('워치 러닝 세션을 만들지 못했습니다.');
    }
    existingId = created.data.id as string;
    alreadySubmitted = false;
  }

  const sessionId = existingId;

  if (!alreadySubmitted) {
    for (let offset = 0; offset < accepted.length; offset += RUN_UPLOAD_BATCH_SIZE) {
      await insertLocationPoints(sessionId, userId, accepted.slice(offset, offset + RUN_UPLOAD_BATCH_SIZE));
    }
  }

  const durationSeconds = Math.max(
    0,
    Math.floor((payload.endedAt - payload.startedAt - payload.totalPausedMs) / 1000),
  );
  const movingSeconds = Math.min(durationSeconds, Math.round(accumulator.movingMs / 1000));
  const averageAccuracy = accumulator.accuracySamples > 0
    ? accumulator.accuracyTotalMeters / accumulator.accuracySamples
    : null;

  if (!alreadySubmitted) {
    const { error } = await supabase.rpc('submit_running_session', {
      p_session_id: sessionId,
      p_ended_at: new Date(payload.endedAt).toISOString(),
      p_duration_seconds: durationSeconds,
      p_distance_meters: Number(accumulator.distanceMeters.toFixed(2)),
      p_average_pace_seconds: averagePaceSeconds(accumulator),
      p_moving_seconds: movingSeconds,
      p_calories: null,
      // 심박은 별도 동의(health_data) 없이 다루지 않는다. 워치도 읽지 않는다.
      p_average_heart_rate: null,
      p_gps_quality_summary: {
        total_points: accumulator.totalPoints,
        accepted_points: accumulator.acceptedPoints,
        rejected_points: accumulator.rejectedPoints,
        average_accuracy_meters: averageAccuracy === null ? null : Number(averageAccuracy.toFixed(2)),
        client_accuracy_limit_meters: MAX_METRIC_ACCURACY_METERS,
      },
      p_sync_metadata: {
        source_record_id: payload.sourceRecordId,
        tracking_mode: 'background',
        client: 'apple-watch',
        transferred_points: payload.points.length,
        recovered_from_interrupted_run: payload.recovered,
      },
    });
    if (error) {
      const check = await supabase
        .from('running_sessions')
        .select('status')
        .eq('id', sessionId)
        .maybeSingle();
      if (check.error || !['processing', 'completed'].includes(check.data?.status)) {
        throw error;
      }
    }

    void supabase.functions.invoke('detect-co-running', {
      body: { sessionId },
    }).catch(() => undefined);
  }

  // 서버에 남은 뒤에만 워치 파일을 버린다.
  await clearWatchRun(payload.sourceRecordId);

  return {
    sourceRecordId: payload.sourceRecordId,
    sessionId,
    distanceMeters: accumulator.distanceMeters,
    durationSeconds,
    acceptedPoints: accumulator.acceptedPoints,
    recovered: payload.recovered,
  };
}

export type WatchImportOutcome = {
  imported: WatchRunImportResult[];
  failures: { sourceRecordId: string | null; message: string }[];
};

/**
 * 폰에 도착해 있는 워치 러닝을 전부 가져온다.
 *
 * 한 건이 실패해도 나머지를 계속한다. 실패한 파일은 지우지 않으므로 다음
 * 기회에 다시 시도된다.
 */
export async function importPendingWatchRuns(userId: string): Promise<WatchImportOutcome> {
  const outcome: WatchImportOutcome = { imported: [], failures: [] };
  const raws = await readPendingWatchRunPayloads();

  for (const raw of raws) {
    const payload = parseWatchRunPayload(raw);
    if (!payload) {
      outcome.failures.push({ sourceRecordId: null, message: '워치 기록을 읽지 못했어요.' });
      continue;
    }
    try {
      outcome.imported.push(await importWatchRun(userId, payload));
    } catch (reason) {
      outcome.failures.push({
        sourceRecordId: payload.sourceRecordId,
        message: errorMessage(reason, '워치 기록을 가져오지 못했어요.'),
      });
    }
  }
  return outcome;
}
