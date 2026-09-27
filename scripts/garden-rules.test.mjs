import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gardenProgress, isGardenZoneEligible, rollDailyGardenReward, rollGardenDrop, selectDailyGardenZone } from '../src/features/garden/garden-rules.ts';
import { gardenGridCell, gardenGridCellId, neighbouringGardenCells, selectDailyGardenGrid } from '../src/features/garden/garden-rules.ts';
import { placeGardenDecoration } from '../src/features/garden/garden-layout.ts';

// Fixture probabilities only, not the release balance.
const policy = { noDropWeight: 70, items: [
  { id: 'flower', rarity: 'common', weight: 25 },
  { id: 'moon_tree', rarity: 'rare', weight: 5 },
] };
const window = { startsAt: 100, endsAt: 200 };
const zone = (id = 'park') => ({
  id, regionId: 'region', kind: 'park', active: true, publicAccess: true, separatedFromTraffic: true,
  safetyReview: { status: 'approved', checkedAt: 50, validUntil: 300 },
  hazards: { status: 'clear', checkedAt: 50, validUntil: 300 },
  accessWindows: [{ startsAt: 80, endsAt: 220 }],
});

test('ordinary drops can award rare items, with exact configured weight coverage', () => {
  const counts = { flower: 0, moon_tree: 0, none: 0 };
  for (let index = 0; index < 1000; index++) counts[rollGardenDrop(policy, () => (index + 0.5) / 1000) ?? 'none']++;
  assert.deepEqual(counts, { flower: 250, moon_tree: 50, none: 700 });
});

test('daily reward uses only rare items also obtainable through ordinary drops', () => {
  for (const sample of [0, 0.25, 0.99]) {
    const reward = rollDailyGardenReward(policy, () => sample);
    assert.equal(reward, 'moon_tree');
    assert.ok(policy.items.some((item) => item.id === reward && item.rarity === 'rare' && item.weight > 0));
  }
});

test('invalid weights, duplicate IDs, absent rare pool and invalid randomness fail closed', () => {
  for (const broken of [
    { ...policy, noDropWeight: -1 },
    { ...policy, items: [policy.items[0]] },
    { ...policy, items: [policy.items[1]] },
    { ...policy, items: [...policy.items, policy.items[0]] },
    { ...policy, items: [{ ...policy.items[0], weight: Infinity }, policy.items[1]] },
  ]) assert.throws(() => rollGardenDrop(broken, () => 0));
  for (const value of [-1, 1, NaN, Infinity]) assert.throws(() => rollGardenDrop(policy, () => value));
});

test('distance carries across runs and garden expands every 42 km', () => {
  assert.equal(gardenProgress(499).dropOpportunities, 0);
  assert.equal(gardenProgress(250 + 250).dropOpportunities, 1);
  assert.equal(gardenProgress(5000).dropOpportunities, 10);
  assert.equal(gardenProgress(41999).expansions, 0);
  assert.equal(gardenProgress(42000).expansions, 1);
  assert.equal(gardenProgress(84000).expansions, 2);
  assert.equal(gardenProgress(42000).metersToNextExpansion, 42000);
  for (const value of [-1, NaN, Infinity]) assert.throws(() => gardenProgress(value));
});

test('all ineligible safety cases are excluded from selection, not merely downweighted', () => {
  const variants = [
    { active: false }, { publicAccess: false }, { separatedFromTraffic: false },
    { kind: 'road' }, { regionId: 'elsewhere' },
    { safetyReview: { status: 'pending', checkedAt: 50, validUntil: 300 } },
    { safetyReview: { status: 'approved', checkedAt: 50, validUntil: 199 } },
    { safetyReview: { status: 'approved', checkedAt: 101, validUntil: 300 } },
    { hazards: { status: 'unknown', checkedAt: 50, validUntil: 300 } },
    { hazards: { status: 'blocked', checkedAt: 50, validUntil: 300 } },
    { hazards: { status: 'clear', checkedAt: 50, validUntil: 199 } },
    { hazards: { status: 'clear', checkedAt: 101, validUntil: 300 } },
    { accessWindows: [] }, { accessWindows: [{ startsAt: 101, endsAt: 200 }] },
    { accessWindows: [{ startsAt: 80, endsAt: 199 }] },
  ];
  for (const variant of variants) {
    const unsafe = { ...zone('unsafe'), ...variant };
    assert.equal(isGardenZoneEligible(unsafe, 'region', window, 100), false);
    assert.equal(selectDailyGardenZone([unsafe, zone('safe')], 'region', window, 100, () => 0), 'safe');
    assert.equal(selectDailyGardenZone([unsafe], 'region', window, 100, () => 0), null);
  }
});

test('eligible zones are uniformly selectable regardless of input order', () => {
  const zones = [zone('b'), zone('a')];
  assert.equal(selectDailyGardenZone(zones, 'region', window, 100, () => 0), 'a');
  assert.equal(selectDailyGardenZone(zones, 'region', window, 100, () => 0.999), 'b');
  assert.throws(() => selectDailyGardenZone([zone(), zone()], 'region', window, 100, () => 0));
  assert.equal(selectDailyGardenZone([], 'region', window, 100, () => { throw Error('must not draw'); }), null);
});

test('selected zone loses eligibility immediately after a hazard change or event expiry', () => {
  const current = zone();
  assert.equal(isGardenZoneEligible(current, 'region', window, 100), true);
  assert.equal(isGardenZoneEligible(current, 'region', window, 200), false);
  current.hazards.status = 'blocked';
  assert.equal(isGardenZoneEligible(current, 'region', window, 101), false);
});

const mappedZone = (id, easting = 1000000, northing = 2000000) => ({
  ...zone(id), placeId: `place-${id}`, allocationAnchor: { easting, northing },
  segment: { id: `segment-${id}`, minimumVerifiedTraversalMeters: 100,
    path: [{ easting, northing }, { easting: easting + 200, northing }] },
});

test('grid boundaries and neighbouring cells are stable in projected metres', () => {
  assert.deepEqual(gardenGridCell({ easting: 2499.99, northing: 2500 }), { column: 0, row: 1 });
  assert.deepEqual(gardenGridCell({ easting: -0.1, northing: 0 }), { column: -1, row: 0 });
  const neighbours = neighbouringGardenCells({ column: 400, row: 800 });
  assert.equal(new Set(neighbours).size, 9);
  assert.ok(neighbours.includes(gardenGridCellId({ column: 400, row: 800 })));
  assert.throws(() => gardenGridCell({ easting: NaN, northing: 0 }));
});

test('one reviewed segment per occupied cell, none for unsafe or invalid segments', () => {
  const safe = mappedZone('a');
  const sameCell = mappedZone('b', 1000100);
  const unsafe = { ...mappedZone('c', 1010000), active: false };
  const invalid = { ...mappedZone('d', 1020000), segment: { id: 'point-only', path: [{ easting: 1020000, northing: 2000000 }], minimumVerifiedTraversalMeters: 100 } };
  const schedule = selectDailyGardenGrid([safe, sameCell, unsafe, invalid], 'region', window, 100, () => 0);
  assert.equal(schedule.length, 3);
  assert.equal(schedule.filter((cell) => cell.zoneId !== null).length, 1);
  assert.equal(schedule.find((cell) => cell.zoneId === 'a').segmentId, 'segment-a');
  assert.deepEqual(selectDailyGardenGrid([invalid, unsafe, sameCell, safe], 'region', window, 100, () => 0), schedule);
});

test('one park spanning a cell boundary is not allocated twice', () => {
  const safe = mappedZone('a');
  // Path may cross cells, but the canonical public-place anchor remains fixed.
  safe.segment.path[1].easting += 5000;
  assert.equal(selectDailyGardenGrid([safe], 'region', window, 100, () => 0).length, 1);
  const conflicting = { ...mappedZone('b', 1010000), placeId: safe.placeId };
  assert.throws(() => selectDailyGardenGrid([safe, conflicting], 'region', window, 100, () => 0));
  assert.throws(() => selectDailyGardenGrid([safe, { ...safe, id: 'elsewhere', regionId: 'another-region' }], 'region', window, 100, () => 0));
});

test('layout moves and replaces items without duplicating or destroying inventory', () => {
  const inventory = [{ instanceId: 'a', itemId: 'flower' }, { instanceId: 'b', itemId: 'tree' }];
  const original = [{ cell: 0, instanceId: 'a' }, { cell: 1, instanceId: 'b' }];
  const moved = placeGardenDecoration(original, inventory, 16, 1, 'a');
  assert.deepEqual(moved, [{ cell: 1, instanceId: 'a' }]);
  assert.equal(original.length, 2);
  assert.equal(inventory.length, 2);
  assert.deepEqual(placeGardenDecoration(moved, inventory, 16, 1, null), []);
  assert.throws(() => placeGardenDecoration(original, inventory, 16, 16, 'a'));
  assert.throws(() => placeGardenDecoration(original, inventory, 16, 2, 'unowned'));
  assert.throws(() => placeGardenDecoration([...original, original[0]], inventory, 16, 2, 'a'));
});
