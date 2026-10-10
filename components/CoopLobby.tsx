/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useRef, useState } from 'react';
import { COOP_PLOT_SIZES, MAX_PLAYERS, PLAYER_COLORS } from '../constants';
import { CoopGame } from '../services/coop/useCoopGame';
import { worldSize } from '../services/coop/world';
import { CoopSave, parseCoopSave } from '../services/coop/saveFile';
import { CloseIcon, FileCheckIcon, UploadIcon } from './Icons';

const NAME_KEY = 'skymetropolis-player-name';
const COLOR_KEY = 'skymetropolis-player-color';

const readSaved = (key: string, fallback: string) => {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};
const save = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* Private mode: just don't remember */ }
};

interface CoopLobbyProps {
  coop: CoopGame;
  onBack: () => void;
}

const CoopLobby: React.FC<CoopLobbyProps> = ({ coop, onBack }) => {
  const [tab, setTab] = useState<'host' | 'join'>('host');
  const [name, setName] = useState(() => readSaved(NAME_KEY, ''));
  const [color, setColor] = useState(() => readSaved(COLOR_KEY, PLAYER_COLORS[0]));
  const [code, setCode] = useState('');
  const [hostPlotSize, setHostPlotSize] = useState(coop.plotSize);
  const [copied, setCopied] = useState(false);
  // A saved co-op world to continue, and which of its cities is yours
  const [world, setWorld] = useState<{ fileName: string; save: CoopSave } | null>(null);
  const [worldSlot, setWorldSlot] = useState(0);
  const [worldError, setWorldError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const inRoom = coop.phase === 'lobby';
  const connecting = coop.phase === 'connecting';
  const isHost = coop.role === 'host';

  const remember = () => { save(NAME_KEY, name.trim()); save(COLOR_KEY, color); };

  const loadWorld = async (file: File | undefined) => {
    if (!file) return;
    try {
      const saved = parseCoopSave(await file.text());
      setWorld({ fileName: file.name, save: saved });
      setWorldError(null);
      // Default to the city saved under your name
      const mine = saved.players.find(p => p.name.toLowerCase() === name.trim().toLowerCase());
      setWorldSlot((mine ?? saved.players[0]).slot);
    } catch (err) {
      setWorldError(err instanceof Error ? err.message : 'Could not read this file.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const openRoom = () => { remember(); coop.hostGame(name, color, hostPlotSize, world?.save, worldSlot); };
  const join = () => { remember(); coop.joinGame(code, name, color); };
  const back = () => { coop.leave(); onBack(); };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(coop.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* Clipboard blocked: the code is still visible to read out */ }
  };

  const sizeLabel = (size: number) => `${size} × ${size} each · world ${worldSize(size)} × ${worldSize(size)}`;

  return (
    <div className="absolute inset-0 flex flex-col items-center overflow-y-auto z-50 text-white font-sans p-6 bg-black/30 backdrop-blur-sm">
      <div className="my-auto max-w-md w-full bg-slate-900/90 p-8 rounded-2xl border border-slate-700 shadow-2xl backdrop-blur-xl relative overflow-hidden animate-fade-in">
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10">
          <button onClick={back} className="text-xs text-slate-400 hover:text-white mb-4 font-bold uppercase tracking-widest">← Back</button>
          <h1 className="text-3xl font-black mb-1 bg-gradient-to-br from-white via-cyan-200 to-blue-400 bg-clip-text text-transparent tracking-tight">
            River Cities
          </h1>
          <p className="text-slate-400 mb-6 text-xs font-medium uppercase tracking-widest">
            Co-op · up to {MAX_PLAYERS} friends · each builds a city by the river
          </p>

          {!inRoom ? (
            <>
              {/* Who you are */}
              <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 mb-4">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-widest mb-2" htmlFor="coop-name">Your name</label>
                <input
                  id="coop-name"
                  value={name}
                  maxLength={16}
                  onChange={e => setName(e.target.value)}
                  placeholder="Mayor"
                  className="w-full bg-slate-700 text-slate-100 text-sm font-bold rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                />
                <div className="flex gap-2 mt-3" role="radiogroup" aria-label="Your colour">
                  {PLAYER_COLORS.map(c => (
                    <button
                      key={c}
                      role="radio"
                      aria-checked={color === c}
                      aria-label={`Colour ${c}`}
                      onClick={() => setColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Host or join */}
              <div className="flex gap-1 mb-4 bg-slate-800/60 p-1 rounded-lg" role="tablist">
                {(['host', 'join'] as const).map(t => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`flex-1 py-2 rounded-md text-sm font-bold transition-colors ${tab === t ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    {t === 'host' ? 'Host a room' : 'Join a room'}
                  </button>
                ))}
              </div>

              {tab === 'host' ? (
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 mb-4">
                  {world ? (
                    <>
                      <span className="block text-xs font-bold text-slate-300 uppercase tracking-widest mb-2">Continue a saved world</span>
                      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
                        <FileCheckIcon className="w-4 h-4 text-cyan-300 flex-shrink-0" />
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-bold text-cyan-100 truncate" title={world.fileName}>{world.fileName}</span>
                          <span className="text-[10px] text-cyan-300/80">
                            Day {world.save.day} · {world.save.players.length} {world.save.players.length === 1 ? 'city' : 'cities'} · {world.save.bridges.length} {world.save.bridges.length === 1 ? 'bridge' : 'bridges'} · {sizeLabel(world.save.plotSize)}
                          </span>
                        </div>
                        <button
                          onClick={() => setWorld(null)}
                          title="Start a new world instead"
                          aria-label="Remove saved world"
                          className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors flex-shrink-0"
                        >
                          <CloseIcon className="w-4 h-4" />
                        </button>
                      </div>
                      <label className="block text-xs font-bold text-slate-300 uppercase tracking-widest mt-3 mb-2" htmlFor="coop-world-slot">Your city</label>
                      <select
                        id="coop-world-slot"
                        value={worldSlot}
                        onChange={e => setWorldSlot(Number(e.target.value))}
                        className="w-full bg-slate-700 text-slate-100 text-sm font-bold rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 cursor-pointer"
                      >
                        {world.save.players.map(p => (
                          <option key={p.slot} value={p.slot}>
                            {p.name}'s city · ${world.save.cities[p.slot]?.money.toLocaleString() ?? 0} · {world.save.cities[p.slot]?.population ?? 0} citizens
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-slate-500 mt-2">Friends get their own city back by joining with the same name they used before.</p>
                    </>
                  ) : (
                    <>
                      <label className="block text-xs font-bold text-slate-300 uppercase tracking-widest mb-2" htmlFor="coop-size">Plot size</label>
                      <select
                        id="coop-size"
                        value={hostPlotSize}
                        onChange={e => setHostPlotSize(Number(e.target.value))}
                        className="w-full bg-slate-700 text-slate-100 text-sm font-bold rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 cursor-pointer"
                      >
                        {COOP_PLOT_SIZES.map(s => <option key={s} value={s}>{sizeLabel(s)}</option>)}
                      </select>
                      <p className="text-[11px] text-slate-500 mt-2">Every player gets their own plot. A river runs between the plots and meets in a lake in the middle.</p>
                    </>
                  )}

                  <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={e => loadWorld(e.target.files?.[0])} />
                  {!world && (
                    <button
                      onClick={() => fileInput.current?.click()}
                      className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 text-sm font-bold text-slate-200 bg-slate-700/40 hover:bg-slate-700/70 hover:text-white border border-dashed border-slate-500 hover:border-cyan-500/60 rounded-lg transition-colors"
                    >
                      <UploadIcon className="w-4 h-4" />
                      Load saved world
                      <span className="text-[10px] font-mono font-normal text-slate-400">.json</span>
                    </button>
                  )}
                  {worldError && <p className="mt-2 text-xs text-red-400" role="alert">{worldError}</p>}
                </div>
              ) : (
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 mb-4">
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-widest mb-2" htmlFor="coop-code">Room code</label>
                  <input
                    id="coop-code"
                    value={code}
                    onChange={e => setCode(e.target.value.toUpperCase())}
                    onKeyDown={e => { if (e.key === 'Enter' && code.trim()) join(); }}
                    placeholder="SKY-7QK2"
                    autoCapitalize="characters"
                    className="w-full bg-slate-700 text-slate-100 text-lg font-mono font-bold tracking-widest rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                  />
                </div>
              )}

              {coop.error && <p className="mb-4 text-xs text-red-400" role="alert">{coop.error}</p>}

              <button
                onClick={tab === 'host' ? openRoom : join}
                disabled={connecting || (tab === 'join' && !code.trim())}
                className="w-full py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg text-lg tracking-wide transition-all"
              >
                {connecting ? 'Connecting…' : tab === 'host' ? (world ? 'Open Room with Saved World' : 'Open Room') : 'Join Room'}
              </button>
            </>
          ) : (
            <>
              {/* In the room, before the game starts */}
              <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 mb-4 text-center">
                <span className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Room code</span>
                <div className="flex items-center justify-center gap-3">
                  <span className="text-3xl font-mono font-black tracking-widest text-cyan-200">{coop.roomCode}</span>
                  <button
                    onClick={copyCode}
                    className="text-xs font-bold px-2.5 py-1.5 rounded-md bg-slate-700 hover:bg-slate-600 border border-slate-600"
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-2">{isHost ? 'Send this code to your friends so they can join.' : 'Waiting for the host to start the game…'}</p>
              </div>

              <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 mb-4">
                <span className="block text-xs font-bold text-slate-300 uppercase tracking-widest mb-2">
                  Players {coop.players.length}/{MAX_PLAYERS}
                </span>
                <ul className="flex flex-col gap-2">
                  {coop.players.map(p => (
                    <li key={p.slot} className={`flex items-center gap-2 text-sm ${p.online ? '' : 'opacity-60'}`}>
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                      <span className="font-bold truncate">{p.name}</span>
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                        {[p.host && 'host', p.slot === coop.mySlot && 'you', !p.online && 'waiting to rejoin'].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 mb-6">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-widest mb-2" htmlFor="coop-size-room">Plot size</label>
                {isHost && !coop.loadedSave ? (
                  <select
                    id="coop-size-room"
                    value={coop.plotSize}
                    onChange={e => coop.changePlotSize(Number(e.target.value))}
                    className="w-full bg-slate-700 text-slate-100 text-sm font-bold rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 cursor-pointer"
                  >
                    {COOP_PLOT_SIZES.map(s => <option key={s} value={s}>{sizeLabel(s)}</option>)}
                  </select>
                ) : (
                  <span id="coop-size-room" className="text-sm font-bold text-slate-200">{sizeLabel(coop.plotSize)}</span>
                )}
              </div>

              {isHost && (
                <button
                  onClick={coop.startGame}
                  className="w-full py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl shadow-lg text-lg tracking-wide transition-all"
                >
                  {coop.loadedSave
                    ? `Continue from Day ${coop.loadedSave.day}`
                    : coop.players.length > 1 ? 'Start Building Together' : 'Start (friends can join later)'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CoopLobby;
