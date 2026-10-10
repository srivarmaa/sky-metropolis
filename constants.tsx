/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { BuildingConfig, BuildingType } from './types';

// Map Settings
export const GRID_SIZE = 10;

// Game Settings
export const TICK_RATE_MS = 2000; // Game loop updates every 2 seconds
export const INITIAL_MONEY = 1000;

// Economy: only employed citizens have money, and each spends this much per day at shops
export const SPEND_PER_WORKER = 0.5;

// Population: besides filling jobs, each house can hold this many unemployed residents
export const JOBLESS_PER_HOUSE = 2;

// Roads: buildings only work with a road next to them, and every road tile costs upkeep
export const ROAD_UPKEEP = 0.25; // Per road or roundabout tile per day
export const SIGNAL_UPKEEP = 1; // Per junction with traffic signals per day (roundabouts need none)
export const ROAD_CAPACITY = 10; // Commuters each road tile carries before traffic jams
export const MIN_DELIVERY_EFFICIENCY = 0.4; // Worst-case factory output in gridlock

export const BUILDINGS: Record<BuildingType, BuildingConfig> = {
  [BuildingType.None]: {
    type: BuildingType.None,
    cost: 0,
    name: 'Bulldoze',
    description: 'Clear a tile',
    color: '#ef4444', // Used for UI
    popGen: 0,
    incomeGen: 0,
    jobs: 0,
  },
  [BuildingType.Road]: {
    type: BuildingType.Road,
    cost: 10,
    name: 'Road',
    description: 'Buildings only work with a road next to them · $0.25/day upkeep · 3+ roads meeting get signals ($1/day)',
    color: '#374151', // gray-700
    popGen: 0,
    incomeGen: 0,
    jobs: 0,
  },
  [BuildingType.Roundabout]: {
    type: BuildingType.Roundabout,
    cost: 30,
    name: 'Roundabout',
    description: 'A junction without signals: no signal upkeep, no waiting at red · build on empty land or upgrade a road',
    color: '#4b5563', // gray-600
    popGen: 0,
    incomeGen: 0,
    jobs: 0,
  },
  [BuildingType.Residential]: {
    type: BuildingType.Residential,
    cost: 100,
    name: 'House',
    description: 'Homes for 5–10 (by style) · needs a road next to it · factory next door halves it unless a park is nearby',
    color: '#f87171', // red-400
    popGen: 5,
    incomeGen: 0,
    jobs: 0,
  },
  [BuildingType.Commercial]: {
    type: BuildingType.Commercial,
    cost: 200,
    name: 'Shop',
    description: '10 jobs · up to $15/day from paying customers · needs a road next to it',
    color: '#60a5fa', // blue-400
    popGen: 0,
    incomeGen: 15,
    jobs: 10,
  },
  [BuildingType.Industrial]: {
    type: BuildingType.Industrial,
    cost: 400,
    name: 'Factory',
    description: '20 jobs · up to $40/day when fully staffed and roads flow · pollutes houses next to it',
    color: '#facc15', // yellow-400
    popGen: 0,
    incomeGen: 40,
    jobs: 20,
  },
  [BuildingType.Park]: {
    type: BuildingType.Park,
    cost: 50,
    name: 'Park',
    description: 'Attracts residents (+1 move-in/day) · cleans factory pollution for houses next to it',
    color: '#4ade80', // green-400
    popGen: 1,
    incomeGen: 0,
    jobs: 0,
  },
};