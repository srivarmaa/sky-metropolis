/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { BuildingType, EconomyReport } from '../types';
import { BUILDINGS, SPEND_PER_WORKER } from '../constants';

/**
 * Daily economy:
 * - Only employed citizens have money; workers are spread evenly across all jobs.
 * - Factories produce in proportion to how well they are staffed.
 * - Shops need staff too, and can only sell what employed citizens can afford to spend.
 */
export const computeEconomy = (buildingCounts: Record<string, number>, population: number): EconomyReport => {
  const factories = buildingCounts[BuildingType.Industrial] || 0;
  const shops = buildingCounts[BuildingType.Commercial] || 0;

  const jobs = factories * BUILDINGS[BuildingType.Industrial].jobs + shops * BUILDINGS[BuildingType.Commercial].jobs;
  const workers = Math.min(Math.max(0, population), jobs);
  const staffing = jobs > 0 ? workers / jobs : 0;

  const factoryIncome = factories * BUILDINGS[BuildingType.Industrial].incomeGen * staffing;
  const spending = workers * SPEND_PER_WORKER;
  const shopCapacity = shops * BUILDINGS[BuildingType.Commercial].incomeGen * staffing;
  const shopIncome = Math.min(shopCapacity, spending);

  return {
    jobs,
    workers,
    staffing,
    factoryIncome,
    shopIncome,
    shopCapacity,
    spending,
    income: Math.round(factoryIncome + shopIncome),
  };
};

export const EMPTY_ECONOMY: EconomyReport = computeEconomy({}, 0);

export type EconomyProblem = 'idle_factories' | 'shops_no_customers';

// Conditions worth telling the player about in the news feed
export const findEconomyProblems = (buildingCounts: Record<string, number>, report: EconomyReport): EconomyProblem[] => {
  const problems: EconomyProblem[] = [];
  if ((buildingCounts[BuildingType.Industrial] || 0) > 0 && report.staffing < 0.5) problems.push('idle_factories');
  // No one employed means no one can shop; otherwise warn when shoppers cover under half of what shops could sell
  if ((buildingCounts[BuildingType.Commercial] || 0) > 0 && (report.workers === 0 || report.spending < report.shopCapacity * 0.5)) {
    problems.push('shops_no_customers');
  }
  return problems;
};
