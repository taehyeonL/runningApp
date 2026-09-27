import { useCallback, useEffect, useRef, useState } from 'react';

import type { RunRecorderController } from './use-run-recorder';
import type { RunPlan } from '../features/running/run-plans';

type CoachPhase = 'off' | 'warmup' | 'fast' | 'recovery';

// 오디오 네이티브 모듈은 Expo Go·웹에서 import 자체가 앱을 멈출 수 있어, 실제로
// 음성을 낼 때만 불러온다. 이 코치는 의료 판단이 아니라 페이스 기반 운동 안내다.
async function speak(message: string) {
  try {
    const Speech = await import('expo-speech');
    Speech.stop();
    Speech.speak(message, { language: 'ko-KR', rate: 0.95, useApplicationAudioSession: false });
  } catch {
    // 음성 엔진이 없는 환경에서는 화면 안내만 유지한다.
  }
}

export function useRunCoach(activeRun: RunRecorderController['activeRun'], metrics: RunRecorderController['metrics'], plan: RunPlan | null, usualPaceSeconds: number | null = null) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<CoachPhase>('off');
  const phaseStartedAt = useRef<number | null>(null);
  const fastStartedDistance = useRef<number | null>(null);
  const lastAdjustmentAt = useRef(0);

  const disable = useCallback(() => {
    setEnabled(false);
    setPhase('off');
    phaseStartedAt.current = null;
    fastStartedDistance.current = null;
    void import('expo-speech').then((Speech) => Speech.stop()).catch(() => undefined);
  }, []);

  const toggle = useCallback((next: boolean) => {
    if (!next) {
      disable();
      return;
    }
    setEnabled(true);
    setPhase('warmup');
    phaseStartedAt.current = Date.now();
    const paceHint = usualPaceSeconds ? `평소 페이스는 ${Math.floor(usualPaceSeconds / 60)}분 ${usualPaceSeconds % 60}초예요. ` : '';
    void speak(`${plan?.title ?? '계획'} 코칭을 시작합니다. ${paceHint}처음 600미터는 편안하게 워밍업해요.`);
  }, [disable, plan?.title, usualPaceSeconds]);

  useEffect(() => {
    if (!activeRun) disable();
  }, [activeRun, disable]);

  useEffect(() => {
    if (!enabled || !plan || !activeRun || activeRun.status !== 'recording') return;
    if (plan.id === 'easy_30') {
      if (metrics.elapsedSeconds >= 1_800) { void speak('30분 목표를 완료했어요. 천천히 정리 운동을 해주세요.'); disable(); }
      return;
    }
    if (phase === 'warmup' && metrics.distanceMeters >= 600) {
      setPhase('fast');
      fastStartedDistance.current = metrics.distanceMeters;
      phaseStartedAt.current = Date.now();
      void speak(plan.id === 'tempo_10k' ? '워밍업 완료. 숨은 차지만 유지할 수 있는 템포로 달려볼게요.' : '워밍업 완료. 지금부터 200미터는 조금 빠르게 달려볼게요. 호흡은 무리하지 마세요.');
      return;
    }
    if (plan.id === 'interval_5k' && phase === 'fast' && metrics.distanceMeters - (fastStartedDistance.current ?? metrics.distanceMeters) >= 200) {
      setPhase('recovery');
      phaseStartedAt.current = Date.now();
      void speak('좋아요. 이제 1분 동안 천천히 회복 조깅으로 전환합니다.');
      return;
    }
    if (phase === 'recovery' && Date.now() - (phaseStartedAt.current ?? Date.now()) >= 60_000) {
      setPhase('fast');
      fastStartedDistance.current = metrics.distanceMeters;
      phaseStartedAt.current = Date.now();
      void speak('회복 완료. 다음 200미터를 다시 조금 빠르게 달려볼게요.');
      return;
    }
    if (phase === 'fast' && metrics.averagePaceSeconds && Date.now() - lastAdjustmentAt.current >= 45_000) {
      lastAdjustmentAt.current = Date.now();
      void speak('현재 페이스를 유지하되, 통증이나 어지러움이 있으면 바로 속도를 낮추거나 멈추세요.');
    }
  }, [activeRun, disable, enabled, metrics.averagePaceSeconds, metrics.distanceMeters, metrics.elapsedSeconds, phase, plan]);

  return { enabled, phase, toggle, disable };
}

export type RunCoachController = ReturnType<typeof useRunCoach>;
