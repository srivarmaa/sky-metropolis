/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { CityStats } from '../../types';
import { MAX_PLAYERS, PLAYER_COLORS, RIVER_WIDTH } from '../../constants';
import { LAYOUT_FORMAT, tileCode } from '../layoutFile';
import { BuildingType } from '../../types';
import { BridgeInfo } from './protocol';
import { worldSize } from './world';

/**
 * Co-op world files: the whole map plus every player's city, so friends can save a game and
 * continue it later. Same format family as solo layouts, marked `mode: "coop"`.
 */

const COOP_SAVE_VERSION = 2;
const MIN_PLOT = 5;
const MAX_PLOT = 25;

export interface CoopSavePlayer { slot: number; name: string; color: string }

export interface CoopSave {
  plotSize: number;
  day: number;
  rows: string[]; // One character per tile (see layoutFile)
  players: CoopSavePlayer[];
  cities: Record<number, CityStats>;
  bridges: BridgeInfo[];
}

export const serializeCoopSave = (save: CoopSave): string =>
  JSON.stringify({ format: LAYOUT_FORMAT, version: COOP_SAVE_VERSION, mode: 'coop', ...save }, null, 2);

export const downloadCoopSave = (save: CoopSave) => {
  const blob = new Blob([serializeCoopSave(save)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sky-metropolis-coop-day${save.day}-${save.players.length}p.json`;
  a.click();
  URL.revokeObjectURL(url);
};

const isInt = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isCount = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isPos = (p: any, size: number) => p && isInt(p.x, 0, size - 1) && isInt(p.y, 0, size - 1);

// Throws an Error with a player-facing message if the file isn't a valid co-op world
export const parseCoopSave = (text: string): CoopSave => {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a valid world (not JSON).');
  }
  if (data?.format !== LAYOUT_FORMAT) throw new Error('This file is not a SkyMetropolis world.');
  if (data.mode !== 'coop') throw new Error('This is a solo city. Load it from the main menu with Upload Layout.');

  const plotSize = data.plotSize;
  if (!isInt(plotSize, MIN_PLOT, MAX_PLOT)) throw new Error('This world has an unsupported plot size.');
  const size = worldSize(plotSize);
  const rows: unknown[] = Array.isArray(data.rows) ? data.rows : [];
  if (rows.length !== size || rows.some(r => typeof r !== 'string' || r.length !== size)) {
    throw new Error(`The map should be ${size} × ${size} tiles; this file looks damaged.`);
  }

  const players: CoopSavePlayer[] = [];
  for (const p of Array.isArray(data.players) ? data.players : []) {
    if (!isInt(p?.slot, 0, MAX_PLAYERS - 1) || players.some(q => q.slot === p.slot)) continue;
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 16) : `Player ${p.slot + 1}`;
    const color = typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : PLAYER_COLORS[p.slot % PLAYER_COLORS.length];
    players.push({ slot: p.slot, name, color });
  }
  if (players.length === 0) throw new Error('This world has no players.');

  const day = isInt(data.day, 1, 1e9) ? data.day : 1;
  const cities: Record<number, CityStats> = {};
  for (const p of players) {
    const s = data.cities?.[p.slot];
    cities[p.slot] = isCount(s?.money) && isCount(s?.population)
      ? { money: Math.floor(s.money), population: Math.floor(s.population), day }
      : { money: 0, population: 0, day };
  }

  // Keep only bridges that are really on the map
  const bridgeCode = tileCode(BuildingType.Bridge);
  const bridges: BridgeInfo[] = (Array.isArray(data.bridges) ? data.bridges : []).filter((b: any) =>
    b && typeof b.id === 'string'
    && Array.isArray(b.tiles) && b.tiles.length === RIVER_WIDTH && b.tiles.every((t: any) => isPos(t, size) && (rows[t.y] as string)[t.x] === bridgeCode)
    && Array.isArray(b.ends) && b.ends.length === 2 && b.ends.every((e: any) => isPos(e, size))
    && isInt(b.a, 0, MAX_PLAYERS - 1) && isInt(b.b, 0, MAX_PLAYERS - 1) && typeof b.commuting === 'boolean'
  ).map((b: any) => ({ id: b.id, tiles: b.tiles.map((t: any) => ({ x: t.x, y: t.y })), ends: b.ends.map((e: any) => ({ x: e.x, y: e.y })), a: b.a, b: b.b, commuting: b.commuting }));

  return { plotSize, day, rows: rows as string[], players, cities, bridges };
};
