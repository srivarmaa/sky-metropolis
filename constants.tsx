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
    description: 'Connects buildings.',
    color: '#374151', // gray-700
    popGen: 0,
    incomeGen: 0,
    jobs: 0,
  },
  [BuildingType.Residential]: {
    type: BuildingType.Residential,
    cost: 100,
    name: 'House',
    description: '+5 citizens/day',
    color: '#f87171', // red-400
    popGen: 5,
    incomeGen: 0,
    jobs: 0,
  },
  [BuildingType.Commercial]: {
    type: BuildingType.Commercial,
    cost: 200,
    name: 'Shop',
    description: '10 jobs · up to $15/day from paying customers',
    color: '#60a5fa', // blue-400
    popGen: 0,
    incomeGen: 15,
    jobs: 10,
  },
  [BuildingType.Industrial]: {
    type: BuildingType.Industrial,
    cost: 400,
    name: 'Factory',
    description: '20 jobs · up to $40/day when fully staffed',
    color: '#facc15', // yellow-400
    popGen: 0,
    incomeGen: 40,
    jobs: 20,
  },
  [BuildingType.Park]: {
    type: BuildingType.Park,
    cost: 50,
    name: 'Park',
    description: 'Looks nice.',
    color: '#4ade80', // green-400
    popGen: 1,
    incomeGen: 0,
    jobs: 0,
  },
};