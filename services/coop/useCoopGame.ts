/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useCallback, useEffect, useRef, useState } from 'react';
import { BuildingType, CoopCity, CoopPlayer, Grid, TileData } from '../../types';
import { COOP_DEFAULT_PLOT_SIZE, MAX_PLAYERS, PLAYER_COLORS, PROPOSAL_TTL_MS } from '../../constants';
import { tryBuild } from '../build';
import { CITY_PROBLEM_NEWS, CityProblem } from '../economy';
import { encodeRows } from '../layoutFile';
import { BridgeInfo, ClientMessage, Deal, HostMessage, Proposal } from './protocol';
import { ClientSession, HostSession, formatCode, hostRoom, joinRoom } from './session';
import { TilePos, createCoopWorld, riverCrossing, worldFromRows } from './world';
import { commuteLinks, newCoopCity, simulateCoopDay } from './hostSim';
import { checkDeal, describeDeal, sameDeal, settleDeal } from './deals';
import { CoopSave, downloadCoopSave } from './saveFile';

export type CoopRole = 'host' | 'client';
export type CoopPhase = 'idle' | 'connecting' | 'lobby' | 'playing' | 'ended';
export type { TilePos };
type NewsKind = 'positive' | 'negative' | 'neutral';

interface CoopOptions {
  getGrid: () => Grid;
  setWorld: (grid: Grid) => void; // Replace the whole map
  applyTiles: (tiles: TileData[]) => void; // Change a few tiles
  addNews: (text: string, kind: NewsKind) => void;
  onStart: () => void; // The game begins (host pressed Start, or a client received the world)
}

const MAX_PENDING_PER_PLAYER = 5;

const cleanName = (name: string, slot: number) => name.trim().replace(/\s+/g, ' ').slice(0, 16) || `Player ${slot + 1}`;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Co-op rooms. The host's browser runs every city and checks every build; clients send requests
 * and show what the host sends back. Each player builds only on their own plot and pays from their own treasury.
 * Anything between two cities (bridges, and later trades) is a proposal the other player must accept.
 */
export function useCoopGame(options: CoopOptions) {
  const opts = useRef(options);
  opts.current = options;

  const [role, setRole] = useState<CoopRole | null>(null);
  const [phase, setPhaseState] = useState<CoopPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [players, setPlayersState] = useState<CoopPlayer[]>([]);
  const [mySlot, setMySlot] = useState<number | null>(null);
  const [plotSize, setPlotSizeState] = useState(COOP_DEFAULT_PLOT_SIZE);
  const [cities, setCitiesState] = useState<Record<number, CoopCity>>({});
  const [cursors, setCursors] = useState<Record<number, TilePos>>({});
  const [proposals, setProposalsState] = useState<Proposal[]>([]);
  const [bridges, setBridgesState] = useState<BridgeInfo[]>([]);
  const [clockOffset, setClockOffset] = useState(0); // Host clock minus ours, for countdowns
  const [loadedSave, setLoadedSave] = useState<CoopSave | null>(null); // Host: the saved world being continued
  const savedRef = useRef<CoopSave | null>(null);

  const host = useRef<HostSession | null>(null);
  const client = useRef<ClientSession | null>(null);
  const peerSlots = useRef(new Map<string, number>()); // Host: peer id -> player slot
  const phaseRef = useRef<CoopPhase>('idle');
  const roleRef = useRef<CoopRole | null>(null);
  const playersRef = useRef<CoopPlayer[]>([]);
  const citiesRef = useRef<Record<number, CoopCity>>({});
  const proposalsRef = useRef<Proposal[]>([]);
  const bridgesRef = useRef<BridgeInfo[]>([]);
  const plotSizeRef = useRef(COOP_DEFAULT_PLOT_SIZE);
  const mySlotRef = useRef<number | null>(null);
  const problemsRef = useRef<Record<number, CityProblem[]>>({});
  const dayRef = useRef(1);

  const setPhase = (p: CoopPhase) => { phaseRef.current = p; setPhaseState(p); };
  const setRoleBoth = (r: CoopRole | null) => { roleRef.current = r; setRole(r); };
  const setPlayers = (p: CoopPlayer[]) => { playersRef.current = p; setPlayersState(p); };
  const setCities = (c: Record<number, CoopCity>) => { citiesRef.current = c; setCitiesState(c); };
  const setProposals = (p: Proposal[]) => { proposalsRef.current = p; setProposalsState(p); };
  const setBridges = (b: BridgeInfo[]) => { bridgesRef.current = b; setBridgesState(b); };
  const setPlotSize = (size: number) => { plotSizeRef.current = size; setPlotSizeState(size); };
  const setMine = (slot: number | null) => { mySlotRef.current = slot; setMySlot(slot); };
  const nameOf = (slot: number) => playersRef.current.find(p => p.slot === slot)?.name ?? `Player ${slot + 1}`;

  const reset = () => {
    host.current?.close();
    client.current?.close();
    host.current = null;
    client.current = null;
    peerSlots.current.clear();
    problemsRef.current = {};
    savedRef.current = null;
    setLoadedSave(null);
    setRoleBoth(null);
    setPhase('idle');
    setRoomCode('');
    setPlayers([]);
    setCities({});
    setCursors({});
    setProposals([]);
    setBridges([]);
    setMine(null);
  };

  useEffect(() => () => { host.current?.close(); client.current?.close(); }, []);

  // --- Host ---

  const peerOfSlot = (slot: number) => [...peerSlots.current].find(([, s]) => s === slot)?.[0];

  // Tell one player something: the host shows it locally, others get a message
  const notify = (slot: number, text: string, kind: NewsKind) => {
    if (slot === mySlotRef.current) opts.current.addNews(text, kind);
    else { const peer = peerOfSlot(slot); if (peer) host.current?.send(peer, { t: 'news', text, kind }); }
  };
  const announce = (text: string, kind: NewsKind, exceptSlot?: number) => {
    const except = exceptSlot === undefined ? undefined : peerOfSlot(exceptSlot);
    host.current?.broadcast({ t: 'news', text, kind }, except);
    if (exceptSlot !== mySlotRef.current) opts.current.addNews(text, kind);
  };

  const sendLobbyToAll = () => {
    peerSlots.current.forEach((slot, peer) =>
      host.current?.send(peer, { t: 'lobby', players: playersRef.current, plotSize: plotSizeRef.current, you: slot }));
  };

  const welcomeFor = (slot: number): HostMessage => ({
    t: 'welcome', you: slot, plotSize: plotSizeRef.current, rows: encodeRows(opts.current.getGrid()),
    players: playersRef.current, cities: citiesRef.current, day: dayRef.current,
    bridges: bridgesRef.current, proposals: proposalsRef.current, now: Date.now(),
  });

  const broadcastCities = () => host.current?.broadcast({ t: 'cities', cities: citiesRef.current, day: dayRef.current });
  const publishProposals = (next: Proposal[]) => {
    setProposals(next);
    host.current?.broadcast({ t: 'proposals', proposals: next, now: Date.now() });
  };
  const publishBridges = (next: BridgeInfo[]) => {
    setBridges(next);
    host.current?.broadcast({ t: 'bridges', bridges: next });
  };
  const dealWorld = () => ({
    grid: opts.current.getGrid(), plotSize: plotSizeRef.current, cities: citiesRef.current,
    bridges: bridgesRef.current, players: playersRef.current,
  });

  // Apply a build for any player (the host's own clicks too); everyone sees the result
  const hostBuild = (slot: number, x: number, y: number, tool: BuildingType) => {
    const city = citiesRef.current[slot];
    if (!city) return;
    const result = tryBuild(opts.current.getGrid(), city.stats.money, x, y, tool, slot);
    if (!result.ok) {
      if (result.reason) notify(slot, result.reason, 'negative');
      return;
    }
    opts.current.applyTiles([result.tile!]);
    setCities({ ...citiesRef.current, [slot]: { ...city, stats: { ...city.stats, money: city.stats.money - result.cost! } } });
    host.current?.broadcast({ t: 'tiles', tiles: [result.tile!] });
    broadcastCities();
  };

  // A player proposes a deal; nothing changes until the other player accepts
  const hostPropose = (from: number, to: number, deal: Deal) => {
    const problem = checkDeal(dealWorld(), from, to, deal);
    if (problem) { notify(from, problem, 'negative'); return; }
    const pending = proposalsRef.current;
    if (pending.some(p => sameDeal(p.deal, deal) && ((p.from === from && p.to === to) || (p.from === to && p.to === from)))) {
      notify(from, 'That is already waiting for an answer.', 'neutral');
      return;
    }
    if (pending.filter(p => p.from === from).length >= MAX_PENDING_PER_PLAYER) {
      notify(from, 'You have too many proposals waiting. Cancel one or wait for answers.', 'negative');
      return;
    }
    publishProposals([...pending, { id: newId(), from, to, deal, expiresAt: Date.now() + PROPOSAL_TTL_MS }]);
    notify(to, `${nameOf(from)} proposes to ${describeDeal(deal)}. Answer in the River Cities panel.`, 'neutral');
    notify(from, `Proposal sent to ${nameOf(to)}. Waiting for them to accept.`, 'neutral');
  };

  const hostRespond = (slot: number, id: string, accept: boolean) => {
    const p = proposalsRef.current.find(q => q.id === id);
    if (!p || p.to !== slot) return; // Only the player asked can answer
    publishProposals(proposalsRef.current.filter(q => q.id !== id));
    if (!accept) {
      notify(p.from, `${nameOf(p.to)} declined to ${describeDeal(p.deal)}.`, 'neutral');
      return;
    }
    const s = settleDeal(dealWorld(), p, nameOf);
    if (!s.ok) {
      // Nothing changed for either side
      notify(p.from, `Deal with ${nameOf(p.to)} fell through: ${s.reason}`, 'negative');
      notify(p.to, `Deal with ${nameOf(p.from)} fell through: ${s.reason}`, 'negative');
      return;
    }
    if (s.tiles?.length) {
      opts.current.applyTiles(s.tiles);
      host.current?.broadcast({ t: 'tiles', tiles: s.tiles });
    }
    if (s.cities) { setCities(s.cities); broadcastCities(); }
    if (s.bridges) publishBridges(s.bridges);
    if (s.news) announce(s.news, 'positive');
  };

  const hostCancel = (slot: number, id: string) => {
    const p = proposalsRef.current.find(q => q.id === id);
    if (!p || p.from !== slot) return; // Only the proposer can withdraw
    publishProposals(proposalsRef.current.filter(q => q.id !== id));
    notify(p.to, `${nameOf(p.from)} withdrew their proposal to ${describeDeal(p.deal)}.`, 'neutral');
  };

  const onPeerMessage = (peer: string, msg: ClientMessage) => {
    const slot = peerSlots.current.get(peer);
    switch (msg.t) {
      case 'hello': {
        if (slot !== undefined || phaseRef.current === 'idle') return;
        const current = playersRef.current;
        const wantedName = cleanName(msg.name, current.length);
        // Returning players get their old plot back
        let newSlot = current.find(p => !p.online && p.name.toLowerCase() === wantedName.toLowerCase())?.slot;
        if (newSlot === undefined) {
          const used = new Set(current.map(p => p.slot));
          newSlot = Array.from({ length: MAX_PLAYERS }, (_, i) => i).find(i => !used.has(i));
        }
        if (newSlot === undefined) {
          host.current?.send(peer, { t: 'reject', reason: `This room is full (${MAX_PLAYERS} players).` });
          setTimeout(() => host.current?.kick(peer), 500);
          return;
        }
        // Keep colours distinct
        const takenColors = new Set(current.filter(p => p.online && p.slot !== newSlot).map(p => p.color));
        const color = takenColors.has(msg.color) ? PLAYER_COLORS.find(c => !takenColors.has(c)) ?? msg.color : msg.color;
        const player: CoopPlayer = { slot: newSlot, name: wantedName, color, online: true };

        peerSlots.current.set(peer, newSlot);
        setPlayers([...current.filter(p => p.slot !== newSlot), player].sort((a, b) => a.slot - b.slot));
        host.current?.broadcast({ t: 'players', players: playersRef.current });

        if (phaseRef.current === 'lobby') {
          sendLobbyToAll();
        } else if (phaseRef.current === 'playing') {
          if (!citiesRef.current[newSlot]) setCities({ ...citiesRef.current, [newSlot]: newCoopCity(dayRef.current) });
          host.current?.send(peer, welcomeFor(newSlot));
          host.current?.broadcast({ t: 'cities', cities: citiesRef.current, day: dayRef.current }, peer);
          announce(`${player.name} joined the river cities.`, 'positive', newSlot);
        }
        return;
      }
      case 'build':
        if (slot !== undefined && phaseRef.current === 'playing') hostBuild(slot, msg.x, msg.y, msg.tool);
        return;
      case 'cursor':
        if (slot === undefined) return;
        host.current?.broadcast({ t: 'cursor', slot, tile: msg.tile }, peer);
        setCursors(prev => {
          const next = { ...prev };
          if (msg.tile) next[slot] = msg.tile; else delete next[slot];
          return next;
        });
        return;
      case 'propose':
        if (slot !== undefined && phaseRef.current === 'playing') hostPropose(slot, msg.to, msg.deal);
        return;
      case 'respond':
        if (slot !== undefined && phaseRef.current === 'playing') hostRespond(slot, msg.id, msg.accept);
        return;
      case 'cancel':
        if (slot !== undefined) hostCancel(slot, msg.id);
        return;
    }
  };

  const onPeerLeave = (peer: string) => {
    const slot = peerSlots.current.get(peer);
    if (slot === undefined) return;
    peerSlots.current.delete(peer);
    if (phaseRef.current === 'lobby') {
      // Free the slot before the game starts (a saved city keeps its place for its owner)
      const saved = savedRef.current?.players.some(p => p.slot === slot);
      setPlayers(saved
        ? playersRef.current.map(p => (p.slot === slot ? { ...p, online: false } : p))
        : playersRef.current.filter(p => p.slot !== slot));
      sendLobbyToAll();
    } else {
      // Keep their city (it keeps running) so they can rejoin with the same name
      setPlayers(playersRef.current.map(p => (p.slot === slot ? { ...p, online: false } : p)));
      announce(`${nameOf(slot)} left. Their city keeps running until they rejoin.`, 'neutral');
    }
    host.current?.broadcast({ t: 'players', players: playersRef.current });
    host.current?.broadcast({ t: 'cursor', slot, tile: null });
    setCursors(prev => { const next = { ...prev }; delete next[slot]; return next; });
  };

  /**
   * Open a room. With a saved world, the host plays as `saveSlot` and the other saved cities wait
   * for their owners, who get them back by joining with the same name.
   */
  const hostGame = useCallback(async (name: string, color: string, size: number, save?: CoopSave, saveSlot?: number) => {
    setError(null);
    setPhase('connecting');
    try {
      const session = await hostRoom();
      host.current = session;
      session.setHandlers({ message: (peer, msg) => onPeerMessage(peer, msg), leave: peer => onPeerLeave(peer) });
      setRoleBoth('host');
      setRoomCode(formatCode(session.code));
      savedRef.current = save ?? null;
      setLoadedSave(save ?? null);
      if (save) {
        const slot = save.players.some(p => p.slot === saveSlot) ? saveSlot! : save.players[0].slot;
        setMine(slot);
        setPlayers(save.players.map(p => (p.slot === slot
          ? { slot, name: cleanName(name, slot), color, online: true, host: true }
          : { ...p, online: false })));
        setPlotSize(save.plotSize);
        opts.current.setWorld(worldFromRows(save.plotSize, save.rows));
      } else {
        setMine(0);
        setPlayers([{ slot: 0, name: cleanName(name, 0), color, online: true, host: true }]);
        setPlotSize(size);
        opts.current.setWorld(createCoopWorld(size));
      }
      setPhase('lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a room.');
      setPhase('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changePlotSize = useCallback((size: number) => {
    if (phaseRef.current !== 'lobby' || !host.current || savedRef.current) return; // A saved world keeps its size
    setPlotSize(size);
    opts.current.setWorld(createCoopWorld(size));
    sendLobbyToAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startGame = useCallback(() => {
    if (phaseRef.current !== 'lobby' || !host.current) return;
    const save = savedRef.current;
    if (save) {
      // Continue a saved world: every saved city keeps its treasury, even if its owner hasn't rejoined yet
      opts.current.setWorld(worldFromRows(save.plotSize, save.rows));
      dayRef.current = save.day;
      setCities(Object.fromEntries(playersRef.current.map(p => {
        const stats = save.cities[p.slot];
        return [p.slot, stats ? { ...newCoopCity(save.day), stats: { ...stats, day: save.day } } : newCoopCity(save.day)];
      })));
      setBridges(save.bridges);
    } else {
      opts.current.setWorld(createCoopWorld(plotSizeRef.current));
      dayRef.current = 1;
      setCities(Object.fromEntries(playersRef.current.map(p => [p.slot, newCoopCity(1)])));
      setBridges([]);
    }
    setProposals([]);
    setPhase('playing');
    peerSlots.current.forEach((slot, peer) => host.current?.send(peer, welcomeFor(slot)));
    opts.current.onStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One game day for every city (host only; called from the game loop)
  const hostTick = () => {
    if (roleRef.current !== 'host' || phaseRef.current !== 'playing') return;
    const grid = opts.current.getGrid();
    dayRef.current += 1;
    const day = simulateCoopDay(grid, citiesRef.current, dayRef.current, commuteLinks(grid, bridgesRef.current));
    setCities(day.cities);
    broadcastCities();

    // Each player hears about their own city's new problems
    for (const [key, problems] of Object.entries(day.problems)) {
      const slot = Number(key);
      const before = problemsRef.current[slot] ?? [];
      problems.filter(p => !before.includes(p)).forEach(p => notify(slot, CITY_PROBLEM_NEWS[p], 'negative'));
      problemsRef.current[slot] = problems;
    }

    // Unanswered proposals expire (nothing changes)
    const now = Date.now();
    const expired = proposalsRef.current.filter(p => p.expiresAt <= now);
    if (expired.length) {
      publishProposals(proposalsRef.current.filter(p => p.expiresAt > now));
      expired.forEach(p => notify(p.from, `${nameOf(p.to)} didn't answer in time; your proposal to ${describeDeal(p.deal)} expired.`, 'neutral'));
    }
  };

  // --- Client ---

  const onHostMessage = (msg: HostMessage) => {
    switch (msg.t) {
      case 'lobby':
        setPlayers(msg.players);
        setMine(msg.you);
        if (msg.plotSize !== plotSizeRef.current || phaseRef.current !== 'lobby') opts.current.setWorld(createCoopWorld(msg.plotSize));
        setPlotSize(msg.plotSize);
        setPhase('lobby');
        return;
      case 'welcome':
        setPlotSize(msg.plotSize);
        setMine(msg.you);
        setPlayers(msg.players);
        setCities(msg.cities);
        setBridges(msg.bridges);
        setProposals(msg.proposals);
        setClockOffset(msg.now - Date.now());
        dayRef.current = msg.day;
        opts.current.setWorld(worldFromRows(msg.plotSize, msg.rows));
        setPhase('playing');
        opts.current.onStart();
        return;
      case 'reject':
        reset();
        setError(msg.reason);
        return;
      case 'tiles':
        opts.current.applyTiles(msg.tiles);
        return;
      case 'cities':
        dayRef.current = msg.day;
        setCities(msg.cities);
        return;
      case 'players':
        setPlayers(msg.players);
        return;
      case 'cursor':
        setCursors(prev => {
          const next = { ...prev };
          if (msg.tile) next[msg.slot] = msg.tile; else delete next[msg.slot];
          return next;
        });
        return;
      case 'news':
        opts.current.addNews(msg.text, msg.kind);
        return;
      case 'proposals':
        setProposals(msg.proposals);
        setClockOffset(msg.now - Date.now());
        return;
      case 'bridges':
        setBridges(msg.bridges);
        return;
    }
  };

  const onHostClosed = () => {
    if (phaseRef.current === 'playing') {
      setPhase('ended'); // Keep the map on screen; the app offers to save it
    } else {
      reset();
      setError('The host closed the room.');
    }
  };

  const joinGame = useCallback(async (code: string, name: string, color: string) => {
    setError(null);
    setPhase('connecting');
    try {
      const session = await joinRoom(code);
      client.current = session;
      session.setHandlers({ message: msg => onHostMessage(msg), close: () => onHostClosed() });
      setRoleBoth('client');
      setRoomCode(formatCode(session.code));
      session.send({ t: 'hello', name, color });
      setPhase('lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join the room.');
      setPhase('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Shared actions (the host acts directly as slot 0; clients send requests) ---

  const propose = (to: number, deal: Deal) => {
    if (phaseRef.current !== 'playing' || mySlotRef.current === null) return;
    if (roleRef.current === 'host') hostPropose(mySlotRef.current, to, deal);
    else client.current?.send({ t: 'propose', to, deal });
  };

  const respond = (id: string, accept: boolean) => {
    if (phaseRef.current !== 'playing' || mySlotRef.current === null) return;
    if (roleRef.current === 'host') hostRespond(mySlotRef.current, id, accept);
    else client.current?.send({ t: 'respond', id, accept });
  };

  const cancel = (id: string) => {
    if (mySlotRef.current === null) return;
    if (roleRef.current === 'host') hostCancel(mySlotRef.current, id);
    else client.current?.send({ t: 'cancel', id });
  };

  // Clicking the map: bridges become proposals to the neighbour; everything else is a normal build
  const requestBuild = (x: number, y: number, tool: BuildingType) => {
    const me = mySlotRef.current;
    if (phaseRef.current !== 'playing' || me === null) return;
    const grid = opts.current.getGrid();
    const tile = grid[y]?.[x];

    if (tool === BuildingType.Bridge) {
      const crossing = riverCrossing(grid, plotSizeRef.current, x, y);
      if (!crossing) {
        opts.current.addNews('Bridges go straight across the river between two plots. Click the river right next to your land (the lake is too wide).', 'negative');
        return;
      }
      if (crossing.a !== me && crossing.b !== me) {
        opts.current.addNews('Bridges must start from your own riverbank.', 'negative');
        return;
      }
      const other = crossing.a === me ? crossing.b : crossing.a;
      if (!playersRef.current.some(p => p.slot === other)) {
        opts.current.addNews('No one has settled across the river there yet.', 'negative');
        return;
      }
      propose(other, { kind: 'bridge', tiles: crossing.tiles });
      return;
    }

    if (tool === BuildingType.None && tile?.buildingType === BuildingType.Bridge) {
      const bridge = bridgesRef.current.find(b => b.tiles.some(t => t.x === x && t.y === y));
      if (!bridge || (bridge.a !== me && bridge.b !== me)) {
        opts.current.addNews('Only the two cities a bridge joins can take it down.', 'negative');
        return;
      }
      propose(bridge.a === me ? bridge.b : bridge.a, { kind: 'remove_bridge', bridgeId: bridge.id });
      return;
    }

    if (roleRef.current === 'host') hostBuild(me, x, y, tool);
    else client.current?.send({ t: 'build', x, y, tool });
  };

  const sendCursor = (tile: TilePos | null) => {
    if (phaseRef.current !== 'playing') return;
    if (roleRef.current === 'host' && mySlotRef.current !== null) host.current?.broadcast({ t: 'cursor', slot: mySlotRef.current, tile });
    else client.current?.send({ t: 'cursor', tile });
  };

  // Download the whole world so the group can continue it later (any player can, not just the host)
  const exportSave = () => {
    downloadCoopSave({
      plotSize: plotSizeRef.current,
      day: dayRef.current,
      rows: encodeRows(opts.current.getGrid()),
      players: playersRef.current.map(({ slot, name, color }) => ({ slot, name, color })),
      cities: Object.fromEntries((Object.entries(citiesRef.current) as [string, CoopCity][]).map(([slot, c]) => [slot, c.stats])),
      bridges: bridgesRef.current,
    });
  };

  return {
    role, phase, error, roomCode, players, mySlot, plotSize, cities, cursors, proposals, bridges, clockOffset,
    active: phase === 'playing' || phase === 'ended',
    hostGame, joinGame, changePlotSize, startGame, leave: reset, clearError: () => setError(null),
    hostTick, requestBuild, sendCursor, propose, respond, cancel, exportSave, loadedSave,
  };
}

export type CoopGame = ReturnType<typeof useCoopGame>;
