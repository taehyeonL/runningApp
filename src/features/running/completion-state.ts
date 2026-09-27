import type { RunListItem, RunSummary } from './run-types';

/** A server snapshot must belong to this screen's run; old screens never override it. */
export function completionState(selected: RunListItem | null, summary: RunSummary | null, latest: RunListItem | null) {
  const sessionId = selected?.id ?? summary?.sessionId ?? null;
  const server = latest?.id === sessionId ? latest : null;
  const current = server ?? selected;
  return {
    sessionId,
    processing: current ? current.status !== 'completed' : summary?.serverStatus === 'processing',
    distance: current?.distanceMeters ?? summary?.distanceMeters ?? 0,
    duration: current?.durationSeconds ?? summary?.durationSeconds ?? 0,
    // A null server pace is meaningful, not permission to reuse a client estimate.
    pace: current ? current.averagePaceSeconds : summary?.averagePaceSeconds ?? null,
  };
}
