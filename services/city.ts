/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { AssetTier, BuildingType, Grid, TileData } from '../types';
import { getHouseStyle } from './houses';
import { SIDES, SIDE_DIRS, hasSignals, isRoadAt, isRoadType } from './roads';
import { footprintHasRoad } from './build';

const typeAt = (grid: Grid, x: number, y: number) => grid[y]?.[x]?.buildingType;

// Houses, shops, factories and monuments only work with a road on one of their sides
export const needsRoad = (type: BuildingType) =>
  type === BuildingType.Residential || type === BuildingType.Commercial || type === BuildingType.Industrial || type === BuildingType.Monument;

export const hasRoadAccess = (grid: Grid, x: number, y: number) =>
  SIDES.some(s => isRoadAt(grid, x + SIDE_DIRS[s][0], y + SIDE_DIRS[s][1]));

// Road access for any building; a monument counts a road beside any tile it covers
export const buildingHasRoad = (grid: Grid, tile: TileData) => {
  if (tile.monument) return footprintHasRoad(grid, tile.x, tile.y, tile.monument.footprint);
  if (tile.anchor) {
    const a = grid[tile.anchor.y]?.[tile.anchor.x];
    return !!a?.monument && footprintHasRoad(grid, a.x, a.y, a.monument.footprint);
  }
  return hasRoadAccess(grid, tile.x, tile.y);
};

const isNear = (grid: Grid, x: number, y: number, type: BuildingType) => {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx || dy) && typeAt(grid, x + dx, y + dy) === type) return true;
  }
  return false;
};

// A house is polluted by a factory on any of its 8 surrounding tiles, unless a park is next to it too
export const isPolluted = (grid: Grid, x: number, y: number) =>
  typeAt(grid, x, y) === BuildingType.Residential && isNear(grid, x, y, BuildingType.Industrial) && !isNear(grid, x, y, BuildingType.Park);

export interface CityAnalysis {
  counts: Record<string, number>; // Every building on the map
  activeCounts: Record<string, number>; // Buildings that work: roads, parks, and buildings with road access
  housing: number; // Homes in connected houses (halved by pollution)
  pollutedHomes: number; // Connected houses losing homes to pollution
  unconnected: number; // Houses, shops and factories without road access
  roads: number; // Road and roundabout tiles
  signals: number; // Junctions with traffic signals
  monuments: MonumentSite[]; // Monuments with road access
}

export interface MonumentSite {
  x: number; // Anchor (top-left) tile
  y: number;
  assetId: string;
  name: string;
  tier: AssetTier;
  footprint: [number, number];
  open: boolean; // Co-op: false while its licence has expired (no tourism or move-ins)
}

// In co-op, pass `owner` to analyse just that player's plot
export const analyzeCity = (grid: Grid, owner?: number): CityAnalysis => {
  const city: CityAnalysis = { counts: {}, activeCounts: {}, housing: 0, pollutedHomes: 0, unconnected: 0, roads: 0, signals: 0, monuments: [] };

  grid.forEach(row => row.forEach(tile => {
    const { x, y, buildingType: type, owner: tileOwner } = tile;
    if (type === BuildingType.None || type === BuildingType.Water) return;
    if (owner !== undefined && tileOwner !== owner) return;
    if (type === BuildingType.Monument && !tile.monument) return; // Covered tile: counted once at its anchor
    city.counts[type] = (city.counts[type] || 0) + 1;

    if (isRoadType(type)) {
      city.roads++;
      if (hasSignals(grid, x, y)) city.signals++;
    }
    if (needsRoad(type) && !buildingHasRoad(grid, tile)) {
      city.unconnected++;
      return;
    }
    city.activeCounts[type] = (city.activeCounts[type] || 0) + 1;

    if (tile.monument) {
      const m = tile.monument;
      city.monuments.push({ x, y, assetId: m.assetId, name: m.name, tier: m.tier, footprint: m.footprint, open: true });
    }

    if (type === BuildingType.Residential) {
      const homes = getHouseStyle(x, y).housing;
      if (isPolluted(grid, x, y)) {
        city.pollutedHomes++;
        city.housing += Math.floor(homes / 2);
      } else {
        city.housing += homes;
      }
    }
  }));

  return city;
};
