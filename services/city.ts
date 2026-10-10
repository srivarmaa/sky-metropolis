/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { BuildingType, Grid } from '../types';
import { getHouseStyle } from './houses';
import { SIDES, SIDE_DIRS, hasSignals, isRoadAt, isRoadType } from './roads';

const typeAt = (grid: Grid, x: number, y: number) => grid[y]?.[x]?.buildingType;

// Houses, shops and factories only work with a road on one of their four sides
export const needsRoad = (type: BuildingType) =>
  type === BuildingType.Residential || type === BuildingType.Commercial || type === BuildingType.Industrial;

export const hasRoadAccess = (grid: Grid, x: number, y: number) =>
  SIDES.some(s => isRoadAt(grid, x + SIDE_DIRS[s][0], y + SIDE_DIRS[s][1]));

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
}

export const analyzeCity = (grid: Grid): CityAnalysis => {
  const city: CityAnalysis = { counts: {}, activeCounts: {}, housing: 0, pollutedHomes: 0, unconnected: 0, roads: 0, signals: 0 };

  grid.forEach(row => row.forEach(({ x, y, buildingType: type }) => {
    if (type === BuildingType.None) return;
    city.counts[type] = (city.counts[type] || 0) + 1;

    if (isRoadType(type)) {
      city.roads++;
      if (hasSignals(grid, x, y)) city.signals++;
    }
    if (needsRoad(type) && !hasRoadAccess(grid, x, y)) {
      city.unconnected++;
      return;
    }
    city.activeCounts[type] = (city.activeCounts[type] || 0) + 1;

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
