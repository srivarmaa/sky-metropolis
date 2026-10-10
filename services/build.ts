/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { BuildingType, Grid, TileData } from '../types';
import { BUILDINGS, DEMOLISH_COST } from '../constants';

export interface BuildResult {
  ok: boolean;
  tile?: TileData; // The changed tile, when ok
  cost?: number;
  reason?: string | null; // Why it failed; null when there's simply nothing to do (no message needed)
}

/**
 * What happens when `tool` is used on a tile, given the player's money.
 * `slot` is the co-op player building (they may only change their own plot); null in solo games.
 */
export const tryBuild = (grid: Grid, money: number, x: number, y: number, tool: BuildingType, slot: number | null): BuildResult => {
  const tile = grid[y]?.[x];
  if (!tile) return { ok: false, reason: null };
  if (tile.buildingType === BuildingType.Water) return { ok: false, reason: null };
  if (slot !== null && tile.owner !== slot) return { ok: false, reason: "That land belongs to another city. Build on your own plot." };

  // Bulldoze
  if (tool === BuildingType.None) {
    if (tile.buildingType === BuildingType.None) return { ok: false, reason: null };
    if (money < DEMOLISH_COST) return { ok: false, reason: 'Cannot afford demolition costs.' };
    return { ok: true, tile: { ...tile, buildingType: BuildingType.None }, cost: DEMOLISH_COST };
  }

  // Upgrade an existing road to a roundabout, paying only the difference
  if (tool === BuildingType.Roundabout && tile.buildingType === BuildingType.Road) {
    const cost = BUILDINGS[tool].cost - BUILDINGS[BuildingType.Road].cost;
    if (money < cost) return { ok: false, reason: `Treasury insufficient for a roundabout upgrade ($${cost}).` };
    return { ok: true, tile: { ...tile, buildingType: tool }, cost };
  }

  // Place on empty land
  if (tile.buildingType !== BuildingType.None) return { ok: false, reason: null };
  const config = BUILDINGS[tool];
  if (money < config.cost) return { ok: false, reason: `Treasury insufficient for ${config.name}.` };
  return { ok: true, tile: { ...tile, buildingType: tool }, cost: config.cost };
};
