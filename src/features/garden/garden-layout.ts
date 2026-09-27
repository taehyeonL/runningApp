export type GardenDecoration = { instanceId: string; itemId: string };
export type GardenPlacement = { cell: number; instanceId: string };

/** Local layout only. Inventory ownership and allowed garden size come from the server
 * in production. This never grants an item or access to another person's garden.
 */
export function placeGardenDecoration(
  placements: readonly GardenPlacement[], inventory: readonly GardenDecoration[],
  cellCount: number, targetCell: number, instanceId: string | null,
): GardenPlacement[] {
  if (!Number.isSafeInteger(cellCount) || cellCount < 1
    || !Number.isSafeInteger(targetCell) || targetCell < 0 || targetCell >= cellCount) {
    throw new Error('Placement is outside the unlocked garden.');
  }
  const owned = new Set(inventory.map((item) => item.instanceId));
  if (owned.size !== inventory.length || (instanceId !== null && !owned.has(instanceId))) {
    throw new Error('Decoration must exist once in the inventory.');
  }
  const occupied = new Set<number>();
  const placed = new Set<string>();
  for (const placement of placements) {
    if (!Number.isSafeInteger(placement.cell) || placement.cell < 0 || placement.cell >= cellCount
      || !owned.has(placement.instanceId) || occupied.has(placement.cell) || placed.has(placement.instanceId)) {
      throw new Error('Invalid existing garden layout.');
    }
    occupied.add(placement.cell);
    placed.add(placement.instanceId);
  }
  const result = placements.filter((item) => item.cell !== targetCell && item.instanceId !== instanceId);
  return instanceId === null ? result : [...result, { cell: targetCell, instanceId }];
}
