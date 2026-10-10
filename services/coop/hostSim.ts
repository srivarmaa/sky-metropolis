/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { CoopCity, EconomyReport, Grid } from '../../types';
import { COMMUTE_TAX, INITIAL_MONEY } from '../../constants';
import { CityAnalysis, analyzeCity } from '../city';
import { CityProblem, EMPTY_ECONOMY, computeEconomy, computePopulation, findCityProblems, monumentEffects } from '../economy';
import { isRoadType } from '../roads';
import { BridgeInfo, Licence } from './protocol';

// A licence is valid until (not including) its expiry day
export const licenceValid = (l: Licence, day: number) => day < l.expiresDay;

export const newCoopCity = (day: number): CoopCity => ({
  stats: { money: INITIAL_MONEY, population: 0, day },
  economy: EMPTY_ECONOMY,
});

// A bridge carries commuters once both banks have a road leading onto it
export const bridgeIsLinked = (grid: Grid, bridge: BridgeInfo) =>
  bridge.ends.every(e => { const t = grid[e.y]?.[e.x]; return !!t && isRoadType(t.buildingType); });

// Pairs of cities whose residents may commute to each other (agreed, open and road-connected bridges)
export const commuteLinks = (grid: Grid, bridges: BridgeInfo[]): [number, number][] => {
  const seen = new Set<string>();
  const links: [number, number][] = [];
  for (const b of bridges) {
    if (!b.commuting || !bridgeIsLinked(grid, b)) continue;
    const key = b.a < b.b ? `${b.a}-${b.b}` : `${b.b}-${b.a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push([b.a, b.b]);
  }
  return links;
};

export interface CoopDayResult {
  cities: Record<number, CoopCity>;
  problems: Record<number, CityProblem[]>;
}

/**
 * One day for every city in a co-op world. Each player's plot is simulated on its own with the same
 * rules as solo play, and each pays and earns from its own treasury. Across linked bridges, unemployed
 * residents fill open jobs in the neighbouring city; the employer keeps the output and pays the
 * commuters' home city a wage tax on it.
 */
export const simulateCoopDay = (
  grid: Grid, cities: Record<number, CoopCity>, day: number, links: [number, number][] = [], licences: Licence[] = [],
): CoopDayResult => {
  const slots = Object.keys(cities).map(Number);
  const linked = (s: number) => links.flatMap(([a, b]) => (a === s ? [b] : b === s ? [a] : [])).filter(n => cities[n]);

  // 1. Population: residents can also move in for jobs they could commute to (judged on yesterday)
  const analyses: Record<number, CityAnalysis> = {};
  const population: Record<number, number> = {};
  for (const s of slots) {
    const prev = cities[s];
    analyses[s] = analyzeCity(grid, s);
    // Monuments built under a licence close while it has run out (the creator's own are always open)
    for (const m of analyses[s].monuments) {
      const lic = licences.find(l => l.assetId === m.assetId && l.holder === s);
      if (lic) m.open = licenceValid(lic, day);
    }
    const openNearby = linked(s).reduce((n, o) => n + Math.max(0, cities[o].economy.jobs - cities[o].economy.workers), 0);
    population[s] = computePopulation(analyses[s], prev.stats.population, prev.economy.commutersOut + openNearby);
  }

  // 2. Each city with its own residents only
  const base: Record<number, EconomyReport> = {};
  const unemployed: Record<number, number> = {};
  const openJobs: Record<number, number> = {};
  for (const s of slots) {
    base[s] = computeEconomy(analyses[s], population[s]);
    unemployed[s] = population[s] - base[s].workers;
    openJobs[s] = base[s].jobs - base[s].workers;
  }

  // 3. Commuting across linked bridges, both ways
  const inflow: Record<number, number> = Object.fromEntries(slots.map(s => [s, 0]));
  const outflow: Record<number, number> = Object.fromEntries(slots.map(s => [s, 0]));
  const sources: Record<number, Record<number, number>> = Object.fromEntries(slots.map(s => [s, {}]));
  for (const [a, b] of links) {
    if (!cities[a] || !cities[b]) continue;
    for (const [home, work] of [[a, b], [b, a]]) {
      const flow = Math.min(unemployed[home], openJobs[work]);
      if (flow <= 0) continue;
      unemployed[home] -= flow;
      openJobs[work] -= flow;
      inflow[work] += flow;
      outflow[home] += flow;
      sources[work][home] = (sources[work][home] || 0) + flow;
    }
  }

  // 4. Final economies with commuters, and the wage tax on what commuters produce
  const result: CoopDayResult = { cities: {}, problems: {} };
  const tax: Record<number, number> = Object.fromEntries(slots.map(s => [s, 0]));
  const finals: Record<number, EconomyReport> = {};
  for (const s of slots) {
    finals[s] = computeEconomy(analyses[s], population[s], inflow[s]);
    const gained = Math.max(0, finals[s].income - base[s].income);
    const owed = gained * COMMUTE_TAX;
    if (owed <= 0 || inflow[s] <= 0) continue;
    tax[s] -= owed;
    for (const [home, flow] of Object.entries(sources[s])) tax[Number(home)] += owed * (flow / inflow[s]);
  }

  // 5. Profit-share licences: a cut of each licensed monument's tourism goes to the asset's creator
  const royalties: Record<number, number> = Object.fromEntries(slots.map(s => [s, 0]));
  for (const s of slots) {
    const sites = analyses[s].monuments;
    const perSite = monumentEffects(sites).perSite;
    sites.forEach((m, i) => {
      const lic = licences.find(l => l.assetId === m.assetId && l.holder === s);
      if (!lic || lic.share <= 0 || !m.open || perSite[i] <= 0 || !cities[lic.creator]) return;
      const cut = perSite[i] * (lic.share / 100);
      royalties[s] -= cut;
      royalties[lic.creator] += cut;
    });
  }

  for (const s of slots) {
    const economy: EconomyReport = {
      ...finals[s],
      commutersOut: outflow[s],
      commuteTax: tax[s],
      royalties: royalties[s],
      income: Math.round(finals[s].income + tax[s] + royalties[s]),
    };
    const money = Math.max(0, cities[s].stats.money + economy.income);
    result.cities[s] = { stats: { money, population: population[s], day }, economy };
    result.problems[s] = findCityProblems(analyses[s], economy, money);
  }
  return result;
};
