/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { AssetTier, BuildingType, Grid, PlacedMonument, TileData } from '../types';
import { BUILDINGS, DEMOLISH_COST } from '../constants';
import { monumentStats, rotateFootprint } from './assets/spec';
import { isRoadAt } from './roads';

export interface BuildResult {
  ok: boolean;
  tile?: TileData; // The changed tile, when ok (single-tile builds)
  tiles?: TileData[]; // All changed tiles (multi-tile builds and demolitions)
  cost?: number;
  reason?: string | null; // Why it failed; null when there's simply nothing to do (no message needed)
}

// Empty land again (keeps the plot owner, drops any monument details)
const clearTile = (t: TileData): TileData => ({ x: t.x, y: t.y, buildingType: BuildingType.None, ...(t.owner !== undefined ? { owner: t.owner } : {}) });

// --- Multi-tile footprints ---

export const footprintTiles = (x: number, y: number, footprint: [number, number]) =>
  Array.from({ length: footprint[0] * footprint[1] }, (_, i) => ({ x: x + (i % footprint[0]), y: y + Math.floor(i / footprint[0]) }));

// The anchor (top-left) tile of whatever monument covers this tile
export const monumentAnchor = (grid: Grid, tile: TileData): TileData | undefined => {
  if (tile.buildingType !== BuildingType.Monument) return undefined;
  return tile.anchor ? grid[tile.anchor.y]?.[tile.anchor.x] : tile;
};

// A road next to any tile of the footprint
export const footprintHasRoad = (grid: Grid, x: number, y: number, footprint: [number, number]) => {
  const inside = (tx: number, ty: number) => tx >= x && tx < x + footprint[0] && ty >= y && ty < y + footprint[1];
  return footprintTiles(x, y, footprint).some(t =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inside(t.x + dx, t.y + dy) && isRoadAt(grid, t.x + dx, t.y + dy)));
};

// Why a footprint can't go here (land only; money is checked separately), or null if it fits
export const placementProblem = (grid: Grid, x: number, y: number, footprint: [number, number], slot: number | null): string | null => {
  for (const t of footprintTiles(x, y, footprint)) {
    const tile = grid[t.y]?.[t.x];
    if (!tile) return 'It doesn\'t fit there: part of it is off the map.';
    if (tile.buildingType === BuildingType.Water || tile.buildingType === BuildingType.Bridge) return 'It doesn\'t fit there: part of it is over water.';
    if (slot !== null && tile.owner !== slot) return 'It doesn\'t fit there: part of it is on another city\'s land.';
    if (tile.buildingType !== BuildingType.None) return 'It doesn\'t fit there: every tile it covers must be empty.';
  }
  if (!footprintHasRoad(grid, x, y, footprint)) return 'Monuments need a road next to them. Build a road beside it first.';
  return null;
};

export interface MonumentPlacement {
  assetId: string;
  name: string;
  tier: AssetTier;
  footprint: [number, number]; // As designed (before rotation)
  rotation: number; // Quarter turns
}

// Place a monument with its top-left corner at (x, y)
export const tryBuildMonument = (grid: Grid, money: number, x: number, y: number, m: MonumentPlacement, slot: number | null): BuildResult => {
  const rotation = ((m.rotation % 4) + 4) % 4;
  const footprint = rotateFootprint(m.footprint, rotation);
  const problem = placementProblem(grid, x, y, footprint, slot);
  if (problem) return { ok: false, reason: problem };
  const { cost } = monumentStats(m.tier, footprint);
  if (money < cost) return { ok: false, reason: `Treasury insufficient for ${m.name} ($${cost.toLocaleString()}).` };

  const placed: PlacedMonument = { assetId: m.assetId, name: m.name, tier: m.tier, footprint, rotation };
  const tiles = footprintTiles(x, y, footprint).map(t => {
    const tile = grid[t.y][t.x];
    return t.x === x && t.y === y
      ? { ...clearTile(tile), buildingType: BuildingType.Monument, monument: placed }
      : { ...clearTile(tile), buildingType: BuildingType.Monument, anchor: { x, y } };
  });
  return { ok: true, tiles, tile: tiles[0], cost };
};

/**
 * What happens when `tool` is used on a tile, given the player's money.
 * `slot` is the co-op player building (they may only change their own plot); null in solo games.
 * (Monuments are placed with tryBuildMonument.)
 */
export const tryBuild = (grid: Grid, money: number, x: number, y: number, tool: BuildingType, slot: number | null): BuildResult => {
  const tile = grid[y]?.[x];
  if (!tile) return { ok: false, reason: null };
  if (tile.buildingType === BuildingType.Water) return { ok: false, reason: null };
  if (slot !== null && tile.owner !== slot) return { ok: false, reason: "That land belongs to another city. Build on your own plot." };

  // Bulldoze (a monument goes all at once, whichever of its tiles you click)
  if (tool === BuildingType.None) {
    if (tile.buildingType === BuildingType.None) return { ok: false, reason: null };
    if (money < DEMOLISH_COST) return { ok: false, reason: 'Cannot afford demolition costs.' };
    const anchor = monumentAnchor(grid, tile);
    if (anchor?.monument) {
      const tiles = footprintTiles(anchor.x, anchor.y, anchor.monument.footprint)
        .map(t => grid[t.y]?.[t.x])
        .filter((t): t is TileData => !!t && (t === anchor || (t.anchor?.x === anchor.x && t.anchor?.y === anchor.y)))
        .map(clearTile);
      return { ok: true, tiles, tile: tiles[0], cost: DEMOLISH_COST };
    }
    const cleared = clearTile(tile);
    return { ok: true, tile: cleared, tiles: [cleared], cost: DEMOLISH_COST };
  }

  if (tool === BuildingType.Monument) return { ok: false, reason: 'Pick a monument from your asset library first.' };

  // Upgrade an existing road to a roundabout, paying only the difference
  if (tool === BuildingType.Roundabout && tile.buildingType === BuildingType.Road) {
    const cost = BUILDINGS[tool].cost - BUILDINGS[BuildingType.Road].cost;
    if (money < cost) return { ok: false, reason: `Treasury insufficient for a roundabout upgrade ($${cost}).` };
    const upgraded = { ...tile, buildingType: tool };
    return { ok: true, tile: upgraded, tiles: [upgraded], cost };
  }

  // Place on empty land
  if (tile.buildingType !== BuildingType.None) return { ok: false, reason: null };
  const config = BUILDINGS[tool];
  if (money < config.cost) return { ok: false, reason: `Treasury insufficient for ${config.name}.` };
  const placed = { ...tile, buildingType: tool };
  return { ok: true, tile: placed, tiles: [placed], cost: config.cost };
};
