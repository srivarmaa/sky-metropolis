/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { BuildingType, CoopCity, CoopPlayer, Grid, TileData } from '../../types';
import { BUILDINGS, LICENCE_DAY_OPTIONS, MAX_PROFIT_SHARE } from '../../constants';
import { BridgeInfo, Deal, Licence, Proposal, RoomAsset } from './protocol';
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
  assets: Record<string, RoomAsset>; // Shared with the room this session
  licences: Licence[];
  day: number; // Current game day
}

export const BRIDGE_SHARE = BUILDINGS[BuildingType.Bridge].cost; // Each side pays this

const pair = (a: number, b: number, x: number, y: number) => (a === x && b === y) || (a === y && b === x);

export const sameDeal = (d1: Deal, d2: Deal) => {
  if (d1.kind !== d2.kind) return false;
  if (d1.kind === 'bridge' && d2.kind === 'bridge') return d1.tiles.some(t => d2.tiles.some(u => u.x === t.x && u.y === t.y));
  if (d1.kind === 'asset_licence' && d2.kind === 'asset_licence') return d1.assetId === d2.assetId;
  if ((d1.kind === 'remove_bridge' || d1.kind === 'bridge_commuting') && (d2.kind === 'remove_bridge' || d2.kind === 'bridge_commuting')) return d1.bridgeId === d2.bridgeId;
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
    case 'asset_licence': {
      const asset = w.assets[deal.assetId];
      if (!asset) return 'That asset is no longer shared in the room.';
      if (asset.creator !== from && asset.creator !== to) return 'Only the creator of an asset can license it.';
      const holder = licenceHolder(w, from, to, deal);
      if (!Number.isInteger(deal.price) || deal.price < 0 || deal.price > 1_000_000) return 'The price must be a whole number of dollars.';
      if (!LICENCE_DAY_OPTIONS.includes(deal.days)) return `A licence lasts ${LICENCE_DAY_OPTIONS.join(', ')} days.`;
      if (!Number.isInteger(deal.share) || deal.share < 0 || deal.share > MAX_PROFIT_SHARE) return `Profit share must be 0-${MAX_PROFIT_SHARE}%.`;
      if (w.cities[holder].stats.money < deal.price) return `${holder === from ? 'You need' : 'They need'} $${deal.price.toLocaleString()} to pay for the licence.`;
      return null;
    }
  }
};

// The player who gets the right to build (the one who isn't the creator)
export const licenceHolder = (w: Pick<DealWorld, 'assets'>, from: number, to: number, deal: Extract<Deal, { kind: 'asset_licence' }>) =>
  w.assets[deal.assetId]?.creator === from ? to : from;

// Days left on a holder's licence for an asset (0 if none or expired)
export const licenceDaysLeft = (licences: Licence[], assetId: string, holder: number, day: number) => {
  const l = licences.find(x => x.assetId === assetId && x.holder === holder);
  return l ? Math.max(0, l.expiresDay - day) : 0;
};

// Short description for the other player, e.g. "build a bridge between your cities (you each pay $75)"
export const describeDeal = (deal: Deal, assetName: (id: string) => string = () => 'an asset'): string => {
  switch (deal.kind) {
    case 'asset_licence': {
      const parts = [`$${deal.price.toLocaleString()} up front`];
      if (deal.share > 0) parts.push(`${deal.share}% of its tourism`);
      return `license ${assetName(deal.assetId)} for ${deal.days} days (${parts.join(' + ')}, paid to its creator)`;
    }
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
  licences?: Licence[];
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
    case 'asset_licence': {
      const asset = w.assets[deal.assetId];
      const holder = licenceHolder(w, p.from, p.to, deal);
      const creator = asset.creator;
      const cities = { ...w.cities };
      cities[holder] = { ...cities[holder], stats: { ...cities[holder].stats, money: cities[holder].stats.money - deal.price } };
      cities[creator] = { ...cities[creator], stats: { ...cities[creator].stats, money: cities[creator].stats.money + deal.price } };
      // Renewing extends the current licence (from today if it already ran out)
      const existing = w.licences.find(l => l.assetId === deal.assetId && l.holder === holder);
      const licences = existing
        ? w.licences.map(l => (l === existing ? { ...l, share: deal.share, expiresDay: Math.max(l.expiresDay, w.day) + deal.days } : l))
        : [...w.licences, { id: newId(), assetId: deal.assetId, holder, creator, share: deal.share, expiresDay: w.day + deal.days }];
      const terms = [`$${deal.price.toLocaleString()}`, ...(deal.share > 0 ? [`${deal.share}% of tourism`] : [])].join(' + ');
      return {
        ok: true,
        cities,
        licences,
        news: `${nameOf(holder)} ${existing ? 'renewed' : 'licensed'} ${asset.spec.name} from ${nameOf(creator)} for ${deal.days} days (${terms}).`,
      };
    }
  }
};
