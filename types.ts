/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
export enum BuildingType {
  None = 'None',
  Road = 'Road',
  Roundabout = 'Roundabout', // A road tile; at junctions it replaces traffic signals
  Residential = 'Residential',
  Commercial = 'Commercial',
  Industrial = 'Industrial',
  Park = 'Park',
}

export interface BuildingConfig {
  type: BuildingType;
  cost: number;
  name: string;
  description: string;
  color: string; // Main color for 3D material
  popGen: number; // Citizens who move in per tick (only while there are free homes and jobs)
  incomeGen: number; // Maximum money per tick (needs workers / paying customers)
  jobs: number; // Workers this building employs
}

export interface TileData {
  x: number;
  y: number;
  buildingType: BuildingType;
  // Suggested by AI for visual variety later
  variant?: number;
}

export type Grid = TileData[][];

// Daily economy breakdown (see services/economy.ts)
export interface EconomyReport {
  housing: number; // Total homes; population never exceeds this
  pollutedHomes: number; // Houses that lost half their homes to factory pollution
  unconnected: number; // Buildings without road access (they don't work)
  jobs: number;
  workers: number; // Employed citizens: min(population, jobs)
  staffing: number; // 0..1, share of jobs filled
  trafficLoad: number; // Commuters / road capacity; above 1 the roads are jammed
  deliveryEfficiency: number; // 0..1, factory output lost to traffic jams
  factoryIncome: number;
  shopIncome: number;
  shopCapacity: number; // What shops could sell with enough paying customers
  spending: number; // Employed citizens' daily shopping money
  upkeep: number; // Daily cost of roads, signals and roundabouts
  income: number; // Rounded net change to the treasury (income - upkeep)
}

export interface CityStats {
  money: number;
  population: number;
  day: number;
}

export interface AIGoal {
  description: string;
  targetType: 'population' | 'money' | 'building_count';
  targetValue: number;
  buildingType?: BuildingType; // If target is building_count
  reward: number;
  completed: boolean;
}

export interface NewsItem {
  id: string;
  text: string;
  type: 'positive' | 'negative' | 'neutral';
}