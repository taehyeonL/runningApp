import type { DiscoveryCandidate } from './social-types';

const styleLabels: Record<string, string> = {
  consistency_first: '기록보다 꾸준함', quiet_focus: '러닝에 집중',
  weekend_runner: '주말 러너', beginner_friendly: '초보 환영',
};
const intentLabels: Record<string, string> = {
  friends: '친구', running_mate: '러닝 메이트',
  dating_open: '연애도 열어둠', no_preference: '상관없음',
};
const slotLabels: Record<string, string> = {
  weekday_morning: '평일 아침', weekday_evening: '평일 저녁', weekend_morning: '주말 오전',
};
const labels = (values: string[], dictionary: Record<string, string>) =>
  [...new Set(values)].filter((key) => Object.hasOwn(dictionary, key)).map((key) => dictionary[key]);

// Only presents the existing server-safe candidate; never fetches raw runs or decides eligibility.
export function runnerCardPresentation(candidate: DiscoveryCandidate, viewerSlots: string[] = []) {
  const profile = candidate.profile;
  const slots = labels(profile.availabilitySlots, slotLabels);
  const common = labels(profile.availabilitySlots.filter((slot) => viewerSlots.includes(slot)), slotLabels);
  const styles = labels(profile.runningStyleTags, styleLabels);
  const reasons = [...new Set(candidate.reasons.map((reason) => reason.trim()).filter(Boolean))];
  const headline = common.length
    ? `${common[0]}, 러닝 리듬이 겹쳐요`
    : reasons[0] ?? (styles.length ? `${styles[0]} 스타일의 러너예요` : '어떤 러닝을 좋아하는지 알아가요');
  const min = profile.paceMinSeconds;
  const max = profile.paceMaxSeconds;
  const pace = min !== null && max !== null && Number.isFinite(min) && Number.isFinite(max)
    && min > 0 && max > min
    ? `${paceTime(min)}–${paceTime(max)} /km` : '공개된 범위 없음';
  return {
    headline, pace, styles,
    activity: slots.length ? slots.join(' · ') : '공개된 시간대 없음',
    commonActivity: common.length ? common.join(' · ') : null,
    intents: labels(profile.relationshipIntents, intentLabels),
    reasons: reasons.filter((reason) => reason !== headline).slice(0, 3),
  };
}

function paceTime(seconds: number) {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
