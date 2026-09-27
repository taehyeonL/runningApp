import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderEvidence } from './operator-evidence.mjs';

test('operator sees all newly captured profile fields and no arbitrary private fields', () => {
  const output = renderEvidence([{ kind: 'profile', snapshot_status: 'captured', nickname: '러너', bio: '당시 소개', conversation_preference: 'quiet', preferred_distance: '5k', running_style_tags: ['꾸준함'], relationship_intents: ['러닝 메이트'], captured_at: '2026-09-24T00:00:00Z', matching_gender: 'private-secret' }]);
  for (const expected of ['당시 소개','러닝 집중','5km 정도','꾸준함','러닝 메이트','2026-09-24']) assert.ok(output.includes(expected));
  assert.ok(!output.includes('private-secret'));
});
test('old, empty and unavailable snapshots are distinguished', () => {
  assert.match(renderEvidence([{kind:'profile',nickname:'러너'}]), /구버전 증거: 수집하지 않음/);
  assert.match(renderEvidence([{kind:'profile',bio:''}]), /비어 있음/);
  const unavailable = renderEvidence([{kind:'profile',snapshot_status:'unavailable',bio:'must not render'}]);
  assert.match(unavailable, /조회 불가/); assert.ok(!unavailable.includes('must not render'));
  assert.match(renderEvidence([]), /없음/);
  assert.match(renderEvidence([null]), /알 수 없는/);
});
test('user evidence cannot send terminal escape or bidi controls', () => {
  const output = renderEvidence([{kind:'profile',nickname:'러너\u001b[2J',bio:'소개\u001b]52;c;data\u0007\u202e끝'}, {kind:'message',body:'메시지\u009b31m',sent_at:'2026-09-24'}]);
  assert.ok(!/[\u001b\u0007\u009b\u202e]/.test(output));
  assert.match(output, /메시지/);
});
