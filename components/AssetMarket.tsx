/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState } from 'react';
import { CoopPlayer } from '../types';
import { ASSET_TIERS, LICENCE_DAY_OPTIONS, MAX_PROFIT_SHARE } from '../constants';
import { Deal, Licence, Proposal, RoomAsset } from '../services/coop/protocol';
import { AssetTerms, monumentStats } from '../services/assets/spec';
import { licenceValid } from '../services/coop/hostSim';

export interface MarketInfo {
  mySlot: number;
  players: CoopPlayer[];
  assets: RoomAsset[];
  licences: Licence[];
  proposals: Proposal[];
  day: number;
  money: number;
  onPropose: (to: number, deal: Deal) => void;
}

const termsText = (t: AssetTerms) => `$${t.price.toLocaleString()} · ${t.days} days${t.share > 0 ? ` · ${t.share}% of tourism` : ''}`;

// Edit the terms before sending (both sides must still agree)
const TermsForm = ({ initial, label, onSend, onCancel }: { initial: AssetTerms; label: string; onSend: (t: AssetTerms) => void; onCancel: () => void }) => {
  const [t, setT] = useState(initial);
  return (
    <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px] text-slate-400">
      <label>Price ($)
        <input type="number" min={0} value={t.price} onChange={e => setT({ ...t, price: Math.max(0, Math.round(Number(e.target.value) || 0)) })} className="mt-0.5 block w-full bg-slate-800 text-xs text-white rounded px-1.5 py-1 border border-slate-600" />
      </label>
      <label>Lasts
        <select value={t.days} onChange={e => setT({ ...t, days: Number(e.target.value) })} className="mt-0.5 block w-full bg-slate-800 text-xs text-white rounded px-1 py-1 border border-slate-600">
          {LICENCE_DAY_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}
        </select>
      </label>
      <label>Share %
        <input type="number" min={0} max={MAX_PROFIT_SHARE} value={t.share} onChange={e => setT({ ...t, share: Math.min(MAX_PROFIT_SHARE, Math.max(0, Math.round(Number(e.target.value) || 0))) })} className="mt-0.5 block w-full bg-slate-800 text-xs text-white rounded px-1.5 py-1 border border-slate-600" />
      </label>
      <div className="col-span-3 flex gap-1.5">
        <button onClick={() => onSend(t)} className="text-[10px] font-bold px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white">{label}</button>
        <button onClick={onCancel} className="text-[10px] font-bold px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white">Cancel</button>
      </div>
    </div>
  );
};

// Assets shared in this room, their creators' terms, and your licences
export const AssetMarketPanel: React.FC<{ info: MarketInfo }> = ({ info }) => {
  const { mySlot, assets, licences, day } = info;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ assetId: string; to: number } | null>(null);
  const nameOf = (slot: number) => info.players.find(p => p.slot === slot)?.name ?? `Player ${slot + 1}`;
  const colorOf = (slot: number) => info.players.find(p => p.slot === slot)?.color ?? '#64748b';
  const pendingFor = (assetId: string, other: number) => info.proposals.some(p =>
    p.deal.kind === 'asset_licence' && p.deal.assetId === assetId && ((p.from === mySlot && p.to === other) || (p.from === other && p.to === mySlot)));

  const sorted = [...assets].sort((a, b) => Number(a.creator === mySlot) - Number(b.creator === mySlot) || a.spec.name.localeCompare(b.spec.name));
  const send = (assetId: string, to: number, t: AssetTerms) => {
    info.onPropose(to, { kind: 'asset_licence', assetId, price: t.price, days: t.days, share: t.share });
    setEditing(null);
  };

  return (
    <div className="w-full bg-slate-900/90 text-white rounded-xl border border-violet-500/40 shadow-2xl backdrop-blur-md overflow-hidden">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full bg-slate-800/80 px-3 md:px-4 py-1.5 flex justify-between items-center border-b border-slate-700">
        <span className="font-bold uppercase text-[10px] md:text-xs tracking-widest">Asset Market</span>
        <span className="text-[10px] text-slate-400">{assets.length} shared {open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="p-2 md:p-3 flex flex-col gap-2 max-h-72 overflow-y-auto">
          {assets.length === 0 && (
            <p className="text-[11px] text-slate-400 leading-snug">
              No assets shared yet. Pick the <span className="font-bold text-slate-200">Monument</span> tool and choose one of your designs to share it with the room. Friends can then ask you for a licence to build it.
            </p>
          )}
          {sorted.map(a => {
            const mine = a.creator === mySlot;
            const myLicence = licences.find(l => l.assetId === a.id && l.holder === mySlot);
            const valid = myLicence && licenceValid(myLicence, day);
            const daysLeft = myLicence ? Math.max(0, myLicence.expiresDay - day) : 0;
            const granted = licences.filter(l => l.assetId === a.id && l.creator === mySlot);
            const others = info.players.filter(p => p.slot !== mySlot && !granted.some(l => l.holder === p.slot && licenceValid(l, day)));
            const cost = monumentStats(a.spec.tier, a.spec.footprint).cost;
            return (
              <div key={a.id} className="rounded-lg border border-slate-700 bg-slate-800/40 p-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold truncate">{a.spec.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {ASSET_TIERS[a.spec.tier].label} · {a.spec.footprint[0]}×{a.spec.footprint[1]} · build ${cost.toLocaleString()} · by <span style={{ color: colorOf(a.creator) }}>{mine ? 'you' : nameOf(a.creator)}</span>
                    </p>
                    <p className="text-[10px] text-violet-200/90">Licence: {termsText(a.terms)}</p>
                  </div>
                  {!mine && myLicence && (
                    <span className={`text-[10px] font-bold whitespace-nowrap ${!valid ? 'text-red-400' : daysLeft <= 10 ? 'text-amber-300' : 'text-emerald-300'}`}>
                      {valid ? `${daysLeft} days left` : 'Expired'}
                    </span>
                  )}
                </div>

                {mine ? (
                  <>
                    {granted.length > 0 && (
                      <p className="text-[10px] text-slate-400 mt-1">
                        Licensed to {granted.map(l => `${nameOf(l.holder)} (${licenceValid(l, day) ? `${l.expiresDay - day}d` : 'expired'}${l.share ? `, ${l.share}%` : ''})`).join(', ')}
                      </p>
                    )}
                    {others.length > 0 && editing?.assetId !== a.id && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {others.map(p => (
                          <button
                            key={p.slot}
                            disabled={pendingFor(a.id, p.slot)}
                            onClick={() => setEditing({ assetId: a.id, to: p.slot })}
                            className="text-[10px] font-bold px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 disabled:opacity-40"
                          >
                            {pendingFor(a.id, p.slot) ? `Waiting for ${p.name}` : `Offer to ${p.name}`}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : editing?.assetId !== a.id && (
                  <button
                    disabled={pendingFor(a.id, a.creator)}
                    onClick={() => setEditing({ assetId: a.id, to: a.creator })}
                    className="mt-1.5 text-[10px] font-bold px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-40"
                  >
                    {pendingFor(a.id, a.creator) ? 'Waiting for an answer' : myLicence ? 'Renew licence' : 'Ask to licence'}
                  </button>
                )}

                {editing?.assetId === a.id && (
                  <TermsForm
                    initial={a.terms}
                    label={mine ? `Offer to ${nameOf(editing.to)}` : `Send to ${nameOf(a.creator)}`}
                    onSend={t => send(a.id, editing.to, t)}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
