/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { BuildingType, CoopCity, CoopPlayer, TileData } from '../../types';
import { TilePos } from './world';
import { AssetSpec, AssetTerms } from '../assets/spec';
import { SavedMonument } from '../layoutFile';

// An asset shared with the room this session (players re-share their assets each time they join)
export interface RoomAsset {
  id: string; // Content id
  spec: AssetSpec;
  creator: number; // Slot of the player who shared it first
  terms: AssetTerms; // The creator's asking terms
}

// The right to build an asset someone else made, for a number of game days
export interface Licence {
  id: string;
  assetId: string;
  holder: number; // Slot allowed to build it
  creator: number; // Slot that gets paid
  share: number; // Percent of each of the holder's copies' tourism paid to the creator
  expiresDay: number; // Game day it runs out (monuments close until renewed)
}

// The host's browser runs the game; clients only send requests and show what the host sends back.

// Anything between two cities needs both players to agree: one proposes, the other accepts or declines.
export type Deal =
  | { kind: 'bridge'; tiles: TilePos[] } // Build a bridge over these river tiles (each pays half)
  | { kind: 'remove_bridge'; bridgeId: string }
  | { kind: 'bridge_commuting'; bridgeId: string; open: boolean } // Open or close a bridge to commuters
  | { kind: 'asset_licence'; assetId: string; price: number; days: number; share: number }; // Holder pays creator `price`; renewing extends it

export interface Proposal {
  id: string;
  from: number; // Player slot that proposed
  to: number; // Player slot that must accept
  deal: Deal;
  expiresAt: number; // Host clock (ms)
}

export interface BridgeInfo {
  id: string;
  tiles: TilePos[];
  a: number; // Plot slots on either bank
  b: number;
  ends: [TilePos, TilePos]; // Bank tiles at each end
  commuting: boolean; // Both players agreed to let commuters cross
}

export type ClientMessage =
  | { t: 'hello'; name: string; color: string }
  | { t: 'build'; x: number; y: number; tool: BuildingType }
  | { t: 'cursor'; tile: TilePos | null }
  | { t: 'propose'; to: number; deal: Deal }
  | { t: 'respond'; id: string; accept: boolean }
  | { t: 'cancel'; id: string }
  | { t: 'share_asset'; spec: AssetSpec; terms: AssetTerms }
  | { t: 'build_monument'; x: number; y: number; assetId: string; rotation: number };

export type HostMessage =
  | { t: 'lobby'; players: CoopPlayer[]; plotSize: number; you: number }
  | {
      t: 'welcome'; you: number; plotSize: number; rows: string[]; players: CoopPlayer[];
      cities: Record<number, CoopCity>; day: number; bridges: BridgeInfo[]; proposals: Proposal[]; now: number;
      monuments: SavedMonument[]; assets: RoomAsset[]; licences: Licence[];
    }
  | { t: 'reject'; reason: string }
  | { t: 'tiles'; tiles: TileData[] }
  | { t: 'cities'; cities: Record<number, CoopCity>; day: number }
  | { t: 'players'; players: CoopPlayer[] }
  | { t: 'cursor'; slot: number; tile: TilePos | null }
  | { t: 'news'; text: string; kind: 'positive' | 'negative' | 'neutral' }
  | { t: 'proposals'; proposals: Proposal[]; now: number } // `now` lets clients show countdowns on their own clock
  | { t: 'bridges'; bridges: BridgeInfo[] }
  | { t: 'asset_added'; asset: RoomAsset }
  | { t: 'licences'; licences: Licence[] };
