export type RunPlan = {
  id: 'easy_30' | 'interval_5k' | 'tempo_10k';
  title: string;
  description: string;
  coachSummary: string;
};

export const runPlans: RunPlan[] = [
  { id: 'easy_30', title: '습관 만들기 · 30분', description: '편안한 대화 페이스로 30분 완주', coachSummary: '무리하지 않는 페이스를 안내해요.' },
  { id: 'interval_5k', title: '5K 향상 인터벌', description: '워밍업 뒤 200m 빠르게 · 1분 회복', coachSummary: '짧은 인터벌과 회복 구간을 안내해요.' },
  { id: 'tempo_10k', title: '10K 템포 러닝', description: '워밍업 뒤 안정적인 템포 유지', coachSummary: '지속 가능한 템포를 안내해요.' },
];

const goalPlans = {
  first_5k: 'easy_30',
  habit: 'easy_30',
  faster_5k: 'interval_5k',
  ten_k: 'tempo_10k',
} as const;

export function recommendedRunPlan(trainingGoal: string | null | undefined) {
  return runPlans.find((plan) => plan.id === goalPlans[trainingGoal as keyof typeof goalPlans]) ?? runPlans[0];
}
