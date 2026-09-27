/** Pure rules only: server integration must provide trusted distance, safety data and RNG.
 * These functions do not authorize a visit, verify GPS, or issue inventory items.
 */
export const GARDEN_DROP_INTERVAL_METERS = 500;
export const GARDEN_EXPANSION_INTERVAL_METERS = 42_000;

export type GardenItem = {
  id: string;
  rarity: 'common' | 'rare';
  weight: number;
};

export type GardenDropPolicy = {
  // An explicit policy is required; production probabilities are not chosen by the UI.
  noDropWeight: number;
  items: readonly GardenItem[];
};

function unitSample(random: () => number) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('Random sample must be in [0, 1).');
  }
  return value;
}

function validatedItems(policy: GardenDropPolicy) {
  if (!Number.isFinite(policy.noDropWeight) || policy.noDropWeight < 0) {
    throw new Error('No-drop weight must be finite and non-negative.');
  }
  const ids = new Set<string>();
  for (const item of policy.items) {
    if (!item.id.trim() || ids.has(item.id) || !['common', 'rare'].includes(item.rarity)
      || !Number.isFinite(item.weight) || item.weight <= 0) {
      throw new Error('Items must have unique IDs, a valid rarity and positive finite weights.');
    }
    ids.add(item.id);
  }
  if (!policy.items.some((item) => item.rarity === 'common')
    || !policy.items.some((item) => item.rarity === 'rare')) {
    throw new Error('Ordinary drops must include both common and rare items.');
  }
  const total = policy.items.reduce((sum, item) => sum + item.weight, policy.noDropWeight);
  if (!Number.isFinite(total)) throw new Error('Total weight must be finite.');
  return policy.items;
}

function weightedItem(items: readonly GardenItem[], noDropWeight: number, random: () => number) {
  const total = items.reduce((sum, item) => sum + item.weight, noDropWeight);
  let ticket = unitSample(random) * total;
  for (const item of items) {
    if (ticket < item.weight) return item.id;
    ticket -= item.weight;
  }
  return null;
}

/** Every ordinary 500 m chance includes the same rare pool used by daily zones. */
export function rollGardenDrop(policy: GardenDropPolicy, random: () => number): string | null {
  return weightedItem(validatedItems(policy), policy.noDropWeight, random);
}

/** Daily-zone reward guarantees a rare item; it is not exclusive to that place. */
export function rollDailyGardenReward(policy: GardenDropPolicy, random: () => number): string {
  const rare = validatedItems(policy).filter((item) => item.rarity === 'rare');
  const result = weightedItem(rare, 0, random);
  if (result === null) throw new Error('Rare reward could not be selected.');
  return result;
}

function distanceMilestones(distanceMeters: number, interval: number) {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0 || distanceMeters > Number.MAX_SAFE_INTEGER) {
    throw new Error('Distance must be a non-negative, finite safe number.');
  }
  return Math.floor(distanceMeters / interval);
}

/** Server-counted lifetime distance; carries partial 500 m across runs. */
export function gardenProgress(verifiedLifetimeMeters: number) {
  const dropOpportunities = distanceMilestones(verifiedLifetimeMeters, GARDEN_DROP_INTERVAL_METERS);
  const expansions = distanceMilestones(verifiedLifetimeMeters, GARDEN_EXPANSION_INTERVAL_METERS);
  return {
    dropOpportunities,
    expansions,
    metersToNextDrop: GARDEN_DROP_INTERVAL_METERS - verifiedLifetimeMeters % GARDEN_DROP_INTERVAL_METERS,
    metersToNextExpansion: GARDEN_EXPANSION_INTERVAL_METERS - verifiedLifetimeMeters % GARDEN_EXPANSION_INTERVAL_METERS,
  };
}

export type RewardWindow = { startsAt: number; endsAt: number };
export type GardenZone = {
  id: string;
  regionId: string;
  kind: 'park' | 'running_track' | 'pedestrian_trail';
  active: boolean;
  publicAccess: boolean;
  separatedFromTraffic: boolean;
  safetyReview: { status: 'approved' | 'rejected' | 'pending'; checkedAt: number; validUntil: number };
  // Reviewed opening/daylight windows, in absolute timestamps, not inferred from a map label.
  accessWindows: readonly RewardWindow[];
  hazards: { status: 'clear' | 'blocked' | 'unknown'; checkedAt: number; validUntil: number };
};

function validWindow(window: RewardWindow) {
  return Number.isFinite(window.startsAt) && Number.isFinite(window.endsAt) && window.startsAt < window.endsAt;
}

/** All candidate selection and subsequent rechecks must call this one predicate.
 * Approval is evidence provided by operators/data feeds, not a guarantee of physical safety.
 */
export function isGardenZoneEligible(zone: GardenZone, regionId: string, window: RewardWindow, now: number) {
  return validWindow(window) && Number.isFinite(now) && now < window.endsAt
    && zone.id.trim().length > 0 && regionId.trim().length > 0 && zone.regionId === regionId
    && ['park', 'running_track', 'pedestrian_trail'].includes(zone.kind)
    && zone.active === true && zone.publicAccess === true && zone.separatedFromTraffic === true
    && zone.safetyReview.status === 'approved'
    && Number.isFinite(zone.safetyReview.checkedAt) && zone.safetyReview.checkedAt <= now
    && Number.isFinite(zone.safetyReview.validUntil) && zone.safetyReview.validUntil >= window.endsAt
    && zone.hazards.status === 'clear'
    && Number.isFinite(zone.hazards.checkedAt) && zone.hazards.checkedAt <= now
    && Number.isFinite(zone.hazards.validUntil) && zone.hazards.validUntil >= window.endsAt
    && zone.accessWindows.some((access) => validWindow(access)
      && access.startsAt <= window.startsAt && access.endsAt >= window.endsAt);
}

/** Call once per region/day/window and persist on the server with a unique key.
 * Never reroll on app refresh, and never substitute an unreviewed zone when empty.
 */
export function selectDailyGardenZone(
  zones: readonly GardenZone[], regionId: string, window: RewardWindow, now: number, random: () => number,
): string | null {
  const ids = new Set<string>();
  for (const zone of zones) {
    if (ids.has(zone.id)) throw new Error('Duplicate zone IDs are not allowed.');
    ids.add(zone.id);
  }
  const eligible = zones.filter((zone) => isGardenZoneEligible(zone, regionId, window, now))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return eligible.length ? eligible[Math.floor(unitSample(random) * eligible.length)].id : null;
}

// Provisional allocation size, not a GPS privacy grid or a reward geofence.
export const GARDEN_ALLOCATION_GRID = Object.freeze({ crs: 'EPSG:5179', cellSizeMeters: 2500 });
export type GardenGridCell = { column: number; row: number };
export type GardenMapPoint = { easting: number; northing: number };

function assertMapPoint(point: GardenMapPoint) {
  if (!Number.isFinite(point.easting) || !Number.isFinite(point.northing)
    || Math.abs(point.easting) > Number.MAX_SAFE_INTEGER / 2
    || Math.abs(point.northing) > Number.MAX_SAFE_INTEGER / 2) {
    throw new Error('Expected finite projected metre coordinates, not GPS degrees.');
  }
}

/** Input is a curated public-place anchor transformed to EPSG:5179 by ingestion.
 * Never call this with a runner's home, start/end point or raw latitude/longitude.
 */
export function gardenGridCell(point: GardenMapPoint): GardenGridCell {
  assertMapPoint(point);
  return {
    column: Math.floor(point.easting / GARDEN_ALLOCATION_GRID.cellSizeMeters),
    row: Math.floor(point.northing / GARDEN_ALLOCATION_GRID.cellSizeMeters),
  };
}

export function gardenGridCellId(cell: GardenGridCell) {
  if (!Number.isSafeInteger(cell.column) || !Number.isSafeInteger(cell.row)) {
    throw new Error('Grid indices must be safe integers.');
  }
  return `5179:${GARDEN_ALLOCATION_GRID.cellSizeMeters}:${cell.column}:${cell.row}`;
}

/** Include eight neighbours so a cell boundary does not hide a nearby reward. */
export function neighbouringGardenCells(cell: GardenGridCell): string[] {
  gardenGridCellId(cell);
  return [-1, 0, 1].flatMap((column) => [-1, 0, 1].map((row) =>
    gardenGridCellId({ column: cell.column + column, row: cell.row + row })));
}

export type MappedGardenZone = GardenZone & {
  // Same park/track has one canonical ID and anchor even if it spans several cells.
  placeId: string;
  allocationAnchor: GardenMapPoint;
  segment: {
    id: string;
    // Curated public running path, never a user's recorded route.
    path: readonly GardenMapPoint[];
    minimumVerifiedTraversalMeters: number;
  };
};

function hasValidGardenSegment(zone: MappedGardenZone) {
  const { path, minimumVerifiedTraversalMeters } = zone.segment;
  if (!zone.segment.id.trim() || path.length < 2 || !Number.isFinite(minimumVerifiedTraversalMeters)
    || minimumVerifiedTraversalMeters <= 0) return false;
  try { path.forEach(assertMapPoint); } catch { return false; }
  const length = path.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.easting - path[index].easting, point.northing - path[index].northing), 0);
  return Number.isFinite(length) && length >= minimumVerifiedTraversalMeters;
}

export type GardenCellSelection = {
  cellId: string;
  zoneId: string | null;
  segmentId: string | null;
};

/** Build once and persist as a region/date schedule. Does not issue rewards.
 * Blank cells remain blank; safe-place density is not fabricated.
 */
export function selectDailyGardenGrid(
  zones: readonly MappedGardenZone[], regionId: string, window: RewardWindow,
  now: number, random: () => number,
): GardenCellSelection[] {
  const placeCells = new Map<string, string>();
  const placeRegions = new Map<string, string>();
  const uniqueZones = new Set<string>();
  const groups = new Map<string, MappedGardenZone[]>();
  for (const zone of zones) {
    if (!zone.placeId.trim() || uniqueZones.has(zone.id)) throw new Error('Unique zone and non-empty place IDs are required.');
    uniqueZones.add(zone.id);
    const cellId = gardenGridCellId(gardenGridCell(zone.allocationAnchor));
    const existingCell = placeCells.get(zone.placeId);
    if (existingCell && existingCell !== cellId) throw new Error('One place must have one canonical allocation cell.');
    if (placeRegions.has(zone.placeId) && placeRegions.get(zone.placeId) !== zone.regionId) {
      throw new Error('One place must belong to one allocation region.');
    }
    placeCells.set(zone.placeId, cellId);
    placeRegions.set(zone.placeId, zone.regionId);
    if (zone.regionId !== regionId) continue;
    if (!groups.has(cellId)) groups.set(cellId, []);
    if (hasValidGardenSegment(zone)) groups.get(cellId)!.push(zone);
  }
  return [...groups.keys()].sort().map((cellId) => {
    const candidates = groups.get(cellId)!;
    const zoneId = selectDailyGardenZone(candidates, regionId, window, now, random);
    return { cellId, zoneId, segmentId: candidates.find((zone) => zone.id === zoneId)?.segment.id ?? null };
  });
}
