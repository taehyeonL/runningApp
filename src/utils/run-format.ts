import type { RunListItem } from '../features/running/run-types';

export type VisibilityLabel = '비공개' | '친구 공개' | '프로필 공개' | '매칭 공개';

export const visibilityLabels: Record<RunListItem['visibility'], VisibilityLabel> = {
  private: '비공개',
  friends: '친구 공개',
  profile: '프로필 공개',
  matching: '매칭 공개',
};

export const visibilityOptions = Object.values(visibilityLabels);

export function visibilityFromLabel(label: string): RunListItem['visibility'] {
  const entry = Object.entries(visibilityLabels)
    .find(([, value]) => value === label);
  return (entry?.[0] as RunListItem['visibility']) ?? 'private';
}

export function formatDistance(distanceMeters: number) {
  return (distanceMeters / 1000).toFixed(2);
}

export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function formatPace(secondsPerKilometer: number | null) {
  if (secondsPerKilometer === null || !Number.isFinite(secondsPerKilometer)) return '--\'--"';
  const minutes = Math.floor(secondsPerKilometer / 60);
  const seconds = secondsPerKilometer % 60;
  return `${minutes}'${String(seconds).padStart(2, '0')}"`;
}

export function formatRunDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function currentDateLabel() {
  return new Intl.DateTimeFormat('ko-KR', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

export function runStreak(runs: RunListItem[]) {
  const days = new Set(runs.map((run) => {
    const date = new Date(run.startedAt);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }));
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (days.has(cursor.getTime())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
