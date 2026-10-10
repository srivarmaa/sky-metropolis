/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { BuildingType, CityStats, Grid } from '../types';

export const GRID_SIZE_OPTIONS = [10, 20, 30, 40, 50];
const MIN_GRID_SIZE = 5;
const MAX_GRID_SIZE = 60;
export const LAYOUT_FORMAT = 'sky-metropolis-layout';
const LAYOUT_VERSION = 1;

// One character per tile keeps saved files small and readable/editable by hand
const TILE_CODES: Record<BuildingType, string> = {
  [BuildingType.None]: '.',
  [BuildingType.Road]: 'R',
  [BuildingType.Roundabout]: 'O',
  [BuildingType.Residential]: 'H',
  [BuildingType.Commercial]: 'C',
  [BuildingType.Industrial]: 'I',
  [BuildingType.Park]: 'P',
  [BuildingType.Water]: '~',
  [BuildingType.Bridge]: 'B',
};
const CODE_TO_TYPE = Object.fromEntries(
  Object.entries(TILE_CODES).map(([type, code]) => [code, type as BuildingType])
) as Record<string, BuildingType>;

// Compact row strings (one character per tile), also used to send co-op worlds over the network
export const encodeRows = (grid: Grid): string[] => grid.map(row => row.map(tile => TILE_CODES[tile.buildingType]).join(''));
export const tileCode = (type: BuildingType) => TILE_CODES[type];
export const typeFromCode = (code: string): BuildingType | undefined => CODE_TO_TYPE[code];

export interface SavedLayout {
  grid: Grid;
  stats: CityStats | null;
}

export const createEmptyGrid = (size: number): Grid =>
  Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({ x, y, buildingType: BuildingType.None }))
  );

export const serializeLayout = (grid: Grid, stats: CityStats): string =>
  JSON.stringify({
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    gridSize: grid.length,
    stats,
    rows: encodeRows(grid),
    legend: Object.fromEntries(Object.entries(TILE_CODES).map(([type, code]) => [code, type])),
  }, null, 2);

const isCount = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

// Throws an Error with a player-facing message if the file isn't a valid layout
export const parseLayout = (text: string): SavedLayout => {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a valid layout (not JSON).');
  }
  if (data?.format !== LAYOUT_FORMAT || !Array.isArray(data.rows)) {
    throw new Error('This file is not a SkyMetropolis layout.');
  }
  if (data.mode === 'coop') {
    throw new Error('This is a co-op world. Load it from Play with Friends → Host a room.');
  }

  const rows: unknown[] = data.rows;
  const size = rows.length;
  if (size < MIN_GRID_SIZE || size > MAX_GRID_SIZE) {
    throw new Error(`Layout size must be between ${MIN_GRID_SIZE} and ${MAX_GRID_SIZE} tiles.`);
  }

  const grid: Grid = rows.map((row, y) => {
    if (typeof row !== 'string' || row.length !== size) {
      throw new Error(`Row ${y + 1} should be ${size} tiles long.`);
    }
    return Array.from(row, (code, x) => {
      const buildingType = CODE_TO_TYPE[code];
      if (!buildingType) throw new Error(`Unknown tile "${code}" at row ${y + 1}, column ${x + 1}.`);
      return { x, y, buildingType };
    });
  });

  const s = data.stats;
  const stats = s && isCount(s.money) && isCount(s.population) && isCount(s.day)
    ? { money: Math.floor(s.money), population: Math.floor(s.population), day: Math.max(1, Math.floor(s.day)) }
    : null;

  return { grid, stats };
};

export const downloadLayout = (grid: Grid, stats: CityStats) => {
  const blob = new Blob([serializeLayout(grid, stats)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sky-metropolis-day${stats.day}-${grid.length}x${grid.length}.json`;
  a.click();
  URL.revokeObjectURL(url);
};
