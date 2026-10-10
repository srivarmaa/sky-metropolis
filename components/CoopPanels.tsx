/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useEffect, useState } from 'react';
import { CoopPlayer, EconomyReport } from '../types';
import { BridgeInfo, Deal, Proposal } from '../services/coop/protocol';
import { describeDeal } from '../services/coop/deals';

export interface DealsInfo {
  mySlot: number;
  players: CoopPlayer[];
  proposals: Proposal[];
  bridges: (BridgeInfo & { linked: boolean })[];
  clockOffset: number; // Host clock minus ours
  economy: EconomyReport; // Your city (for commuter numbers)
  onRespond: (id: string, accept: boolean) => void;
  onCancel: (id: string) => void;
  onPropose: (to: number, deal: Deal) => void;
  assetName: (id: string) => string;
}

const secondsLeft = (p: Proposal, clockOffset: number) => Math.max(0, Math.ceil((p.expiresAt - (Date.now() + clockOffset)) / 1000));

const Btn = ({ onClick, children, tone = 'neutral' }: { onClick: () => void; children: React.ReactNode; tone?: 'good' | 'bad' | 'neutral' }) => (
  <button
    onClick={onClick}
    className={`text-[10px] md:text-xs font-bold px-2 py-1 rounded-md border transition-colors ${
      tone === 'good' ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400/50'
      : tone === 'bad' ? 'bg-slate-700 hover:bg-red-700/70 border-slate-600'
      : 'bg-slate-700 hover:bg-slate-600 border-slate-600'}`}
  >
    {children}
  </button>
);

// Bridges and other two-city deals. Every deal needs the other player to accept.
export const DealsPanel: React.FC<{ info: DealsInfo }> = ({ info }) => {
  const { mySlot, proposals, bridges, economy } = info;
  const nameOf = (slot: number) => info.players.find(p => p.slot === slot)?.name ?? `Player ${slot + 1}`;
  const colorOf = (slot: number) => info.players.find(p => p.slot === slot)?.color ?? '#64748b';

  const incoming = proposals.filter(p => p.to === mySlot);
  const outgoing = proposals.filter(p => p.from === mySlot);
  const myBridges = bridges.filter(b => b.a === mySlot || b.b === mySlot);

  // Tick once a second while countdowns are showing
  const [, setNow] = useState(0);
  useEffect(() => {
    if (proposals.length === 0) return;
    const id = setInterval(() => setNow(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [proposals.length]);

  const pending = (bridgeId: string) => proposals.some(p => (p.deal.kind === 'remove_bridge' || p.deal.kind === 'bridge_commuting') && p.deal.bridgeId === bridgeId);

  return (
    <div className="w-full bg-slate-900/90 text-white rounded-xl border border-slate-700 shadow-2xl backdrop-blur-md overflow-hidden">
      <div className="bg-slate-800/80 px-3 md:px-4 py-1.5 flex justify-between items-center border-b border-slate-700">
        <span className="font-bold uppercase text-[10px] md:text-xs tracking-widest">Bridges & Deals</span>
        {(economy.commutersIn > 0 || economy.commutersOut > 0) && (
          <span
            className="text-[10px] font-mono text-slate-300"
            title={`${economy.commutersOut} of your residents work across the river; ${economy.commutersIn} commuters work in your city. Wage tax: ${economy.commuteTax >= 0 ? '+' : '−'}$${Math.abs(economy.commuteTax).toFixed(1)}/day`}
          >
            ⇄ {economy.commutersOut} out · {economy.commutersIn} in
            <span className={economy.commuteTax >= 0 ? 'text-green-300' : 'text-amber-300'}> {economy.commuteTax >= 0 ? '+' : '−'}${Math.abs(economy.commuteTax).toFixed(1)}</span>
          </span>
        )}
      </div>

      <div className="p-2 md:p-3 flex flex-col gap-2 max-h-56 overflow-y-auto">
        {incoming.map(p => (
          <div key={p.id} className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-2 animate-fade-in" role="alert">
            <p className="text-[11px] md:text-xs leading-snug">
              <span className="font-bold" style={{ color: colorOf(p.from) }}>{nameOf(p.from)}</span> proposes to {describeDeal(p.deal, info.assetName)}.
            </p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <Btn tone="good" onClick={() => info.onRespond(p.id, true)}>Accept</Btn>
              <Btn tone="bad" onClick={() => info.onRespond(p.id, false)}>Decline</Btn>
              <span className="ml-auto text-[10px] font-mono text-slate-400">{secondsLeft(p, info.clockOffset)}s</span>
            </div>
          </div>
        ))}

        {outgoing.map(p => (
          <div key={p.id} className="rounded-lg border border-slate-700 bg-slate-800/60 p-2">
            <p className="text-[11px] md:text-xs text-slate-300 leading-snug">
              Waiting for <span className="font-bold" style={{ color: colorOf(p.to) }}>{nameOf(p.to)}</span> to agree to {describeDeal(p.deal, info.assetName)}.
            </p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <Btn onClick={() => info.onCancel(p.id)}>Cancel</Btn>
              <span className="ml-auto text-[10px] font-mono text-slate-400">{secondsLeft(p, info.clockOffset)}s</span>
            </div>
          </div>
        ))}

        {myBridges.map(b => {
          const other = b.a === mySlot ? b.b : b.a;
          const status = !b.linked ? { text: 'Needs a road at both ends', cls: 'text-amber-300' }
            : !b.commuting ? { text: 'Closed to commuters', cls: 'text-slate-400' }
            : { text: 'Open to commuters', cls: 'text-emerald-300' };
          return (
            <div key={b.id} className="rounded-lg border border-slate-700 bg-slate-800/40 p-2">
              <div className="flex items-center gap-2 text-[11px] md:text-xs">
                <span aria-hidden>🌉</span>
                <span>Bridge to <span className="font-bold" style={{ color: colorOf(other) }}>{nameOf(other)}</span></span>
                <span className={`ml-auto text-[10px] ${status.cls}`}>{status.text}</span>
              </div>
              {!pending(b.id) ? (
                <div className="flex gap-1.5 mt-1.5">
                  <Btn onClick={() => info.onPropose(other, { kind: 'bridge_commuting', bridgeId: b.id, open: !b.commuting })}>
                    {b.commuting ? 'Propose closing' : 'Propose reopening'}
                  </Btn>
                  <Btn tone="bad" onClick={() => info.onPropose(other, { kind: 'remove_bridge', bridgeId: b.id })}>Propose removing</Btn>
                </div>
              ) : (
                <p className="text-[10px] text-slate-500 mt-1">A change to this bridge is waiting for an answer.</p>
              )}
            </div>
          );
        })}

        {incoming.length === 0 && outgoing.length === 0 && myBridges.length === 0 && (
          <p className="text-[11px] text-slate-400 leading-snug">
            Pick the <span className="font-bold text-slate-200">Bridge</span> tool and click the river beside a friend's plot to propose a bridge.
            Once they accept, unemployed citizens can commute to jobs on either side.
          </p>
        )}
      </div>
    </div>
  );
};
