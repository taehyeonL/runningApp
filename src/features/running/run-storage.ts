import { Platform } from 'react-native';

import { authStorage } from '../../lib/auth-storage';
import type { ActiveRunState } from './run-types';

const ACTIVE_RUN_KEY = 'active-run-v1';
let webValue: string | null = null;
let operation = Promise.resolve();
const listeners = new Set<(state: ActiveRunState | null) => void>();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = operation.then(work, work);
  operation = result.then(() => undefined, () => undefined);
  return result;
}

async function readUnlocked(): Promise<ActiveRunState | null> {
  const raw = Platform.OS === 'web'
    ? webValue
    : await authStorage.getItem(ACTIVE_RUN_KEY);
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as ActiveRunState;
    return value.version === 1 && typeof value.sessionId === 'string' ? value : null;
  } catch {
    return null;
  }
}

async function writeUnlocked(state: ActiveRunState | null) {
  const raw = state ? JSON.stringify(state) : null;
  if (Platform.OS === 'web') {
    // Raw GPS should not remain in browser localStorage after a tab is closed.
    webValue = raw;
  } else if (raw) {
    await authStorage.setItem(ACTIVE_RUN_KEY, raw);
  } else {
    await authStorage.removeItem(ACTIVE_RUN_KEY);
  }
  listeners.forEach((listener) => listener(state));
}

export function readActiveRun() {
  return serialize(readUnlocked);
}

export function replaceActiveRun(state: ActiveRunState | null) {
  return serialize(async () => {
    await writeUnlocked(state);
    return state;
  });
}

export function updateActiveRun(
  update: (state: ActiveRunState | null) => ActiveRunState | null | Promise<ActiveRunState | null>,
) {
  return serialize(async () => {
    const next = await update(await readUnlocked());
    await writeUnlocked(next);
    return next;
  });
}

export function subscribeActiveRun(listener: (state: ActiveRunState | null) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
