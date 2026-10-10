/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { BuildingType, Grid } from '../../types';
import { LAKE_SIZE, MAX_PLAYERS, RIVER_WIDTH } from '../../constants';
import { typeFromCode } from '../layoutFile';

/**
 * Co-op world: four square plots in a 2×2 layout, separated by a river that meets in a central lake.
 *
 *   [slot 0] ~~ [slot 1]
 *   ~~~~~ (lake) ~~~~~
 *   [slot 2] ~~ [slot 3]
 *
 * Plots without a player stay empty until someone joins. The layout depends only on the plot size,
 * so clients rebuild it from the size plus the host's tile rows.
 */

export interface Plot { slot: number; x0: number; y0: number; size: number }

export const worldSize = (plotSize: number) => plotSize * 2 + RIVER_WIDTH;

export const plotRects = (plotSize: number): Plot[] =>
  Array.from({ length: MAX_PLAYERS }, (_, slot) => ({
    slot,
    x0: (slot % 2) * (plotSize + RIVER_WIDTH),
    y0: Math.floor(slot / 2) * (plotSize + RIVER_WIDTH),
    size: plotSize,
  }));

const inRiver = (plotSize: number, v: number) => v >= plotSize && v < plotSize + RIVER_WIDTH;
const inLake = (plotSize: number, x: number, y: number) => {
  const lakeStart = plotSize + RIVER_WIDTH / 2 - LAKE_SIZE / 2;
  const inside = (v: number) => v >= lakeStart && v < lakeStart + LAKE_SIZE;
  return inside(x) && inside(y);
};
const isWater = (plotSize: number, x: number, y: number) =>
  inRiver(plotSize, x) || inRiver(plotSize, y) || inLake(plotSize, x, y);

export const plotAt = (plotSize: number, x: number, y: number): number | undefined => {
  if (isWater(plotSize, x, y)) return undefined;
  const col = x < plotSize ? 0 : 1;
  const row = y < plotSize ? 0 : 1;
  return row * 2 + col;
};

export const createCoopWorld = (plotSize: number): Grid => {
  const size = worldSize(plotSize);
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => {
      const owner = plotAt(plotSize, x, y);
      return owner === undefined
        ? { x, y, buildingType: BuildingType.Water }
        : { x, y, buildingType: BuildingType.None, owner };
    })
  );
};

// Rebuild a world from the host's tile rows (see encodeRows); unknown codes become empty land.
// Water stays water unless a bridge spans it.
export const worldFromRows = (plotSize: number, rows: string[]): Grid =>
  createCoopWorld(plotSize).map((row, y) => row.map(tile => {
    const type = typeFromCode(rows[y]?.[tile.x] ?? '.');
    if (tile.buildingType === BuildingType.Water) return type === BuildingType.Bridge ? { ...tile, buildingType: type } : tile;
    return { ...tile, buildingType: type && type !== BuildingType.Water && type !== BuildingType.Bridge ? type : BuildingType.None };
  }));

export interface TilePos { x: number; y: number }

// A straight bridge across the river: its water tiles and the plots on either bank
export interface Crossing { tiles: TilePos[]; a: number; b: number; ends: [TilePos, TilePos] }

/**
 * The river crossing through a clicked river tile, or null if there isn't one there
 * (the lake is too wide to bridge, and bridges can't overlap).
 */
export const riverCrossing = (grid: Grid, plotSize: number, x: number, y: number): Crossing | null => {
  if (grid[y]?.[x]?.buildingType !== BuildingType.Water || inLake(plotSize, x, y)) return null;
  const vertical = inRiver(plotSize, x); // A river running north-south is crossed east-west
  const horizontal = inRiver(plotSize, y);
  if (vertical === horizontal) return null; // Where the two channels meet is the lake

  const span = Array.from({ length: RIVER_WIDTH }, (_, i) => plotSize + i);
  const tiles = vertical ? span.map(sx => ({ x: sx, y })) : span.map(sy => ({ x, y: sy }));
  const ends: [TilePos, TilePos] = vertical
    ? [{ x: plotSize - 1, y }, { x: plotSize + RIVER_WIDTH, y }]
    : [{ x, y: plotSize - 1 }, { x, y: plotSize + RIVER_WIDTH }];

  if (tiles.some(t => grid[t.y]?.[t.x]?.buildingType !== BuildingType.Water)) return null;
  const [ea, eb] = ends.map(e => grid[e.y]?.[e.x]);
  if (!ea || !eb || ea.owner === undefined || eb.owner === undefined || ea.owner === eb.owner) return null;
  return { tiles, a: ea.owner, b: eb.owner, ends };
};

// The centre of a plot in grid coordinates (for name labels and "go to my city")
export const plotCenter = (plotSize: number, slot: number): [number, number] => {
  const p = plotRects(plotSize)[slot];
  return [p.x0 + (p.size - 1) / 2, p.y0 + (p.size - 1) / 2];
};
