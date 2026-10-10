/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { BuildingType, CoopCity, CoopPlayer, Grid, TileData } from '../../types';
import { BUILDINGS } from '../../constants';
import { BridgeInfo, Deal, Proposal } from './protocol';
import { riverCrossing } from './world';

/**
 * Deals between two cities. Nothing changes when a deal is proposed: only `settleDeal`, called after
 * the other player accepts, changes anything, and it either does all of it or none of it.
 */

export interface DealWorld {
  grid: Grid;
  plotSize: number;
  cities: Record<number, CoopCity>;
  bridges: BridgeInfo[];
  players: CoopPlayer[];
}

export const BRIDGE_SHARE = BUILDINGS[BuildingType.Bridge].cost; // Each side pays this

const pair = (a: number, b: number, x: number, y: number) => (a === x && b === y) || (a === y && b === x);

export const sameDeal = (d1: Deal, d2: Deal) => {
  if (d1.kind !== d2.kind) return false;
  if (d1.kind === 'bridge' && d2.kind === 'bridge') return d1.tiles.some(t => d2.tiles.some(u => u.x === t.x && u.y === t.y));
  if (d1.kind !== 'bridge' && d2.kind !== 'bridge') return d1.bridgeId === d2.bridgeId;
  return false;
};

// Why this deal can't happen right now, or null if it can
export const checkDeal = (w: DealWorld, from: number, to: number, deal: Deal): string | null => {
  if (from === to) return 'You need another player for that.';
  if (!w.cities[from] || !w.cities[to] || !w.players.some(p => p.slot === to)) return 'That player has no city.';

  switch (deal.kind) {
    case 'bridge': {
      const first = deal.tiles[0];
      const crossing = first && riverCrossing(w.grid, w.plotSize, first.x, first.y);
      if (!crossing || crossing.tiles.length !== deal.tiles.length) return 'A bridge can no longer be built there.';
      if (!pair(crossing.a, crossing.b, from, to)) return 'That bridge would not join your two cities.';
      if (w.cities[from].stats.money < BRIDGE_SHARE) return `You need $${BRIDGE_SHARE} for your share of the bridge.`;
      return null;
    }
    case 'remove_bridge':
    case 'bridge_commuting': {
      const bridge = w.bridges.find(b => b.id === deal.bridgeId);
      if (!bridge) return 'That bridge is gone.';
      if (!pair(bridge.a, bridge.b, from, to)) return 'That bridge is not between your two cities.';
      if (deal.kind === 'bridge_commuting' && bridge.commuting === deal.open) return deal.open ? 'Commuters can already cross.' : 'The bridge is already closed to commuters.';
      return null;
    }
  }
};

// Short description for the other player, e.g. "build a bridge between your cities (you each pay $75)"
export const describeDeal = (deal: Deal): string => {
  switch (deal.kind) {
    case 'bridge': return `build a bridge between your cities (you each pay $${BRIDGE_SHARE})`;
    case 'remove_bridge': return 'remove the bridge between your cities';
    case 'bridge_commuting': return deal.open ? 'reopen your bridge to commuters' : 'close your bridge to commuters';
  }
};

export interface Settlement {
  ok: boolean;
  reason?: string; // Why it failed (nothing changed)
  tiles?: TileData[]; // Changed tiles
  cities?: Record<number, CoopCity>;
  bridges?: BridgeInfo[];
  news?: string; // Announcement for everyone
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Carry out an accepted deal for both sides at once, or not at all
export const settleDeal = (w: DealWorld, p: Proposal, nameOf: (slot: number) => string): Settlement => {
  const problem = checkDeal(w, p.from, p.to, p.deal);
  if (problem) return { ok: false, reason: problem };
  const names = `${nameOf(p.from)} and ${nameOf(p.to)}`;
  const deal = p.deal;

  switch (deal.kind) {
    case 'bridge': {
      const short = [p.from, p.to].find(s => w.cities[s].stats.money < BRIDGE_SHARE);
      if (short !== undefined) return { ok: false, reason: `${nameOf(short)} can't afford their $${BRIDGE_SHARE} share of the bridge.` };
      const crossing = riverCrossing(w.grid, w.plotSize, deal.tiles[0].x, deal.tiles[0].y)!;
      const cities = { ...w.cities };
      for (const s of [p.from, p.to]) cities[s] = { ...cities[s], stats: { ...cities[s].stats, money: cities[s].stats.money - BRIDGE_SHARE } };
      return {
        ok: true,
        tiles: crossing.tiles.map(t => ({ ...w.grid[t.y][t.x], buildingType: BuildingType.Bridge })),
        cities,
        bridges: [...w.bridges, { id: newId(), tiles: crossing.tiles, a: crossing.a, b: crossing.b, ends: crossing.ends, commuting: true }],
        news: `${names} built a bridge across the river. Connect roads to both ends so commuters can cross.`,
      };
    }
    case 'remove_bridge': {
      const bridge = w.bridges.find(b => b.id === deal.bridgeId)!;
      return {
        ok: true,
        tiles: bridge.tiles.map(t => ({ ...w.grid[t.y][t.x], buildingType: BuildingType.Water })),
        bridges: w.bridges.filter(b => b.id !== bridge.id),
        news: `${names} took down the bridge between their cities.`,
      };
    }
    case 'bridge_commuting':
      return {
        ok: true,
        bridges: w.bridges.map(b => (b.id === deal.bridgeId ? { ...b, commuting: deal.open } : b)),
        news: deal.open ? `${names} reopened their bridge to commuters.` : `${names} closed their bridge to commuters.`,
      };
  }
};
