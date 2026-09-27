import assert from 'node:assert/strict';
import { test } from 'node:test';
import { growthStage, growthIcon } from '../src/features/garden/garden-presentation.ts';
test('growth stages include the exact quarter boundaries and completion', () => {
  assert.deepEqual([0,24,25,49,50,74,75,99,100].map(growthStage),[0,0,1,1,2,2,3,3,4]);
});
test('invalid and out-of-range progress renders safely', () => {
  assert.equal(growthStage(NaN),0); assert.equal(growthStage(-1),0); assert.equal(growthStage(120),4);
});
test('mature artwork appears only in the completed stage', () => {
  assert.equal(growthIcon(4,'🌻'),'🌻'); assert.equal(growthIcon(0,'🌻'),'🟤'); assert.equal(growthIcon(1,'🌻'),'🌱');
});
