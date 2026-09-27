import type { RunListItem } from './run-types';

export function localDayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

// 본인에게 이미 허용된 기록만 사용한다. 서버 업적·매칭 판정을 대신하지 않는다.
export function weeklyRhythm(runs: RunListItem[], today = new Date()) {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + index);
    const completed = runs.filter((run) => run.status === 'completed' && localDayKey(new Date(run.startedAt)) === localDayKey(date));
    return { key: localDayKey(date), label: ['월', '화', '수', '목', '금', '토', '일'][index], today: localDayKey(date) === localDayKey(today), count: completed.length, distance: completed.reduce((sum, run) => sum + run.distanceMeters, 0) };
  });
  return { days, count: days.reduce((sum, day) => sum + day.count, 0), distance: days.reduce((sum, day) => sum + day.distance, 0) };
}

export function filterRunHistory(runs: RunListItem[], period: string, today = new Date()) {
  const week = new Set(weeklyRhythm([], today).days.map((day) => day.key));
  return runs.filter((run) => {
    const date = new Date(run.startedAt);
    if (period === '이번 주') return week.has(localDayKey(date));
    if (period === '이번 달') return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
    return true;
  });
}
