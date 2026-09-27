import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertDevTarget, assertTestAccount, canRestore } from './dev-social-test.mjs';

test('fixture refuses other projects and mismatched app targets', () => {
  const dev = 'https://jojaafhbuzahtrdpyzox.supabase.co';
  assert.doesNotThrow(() => assertDevTarget(dev, dev));
  assert.throws(() => assertDevTarget('https://production.supabase.co', dev));
  assert.throws(() => assertDevTarget(dev, 'https://production.supabase.co'));
});
test('both account id and email must match the fixed target', () => {
  const target = { id: 'test-a', email: 'a@example.invalid' };
  assert.doesNotThrow(() => assertTestAccount(target, target));
  assert.throws(() => assertTestAccount({ ...target, id: 'test-b' }, target));
  assert.throws(() => assertTestAccount({ ...target, email: 'b@example.invalid' }, target));
});
test('restore recognizes only its exact synthetic timestamp, not later verification', () => {
  const marker = { enabled: true, source: 'manual_test_not_pass', appliedAgeVerifiedAt: '2026-09-16T12:00:00.000Z' };
  assert.equal(canRestore({ age_verified_at: '2026-09-16T12:00:00+00:00' }, marker), true);
  assert.equal(canRestore({ age_verified_at: '2026-09-17T12:00:00Z' }, marker), false);
  assert.equal(canRestore({ age_verified_at: null }, marker), false);
  assert.equal(canRestore({ age_verified_at: marker.appliedAgeVerifiedAt }, { ...marker, enabled: false }), false);
});
