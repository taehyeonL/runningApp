export type RunnerAchievementCode = 'beginner' | 'consistent' | 'hardcore' | 'distance_100' | 'veteran';

export const runnerAchievements: Record<RunnerAchievementCode, { icon: string; title: string; description: string }> = {
  beginner: { icon: '🌱', title: '러닝 초심자', description: '첫 목표를 정하고 달리기를 시작했어요.' },
  consistent: { icon: '🔥', title: '꾸준한 러너', description: '최근 30일에 6일 이상, 총 10회 이상 완주했어요.' },
  hardcore: { icon: '⚡', title: '하드코어 러너', description: '20회 이상 완주하고 빠른 리듬을 꾸준히 유지했어요.' },
  distance_100: { icon: '💯', title: '100km 달성', description: '검증을 마친 누적 100km를 달성했어요.' },
  veteran: { icon: '🏅', title: '러닝 베테랑', description: '검증을 마친 러닝을 50회 이상 완주했어요.' },
};

export function achievementInfo(code: string | null | undefined) {
  return runnerAchievements[code as RunnerAchievementCode] ?? runnerAchievements.beginner;
}
