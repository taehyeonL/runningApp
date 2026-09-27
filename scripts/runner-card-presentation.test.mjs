import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runnerCardPresentation } from '../src/features/social/runner-card-presentation.ts';

const candidate = (profile = {}, rest = {}) => ({
  profile: { availabilitySlots: [], runningStyleTags: [], relationshipIntents: [], paceMinSeconds: null, paceMaxSeconds: null, ...profile },
  reasons: [], ...rest,
});
test('only actual shared known time categories become common rhythm', () => {
  const p = runnerCardPresentation(candidate({ availabilitySlots: ['weekday_evening', 'weekday_evening', '21:17'] }), ['weekday_evening', '21:17']);
  assert.equal(p.headline, '평일 저녁, 러닝 리듬이 겹쳐요');
  assert.equal(p.commonActivity, '평일 저녁');
  assert.equal(p.activity, '평일 저녁');
});
test('no overlap or missing data does not invent compatibility', () => {
  const p = runnerCardPresentation(candidate({ availabilitySlots: ['weekend_morning'] }), ['weekday_evening']);
  assert.equal(p.commonActivity, null);
  assert.equal(p.headline, '어떤 러닝을 좋아하는지 알아가요');
  assert.equal(p.activity, '주말 오전');
});
test('server reasons are reused and deduplicated without invented scores', () => {
  const p = runnerCardPresentation(candidate({}, { reasons: [' 페이스가 비슷해요 ', '페이스가 비슷해요', '', '거리도 비슷해요'] }));
  assert.equal(p.headline, '페이스가 비슷해요');
  assert.deepEqual(p.reasons, ['거리도 비슷해요']);
});
test('only valid ranges are shown, not missing or exact single paces', () => {
  assert.equal(runnerCardPresentation(candidate({ paceMinSeconds: 375, paceMaxSeconds: 465 })).pace, '6:15–7:45 /km');
  for (const [min, max] of [[null, 420], [420, null], [420, 420], [450, 400], [NaN, 450], [300, Infinity], [0, 400]]) {
    assert.equal(runnerCardPresentation(candidate({ paceMinSeconds: min, paceMaxSeconds: max })).pace, '공개된 범위 없음');
  }
});
test('style is attributed to the runner, not fabricated as shared', () => {
  const p = runnerCardPresentation(candidate({ runningStyleTags: ['beginner_friendly', 'unknown', 'beginner_friendly'], relationshipIntents: ['dating_open'] }));
  assert.equal(p.headline, '초보 환영 스타일의 러너예요');
  assert.deepEqual(p.styles, ['초보 환영']);
  assert.deepEqual(p.intents, ['연애도 열어둠']);
});
test('presentation does not modify or recalculate server request eligibility', () => {
  const c = candidate({}, { requestEligible: false, repeatEncounters30d: 999, generatedAt: 'private-exact-time' });
  const before = JSON.stringify(c);
  const p = runnerCardPresentation(c);
  assert.equal(JSON.stringify(c), before);
  assert.equal('requestEligible' in p, false);
  assert.equal(JSON.stringify(p).includes('private-exact-time'), false);
});
