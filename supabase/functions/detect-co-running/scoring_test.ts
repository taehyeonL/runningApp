import { assert, assertEquals } from 'jsr:@std/assert@1';

import { detectEncounter, type LocationPointRow, type SessionRow, validateRun } from './scoring.ts';

function session(id: string, userId: string): SessionRow {
  return {
    id,
    user_id: userId,
    status: 'completed',
    started_at: '2026-08-12T00:00:00.000Z',
    ended_at: '2026-08-12T00:20:00.000Z',
    duration_seconds: 1200,
    distance_meters: 0,
    average_pace_seconds: null,
  };
}

function track(latitudeOffset = 0, reverse = false): LocationPointRow[] {
  const points = Array.from({ length: 121 }, (_, index) => ({
    recorded_at: new Date(Date.parse('2026-08-12T00:00:00.000Z') + index * 10_000).toISOString(),
    latitude: 37.5 + latitudeOffset,
    longitude: 127 + index * 0.0003,
    accuracy_meters: 8,
    speed_mps: 1.1,
  }));
  return reverse ? points.map((point, index) => ({ ...point, longitude: 127 + (120 - index) * 0.0003 })) : points;
}

Deno.test('validates a quality 3km run and masks endpoints', () => {
  const validated = validateRun(session('a', 'u1'), track());
  assert(validated.valid);
  assert(validated.distanceMeters >= 3000);
  assert(validated.matchTrack.length < validated.acceptedPoints);
});

Deno.test('rejects low accuracy points', () => {
  const rows = track().map((point) => ({ ...point, accuracy_meters: 45 }));
  const validated = validateRun(session('a', 'u1'), rows);
  assertEquals(validated.valid, false);
  assertEquals(validated.acceptedPoints, 0);
});

Deno.test('detects sustained same-direction overlap', () => {
  const first = validateRun(session('a', 'u1'), track());
  const second = validateRun(session('b', 'u2'), track(0.00005));
  const evidence = detectEncounter(first, second, 'b');
  assert(evidence);
  assert(evidence.overlap_seconds >= 30);
  assert(evidence.average_distance_meters <= 35);
});

Deno.test('rejects opposite-direction crossing', () => {
  const first = validateRun(session('a', 'u1'), track());
  const second = validateRun(session('b', 'u2'), track(0.00005, true));
  assertEquals(detectEncounter(first, second, 'b'), null);
});
