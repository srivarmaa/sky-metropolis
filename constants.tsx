/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { AssetTier, BuildingConfig, BuildingType } from './types';

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

// Co-op: up to 4 players, each with a square plot; plots are separated by a river that meets in a central lake
export const MAX_PLAYERS = 4;
export const COOP_PLOT_SIZES = [10, 15, 20, 25];
export const COOP_DEFAULT_PLOT_SIZE = 20;
export const RIVER_WIDTH = 2;
export const LAKE_SIZE = 6;
export const PLAYER_COLORS = ['#22d3ee', '#f472b6', '#a3e635', '#fb923c', '#a78bfa', '#facc15'];
export const DEMOLISH_COST = 5;
export const PROPOSAL_TTL_MS = 60_000; // Unanswered proposals expire after a minute
export const COMMUTE_TAX = 0.1; // Share of a commuter's output paid to their home city

// Player-made monuments (see services/assets). Figures are per tile of the footprint, so bigger
// monuments cost and earn proportionally more. Creators choose the tier but can't change the numbers.
export const ASSET_TIERS: Record<AssetTier, { label: string; cost: number; tourism: number; popGen: number; upkeep: number; maxHeight: number }> = {
  monument: { label: 'Monument', cost: 400, tourism: 20, popGen: 2, upkeep: 2, maxHeight: 3 },
  grand: { label: 'Grand Monument', cost: 1200, tourism: 60, popGen: 5, upkeep: 6, maxHeight: 5 },
};
export const MAX_FOOTPRINT = 3; // Up to 3×3 tiles
export const NOVELTY_DECAY = 0.5; // Each extra copy of the same monument in a city draws half as many tourists
export const GAME_DAYS_PER_YEAR = 360;
export const LICENCE_DAY_OPTIONS = [30, 90, 180, 360]; // 90 game days = "3 months"
export const MAX_PROFIT_SHARE = 50; // Percent of a monument's tourism a creator may ask for

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
  [BuildingType.Water]: {
    type: BuildingType.Water,
    cost: 0,
    name: 'Water',
    description: 'River and lake between co-op cities',
    color: '#3b82f6',
    popGen: 0,
    incomeGen: 0,
    jobs: 0,
  },
  [BuildingType.Monument]: {
    type: BuildingType.Monument,
    cost: 400, // Per tile for the Monument tier; see ASSET_TIERS
    name: 'Monument',
    description: 'Build a landmark from your Asset Studio. Earns tourism and attracts residents; needs a road and upkeep.',
    color: '#c084fc',
    popGen: 0, // Handled per tier (ASSET_TIERS)
    incomeGen: 0,
    jobs: 0,
  },
  [BuildingType.Bridge]: {
    type: BuildingType.Bridge,
    cost: 75, // Each of the two cities pays this share
    name: 'Bridge',
    description: "Click the river next to a friend's city to propose a bridge. If they accept, you each pay $75. Connect both ends to roads so commuters can cross.",
    color: '#94a3b8',
    popGen: 0,
    incomeGen: 0,
    jobs: 0,
  },
};