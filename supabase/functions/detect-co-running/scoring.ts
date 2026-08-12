export type SessionRow = {
  id: string;
  user_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  distance_meters: number | string;
  average_pace_seconds: number | null;
};

export type LocationPointRow = {
  recorded_at: string;
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  speed_mps: number | null;
};

type TrackPoint = {
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
  bearing: number | null;
  cumulativeDistance: number;
};

export type ValidatedRun = {
  valid: boolean;
  distanceMeters: number;
  durationSeconds: number;
  movingSeconds: number;
  averagePaceSeconds: number | null;
  totalPoints: number;
  acceptedPoints: number;
  rejectedPoints: number;
  averageAccuracyMeters: number | null;
  preferredAccuracyPoints: number;
  matchTrack: TrackPoint[];
  rejectionReasons: string[];
};

export type EncounterEvidence = {
  other_session_id: string;
  confidence: number;
  overlap_seconds: number;
  overlap_meters: number;
  average_distance_meters: number;
  average_direction_delta_degrees: number;
  pace_delta_ratio: number;
};

const EARTH_RADIUS_METERS = 6_371_000;
const MAX_ACCURACY_METERS = 30;
const PREFERRED_ACCURACY_METERS = 15;
const MAX_SPEED_MPS = 12;
const MAX_SEGMENT_SECONDS = 120;
const ENDPOINT_MASK_METERS = 200;
const MAX_TIME_DELTA_MS = 8_000;
const MAX_PAIR_DISTANCE_METERS = 35;
const MAX_DIRECTION_DELTA = 45;
const MAX_PACE_DELTA_RATIO = 0.35;

const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (radiansValue: number) => radiansValue * 180 / Math.PI;
const rounded = (value: number, places = 2) => Number(value.toFixed(places));

function haversineMeters(a: Pick<TrackPoint, 'latitude' | 'longitude'>, b: Pick<TrackPoint, 'latitude' | 'longitude'>) {
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const latitude1 = radians(a.latitude);
  const latitude2 = radians(b.latitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function bearingDegrees(a: TrackPoint, b: TrackPoint) {
  const longitudeDelta = radians(b.longitude - a.longitude);
  const latitude1 = radians(a.latitude);
  const latitude2 = radians(b.latitude);
  const y = Math.sin(longitudeDelta) * Math.cos(latitude2);
  const x = Math.cos(latitude1) * Math.sin(latitude2)
    - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(longitudeDelta);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

function directionDelta(a: number | null, b: number | null) {
  if (a === null || b === null) return 180;
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}

function parsePoint(row: LocationPointRow): TrackPoint | null {
  const timestamp = Date.parse(row.recorded_at);
  const accuracy = Number(row.accuracy_meters);
  if (
    !Number.isFinite(timestamp)
    || !Number.isFinite(row.latitude)
    || !Number.isFinite(row.longitude)
    || row.latitude < -90
    || row.latitude > 90
    || row.longitude < -180
    || row.longitude > 180
    || !Number.isFinite(accuracy)
    || accuracy < 0
    || accuracy > MAX_ACCURACY_METERS
  ) return null;

  const reportedSpeed = Number(row.speed_mps);
  return {
    timestamp,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy,
    speed: Number.isFinite(reportedSpeed) && reportedSpeed >= 0 ? reportedSpeed : 0,
    bearing: null,
    cumulativeDistance: 0,
  };
}

export function validateRun(session: SessionRow, rows: LocationPointRow[]): ValidatedRun {
  const startedAt = Date.parse(session.started_at);
  const endedAt = session.ended_at ? Date.parse(session.ended_at) : Number.NaN;
  const sorted = [...rows].sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  const accepted: TrackPoint[] = [];
  let rejectedPoints = 0;
  let distanceMeters = 0;
  let movingSeconds = 0;
  let accuracyTotal = 0;
  let preferredAccuracyPoints = 0;
  let latestTimestamp = -Infinity;

  for (const row of sorted) {
    const point = parsePoint(row);
    if (
      !point
      || point.timestamp < startedAt
      || point.timestamp > endedAt
      || point.timestamp <= latestTimestamp
      || point.speed > MAX_SPEED_MPS
    ) {
      rejectedPoints += 1;
      continue;
    }

    const previous = accepted.at(-1);
    if (previous) {
      const segmentSeconds = (point.timestamp - previous.timestamp) / 1000;
      const segmentDistance = haversineMeters(previous, point);
      const impliedSpeed = segmentSeconds > 0 ? segmentDistance / segmentSeconds : Infinity;
      if (
        segmentSeconds <= 0
        || segmentSeconds > MAX_SEGMENT_SECONDS
        || impliedSpeed > MAX_SPEED_MPS
      ) {
        rejectedPoints += 1;
        continue;
      }
      previous.bearing = bearingDegrees(previous, point);
      point.bearing = previous.bearing;
      distanceMeters += segmentDistance;
      point.cumulativeDistance = distanceMeters;
      if (segmentDistance >= 1 || point.speed >= 0.3) movingSeconds += segmentSeconds;
    }

    latestTimestamp = point.timestamp;
    accuracyTotal += point.accuracy;
    if (point.accuracy <= PREFERRED_ACCURACY_METERS) preferredAccuracyPoints += 1;
    accepted.push(point);
  }

  const durationSeconds = Number.isFinite(startedAt) && Number.isFinite(endedAt)
    ? Math.max(0, Math.floor((endedAt - startedAt) / 1000))
    : 0;
  movingSeconds = Math.min(durationSeconds, Math.round(movingSeconds));
  const averagePace = distanceMeters >= 100
    ? Math.round(movingSeconds / (distanceMeters / 1000))
    : null;
  const averagePaceSeconds = averagePace !== null && averagePace >= 60 && averagePace <= 7200
    ? averagePace
    : null;
  const qualityRatio = rows.length > 0 ? accepted.length / rows.length : 0;
  const rejectionReasons: string[] = [];
  if (distanceMeters < 3000) rejectionReasons.push('distance_below_3km');
  if (accepted.length < 10) rejectionReasons.push('insufficient_quality_points');
  if (qualityRatio < 0.5) rejectionReasons.push('low_quality_ratio');
  if (durationSeconds <= 0 || movingSeconds <= 0) rejectionReasons.push('invalid_duration');
  if (averagePaceSeconds === null) rejectionReasons.push('invalid_pace');

  const matchTrack = distanceMeters > ENDPOINT_MASK_METERS * 2
    ? accepted.filter((point) =>
      point.cumulativeDistance >= ENDPOINT_MASK_METERS
      && point.cumulativeDistance <= distanceMeters - ENDPOINT_MASK_METERS)
    : [];

  return {
    valid: rejectionReasons.length === 0,
    distanceMeters: rounded(distanceMeters),
    durationSeconds,
    movingSeconds,
    averagePaceSeconds,
    totalPoints: rows.length,
    acceptedPoints: accepted.length,
    rejectedPoints,
    averageAccuracyMeters: accepted.length ? rounded(accuracyTotal / accepted.length) : null,
    preferredAccuracyPoints,
    matchTrack,
    rejectionReasons,
  };
}

type Segment = {
  startedAt: number;
  endedAt: number;
  lastCurrent: TrackPoint;
  lastOther: TrackPoint;
  overlapMeters: number;
  distanceTotal: number;
  directionTotal: number;
  accuracyTotal: number;
  samples: number;
};

function finishSegment(segment: Segment | null, paceDeltaRatio: number, otherSessionId: string) {
  if (!segment || segment.samples < 4) return null;
  const overlapSeconds = Math.round((segment.endedAt - segment.startedAt) / 1000);
  if (overlapSeconds < 30 || segment.overlapMeters < 200) return null;

  const averageDistance = segment.distanceTotal / segment.samples;
  const averageDirection = segment.directionTotal / segment.samples;
  const averageAccuracy = segment.accuracyTotal / segment.samples;
  const confidence = (
    Math.min(1, overlapSeconds / 120) * 0.22
    + Math.min(1, segment.overlapMeters / 1000) * 0.23
    + Math.max(0, 1 - averageDistance / MAX_PAIR_DISTANCE_METERS) * 0.20
    + Math.max(0, 1 - averageDirection / MAX_DIRECTION_DELTA) * 0.15
    + Math.max(0, 1 - paceDeltaRatio / MAX_PACE_DELTA_RATIO) * 0.12
    + Math.max(0, 1 - averageAccuracy / MAX_ACCURACY_METERS) * 0.08
  );
  if (confidence < 0.55) return null;

  return {
    other_session_id: otherSessionId,
    confidence: rounded(confidence, 4),
    overlap_seconds: overlapSeconds,
    overlap_meters: rounded(segment.overlapMeters),
    average_distance_meters: rounded(averageDistance),
    average_direction_delta_degrees: rounded(averageDirection),
    pace_delta_ratio: rounded(paceDeltaRatio, 4),
  } satisfies EncounterEvidence;
}

export function detectEncounter(
  current: ValidatedRun,
  other: ValidatedRun,
  otherSessionId: string,
): EncounterEvidence | null {
  if (!current.valid || !other.valid || !current.averagePaceSeconds || !other.averagePaceSeconds) return null;
  const paceDeltaRatio = Math.abs(current.averagePaceSeconds - other.averagePaceSeconds)
    / Math.max(current.averagePaceSeconds, other.averagePaceSeconds);
  if (paceDeltaRatio > MAX_PACE_DELTA_RATIO) return null;

  const first = current.matchTrack;
  const second = other.matchTrack;
  let firstIndex = 0;
  let secondIndex = 0;
  let segment: Segment | null = null;
  let best: EncounterEvidence | null = null;

  const closeSegment = () => {
    const evidence = finishSegment(segment, paceDeltaRatio, otherSessionId);
    if (evidence && (!best || evidence.confidence > best.confidence)) best = evidence;
    segment = null;
  };

  while (firstIndex < first.length && secondIndex < second.length) {
    const currentPoint = first[firstIndex];
    const otherPoint = second[secondIndex];
    const timeDelta = currentPoint.timestamp - otherPoint.timestamp;
    if (Math.abs(timeDelta) > MAX_TIME_DELTA_MS) {
      if (timeDelta < 0) firstIndex += 1;
      else secondIndex += 1;
      continue;
    }

    const distance = haversineMeters(currentPoint, otherPoint);
    const headingDifference = directionDelta(currentPoint.bearing, otherPoint.bearing);
    const matches = distance <= MAX_PAIR_DISTANCE_METERS && headingDifference <= MAX_DIRECTION_DELTA;
    if (!matches) {
      closeSegment();
    } else {
      const continues = segment
        && currentPoint.timestamp - segment.lastCurrent.timestamp <= 15_000
        && otherPoint.timestamp - segment.lastOther.timestamp <= 15_000;
      if (!continues) {
        closeSegment();
        segment = {
          startedAt: currentPoint.timestamp,
          endedAt: currentPoint.timestamp,
          lastCurrent: currentPoint,
          lastOther: otherPoint,
          overlapMeters: 0,
          distanceTotal: 0,
          directionTotal: 0,
          accuracyTotal: 0,
          samples: 0,
        };
      }
      segment!.overlapMeters += segment!.samples > 0
        ? haversineMeters(segment!.lastCurrent, currentPoint)
        : 0;
      segment!.endedAt = currentPoint.timestamp;
      segment!.lastCurrent = currentPoint;
      segment!.lastOther = otherPoint;
      segment!.distanceTotal += distance;
      segment!.directionTotal += headingDifference;
      segment!.accuracyTotal += (currentPoint.accuracy + otherPoint.accuracy) / 2;
      segment!.samples += 1;
    }

    if (timeDelta <= 0) firstIndex += 1;
    if (timeDelta >= 0) secondIndex += 1;
  }
  closeSegment();
  return best;
}
