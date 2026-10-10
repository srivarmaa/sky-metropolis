/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { BuildingType, EconomyReport } from '../types';
import {
  BUILDINGS, JOBLESS_PER_HOUSE, SPEND_PER_WORKER, ROAD_UPKEEP, SIGNAL_UPKEEP, ROAD_CAPACITY, MIN_DELIVERY_EFFICIENCY,
} from '../constants';
import { CityAnalysis } from './city';

const sumConfig = (buildingCounts: Record<string, number>, key: 'jobs' | 'popGen'): number =>
  Object.entries(buildingCounts).reduce((sum, [type, count]) => sum + (BUILDINGS[type as BuildingType]?.[key] || 0) * count, 0);

/**
 * Daily population:
 * - People only move in while there are free homes and jobs (plus a few unemployed per house).
 * - Houses and parks set how fast they move in; if jobs disappear, people gradually move out.
 * - Population never exceeds housing (see analyzeCity): homeless citizens leave immediately.
 * - Only buildings with road access count (city.activeCounts).
 */
export const computePopulation = (city: CityAnalysis, prevPop: number): number => {
  const { activeCounts, housing } = city;
  const jobs = sumConfig(activeCounts, 'jobs');
  const houses = activeCounts[BuildingType.Residential] || 0;
  const target = Math.min(housing, jobs + houses * JOBLESS_PER_HOUSE);

  let pop = Math.max(0, prevPop);
  if (pop < target) {
    pop += Math.min(target - pop, sumConfig(activeCounts, 'popGen'));
  } else if (pop > target) {
    pop = Math.max(target, pop - Math.max(5, Math.ceil((pop - target) * 0.2)));
  }
  return Math.min(pop, housing);
};

/**
 * Daily economy:
 * - Only employed citizens have money; workers are spread evenly across all jobs.
 * - Factories produce in proportion to how well they are staffed, and lose output when commuters jam the roads.
 * - Shops need staff too, and can only sell what employed citizens can afford to spend.
 * - Roads and signals cost upkeep every day.
 */
export const computeEconomy = (city: CityAnalysis, population: number): EconomyReport => {
  const factories = city.activeCounts[BuildingType.Industrial] || 0;
  const shops = city.activeCounts[BuildingType.Commercial] || 0;

  const jobs = factories * BUILDINGS[BuildingType.Industrial].jobs + shops * BUILDINGS[BuildingType.Commercial].jobs;
  const workers = Math.min(Math.max(0, population), jobs);
  const staffing = jobs > 0 ? workers / jobs : 0;

  // Every worker commutes; past road capacity, deliveries slow down
  const roadCapacity = city.roads * ROAD_CAPACITY;
  const trafficLoad = roadCapacity > 0 ? workers / roadCapacity : 0;
  const deliveryEfficiency = trafficLoad <= 1 ? 1 : Math.max(MIN_DELIVERY_EFFICIENCY, 1 - (trafficLoad - 1) * 0.6);

  const factoryIncome = factories * BUILDINGS[BuildingType.Industrial].incomeGen * staffing * deliveryEfficiency;
  const spending = workers * SPEND_PER_WORKER;
  const shopCapacity = shops * BUILDINGS[BuildingType.Commercial].incomeGen * staffing;
  const shopIncome = Math.min(shopCapacity, spending);
  const upkeep = city.roads * ROAD_UPKEEP + city.signals * SIGNAL_UPKEEP;

  return {
    housing: city.housing,
    pollutedHomes: city.pollutedHomes,
    unconnected: city.unconnected,
    jobs,
    workers,
    staffing,
    trafficLoad,
    deliveryEfficiency,
    factoryIncome,
    shopIncome,
    shopCapacity,
    spending,
    upkeep,
    income: Math.round(factoryIncome + shopIncome - upkeep),
  };
};

export const EMPTY_ECONOMY: EconomyReport = computeEconomy(
  { counts: {}, activeCounts: {}, housing: 0, pollutedHomes: 0, unconnected: 0, roads: 0, signals: 0 }, 0);

export type EconomyProblem = 'idle_factories' | 'shops_no_customers' | 'no_road_access' | 'traffic_jam' | 'pollution';

// Conditions worth telling the player about in the news feed
export const findEconomyProblems = (city: CityAnalysis, report: EconomyReport): EconomyProblem[] => {
  const problems: EconomyProblem[] = [];
  if ((city.activeCounts[BuildingType.Industrial] || 0) > 0 && report.staffing < 0.5) problems.push('idle_factories');
  // No one employed means no one can shop; otherwise warn when shoppers cover under half of what shops could sell
  if ((city.activeCounts[BuildingType.Commercial] || 0) > 0 && (report.workers === 0 || report.spending < report.shopCapacity * 0.5)) {
    problems.push('shops_no_customers');
  }
  if (report.unconnected > 0) problems.push('no_road_access');
  if (report.trafficLoad > 1) problems.push('traffic_jam');
  if (report.pollutedHomes > 0) problems.push('pollution');
  return problems;
};
