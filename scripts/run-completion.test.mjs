import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completionState } from '../src/features/running/completion-state.ts';

const summary = { sessionId: 'run-a', serverStatus: 'processing', distanceMeters: 5100, durationSeconds: 1800, averagePaceSeconds: 353 };
const verified = { id: 'run-a', status: 'completed', distanceMeters: 4800, durationSeconds: 1790, averagePaceSeconds: 373 };
test('server completion replaces stale pending state and client metrics', () => {
  assert.deepEqual(completionState(null, summary, verified), { sessionId: 'run-a', processing: false, distance: 4800, duration: 1790, pace: 373 });
});
test('history screens also refresh pending records', () => {
  assert.equal(completionState({ ...verified, status: 'processing' }, null, verified).processing, false);
});
test('a late response for another run cannot mark this run completed', () => {
  assert.equal(completionState(null, summary, { ...verified, id: 'run-b' }).processing, true);
});
test('no response keeps pending state, never claims verification on failure', () => {
  assert.equal(completionState(null, summary, null).processing, true);
});
test('server null pace does not reuse unverified pace', () => {
  assert.equal(completionState(null, summary, { ...verified, averagePaceSeconds: null }).pace, null);
});
