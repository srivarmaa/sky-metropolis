/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { BuildingType, Grid } from '../types';
import { tileHash } from './houses';

// --- Road network ---

// Bridges carry roads over the river, so traffic, pedestrians and road access cross them
export const isRoadType = (type: BuildingType) =>
  type === BuildingType.Road || type === BuildingType.Roundabout || type === BuildingType.Bridge;

export const isRoadAt = (grid: Grid, x: number, y: number) =>
  y >= 0 && y < grid.length && x >= 0 && x < grid[y].length && isRoadType(grid[y][x].buildingType);

// Sides in grid space; "up" is the row above (y - 1)
export type Side = 'up' | 'down' | 'left' | 'right';
export const SIDES: Side[] = ['up', 'down', 'left', 'right'];
export const SIDE_DIRS: Record<Side, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export const roadConnections = (grid: Grid, x: number, y: number): Record<Side, boolean> => ({
  up: isRoadAt(grid, x, y - 1), down: isRoadAt(grid, x, y + 1), left: isRoadAt(grid, x - 1, y), right: isRoadAt(grid, x + 1, y),
});

const connectionCount = (grid: Grid, x: number, y: number) =>
  SIDES.filter(s => isRoadAt(grid, x + SIDE_DIRS[s][0], y + SIDE_DIRS[s][1])).length;

// Plain road tiles where 3+ roads meet get traffic signals; roundabouts never do
export const hasSignals = (grid: Grid, x: number, y: number) =>
  grid[y]?.[x]?.buildingType === BuildingType.Road && connectionCount(grid, x, y) >= 3;

// --- Traffic signals ---

// Cycle (seconds): north-south green, amber, then east-west green, amber
export const SIGNAL_CYCLE = 10;
export const LAMP_RED = 0;
export const LAMP_AMBER = 1;
export const LAMP_GREEN = 2;

// Which lamp is lit for the arms of a junction; each junction runs slightly out of step with the others
export const signalLamp = (t: number, x: number, y: number, northSouth: boolean): number => {
  const phase = (t + tileHash(x, y) * SIGNAL_CYCLE + (northSouth ? 0 : SIGNAL_CYCLE / 2)) % SIGNAL_CYCLE;
  return phase < 4 ? LAMP_GREEN : phase < 5 ? LAMP_AMBER : LAMP_RED;
};

// --- Day / night ---

export const DAY_LENGTH_S = 150; // Real seconds per full day/night cycle
const START_TIME = 0.3; // Start in the morning

// 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset
export const timeOfDay = (t: number) => (t / DAY_LENGTH_S + START_TIME) % 1;
export const sunHeight = (t: number) => Math.sin(2 * Math.PI * (timeOfDay(t) - 0.25));

const smoothstep = (a: number, b: number, v: number) => {
  const k = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
// 1 in full daylight, 0 at night, blending through dawn and dusk
export const daylight = (t: number) => smoothstep(-0.12, 0.3, sunHeight(t));

// --- Pedestrian walkways ---
// Pedestrians walk along pavements between the corners of road tiles, and cross the road only on
// zebra crossings (junction arms and roundabouts). At signals they wait until cars on that arm have red.

export const PED_CORNER = 0.4; // Corner offset from the tile centre; lies on the pavement and on the zebra stripes

export interface PedCrossing { x: number; y: number; northSouth: boolean; signal: boolean }
export interface PedEdge { to: number; crossing: PedCrossing | null }
export interface PedGraph { nodes: { x: number; y: number }[]; edges: PedEdge[][] }

type Corner = [number, number];
const SIDE_CORNERS: Record<Side, [Corner, Corner]> = {
  up: [[-1, -1], [1, -1]], down: [[-1, 1], [1, 1]], left: [[-1, -1], [-1, 1]], right: [[1, -1], [1, 1]],
};

export const buildPedestrianGraph = (grid: Grid): PedGraph => {
  const graph: PedGraph = { nodes: [], edges: [] };
  const ids = new Map<string, number>();
  const node = (x: number, y: number, [cx, cy]: Corner) => {
    const key = `${x},${y},${cx},${cy}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = graph.nodes.length;
      ids.set(key, id);
      graph.nodes.push({ x: x + cx * PED_CORNER, y: y + cy * PED_CORNER });
      graph.edges.push([]);
    }
    return id;
  };
  const link = (a: number, b: number, crossing: PedCrossing | null = null) => {
    graph.edges[a].push({ to: b, crossing });
    graph.edges[b].push({ to: a, crossing });
  };

  grid.forEach(row => row.forEach(({ x, y, buildingType }) => {
    if (!isRoadType(buildingType)) return;
    const conn = roadConnections(grid, x, y);
    const signal = hasSignals(grid, x, y);
    const zebras = signal || buildingType === BuildingType.Roundabout;

    for (const s of SIDES) {
      const [a, b] = SIDE_CORNERS[s];
      if (!conn[s]) link(node(x, y, a), node(x, y, b)); // Along the pavement
      else if (zebras) link(node(x, y, a), node(x, y, b), { x, y, northSouth: s === 'up' || s === 'down', signal });
    }
    // Pavements continue into the next road tile
    if (conn.right) {
      link(node(x, y, [1, -1]), node(x + 1, y, [-1, -1]));
      link(node(x, y, [1, 1]), node(x + 1, y, [-1, 1]));
    }
    if (conn.down) {
      link(node(x, y, [-1, 1]), node(x, y + 1, [-1, -1]));
      link(node(x, y, [1, 1]), node(x, y + 1, [1, -1]));
    }
  }));

  return graph;
};
