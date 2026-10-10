/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import Peer, { DataConnection } from 'peerjs';
import { ClientMessage, HostMessage } from './protocol';

// Rooms are PeerJS peers named after a short code. PeerJS's free public server only introduces the
// browsers to each other; game data then flows directly between them over WebRTC.

const PEER_PREFIX = 'skymetropolis-room-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // No 0/O or 1/I/L, so codes are easy to read out
const CONNECT_TIMEOUT_MS = 15000;

const makeCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/^SKY-?/, '');
export const formatCode = (code: string) => `SKY-${code}`;

const friendlyError = (err: { type?: string; message?: string }) => {
  switch (err.type) {
    case 'peer-unavailable': return 'No room with that code. Check the code with your host.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return 'Could not reach the connection server. Check your internet connection and try again.';
    case 'browser-incompatible': return 'This browser does not support peer-to-peer connections.';
    default: return err.message || 'Connection failed.';
  }
};

// Treat a dropped WebRTC link as a disconnect, not just an explicit close
const onDisconnect = (conn: DataConnection, cb: () => void) => {
  let done = false;
  const fire = () => { if (!done) { done = true; cb(); } };
  conn.on('close', fire);
  conn.on('error', fire);
  conn.on('iceStateChanged', state => { if (state === 'disconnected' || state === 'failed' || state === 'closed') fire(); });
};

// --- Large messages ---
// WebRTC data channels drop very large messages, so anything big (worlds, assets with models) is split
// into chunks and joined back together on arrival. Small messages go through untouched.

const CHUNK_SIZE = 60_000; // Characters of JSON per chunk
interface Chunk { t: '__chunk'; id: string; i: number; n: number; data: string }

export const splitMessage = (msg: unknown): unknown[] => {
  const text = JSON.stringify(msg);
  if (text.length <= CHUNK_SIZE) return [msg];
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const n = Math.ceil(text.length / CHUNK_SIZE);
  return Array.from({ length: n }, (_, i): Chunk => ({ t: '__chunk', id, i, n, data: text.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) }));
};

// Returns each complete message (chunked or not), or undefined while chunks are still arriving
export const createReassembler = () => {
  const partial = new Map<string, { parts: string[]; received: number }>();
  return (data: any): unknown | undefined => {
    if (data?.t !== '__chunk') return data;
    const c = data as Chunk;
    if (!Number.isInteger(c.n) || c.n < 1 || c.n > 2000 || !Number.isInteger(c.i) || c.i < 0 || c.i >= c.n) return undefined;
    const entry = partial.get(c.id) ?? { parts: new Array<string>(c.n), received: 0 };
    if (entry.parts[c.i] === undefined) { entry.parts[c.i] = c.data; entry.received++; }
    partial.set(c.id, entry);
    if (entry.received < c.n) return undefined;
    partial.delete(c.id);
    try { return JSON.parse(entry.parts.join('')); } catch { return undefined; }
  };
};

const sendTo = (conn: DataConnection, msg: unknown) => {
  if (!conn.open) return;
  for (const part of splitMessage(msg)) conn.send(part);
};

// --- Host ---

export interface HostHandlers {
  join?: (peerId: string) => void;
  leave?: (peerId: string) => void;
  message?: (peerId: string, msg: ClientMessage) => void;
}

export interface HostSession {
  code: string;
  setHandlers: (handlers: HostHandlers) => void;
  send: (peerId: string, msg: HostMessage) => void;
  broadcast: (msg: HostMessage, exceptPeerId?: string) => void;
  kick: (peerId: string) => void;
  close: () => void;
}

const openPeer = (id?: string) => new Promise<Peer>((resolve, reject) => {
  const peer = id ? new Peer(id) : new Peer();
  const timer = setTimeout(() => { peer.destroy(); reject({ type: 'network' }); }, CONNECT_TIMEOUT_MS);
  peer.once('open', () => { clearTimeout(timer); resolve(peer); });
  peer.once('error', err => { clearTimeout(timer); peer.destroy(); reject(err); });
});

export const hostRoom = async (): Promise<HostSession> => {
  let peer: Peer | null = null;
  let code = '';
  // A code can already be taken by another room; try a few
  for (let attempt = 0; attempt < 5 && !peer; attempt++) {
    code = makeCode();
    try {
      peer = await openPeer(PEER_PREFIX + code);
    } catch (err: any) {
      if (err?.type !== 'unavailable-id') throw new Error(friendlyError(err));
    }
  }
  if (!peer) throw new Error('Could not create a room. Please try again.');

  const conns = new Map<string, DataConnection>();
  let handlers: HostHandlers = {};

  peer.on('connection', conn => {
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      handlers.join?.(conn.peer);
    });
    const reassemble = createReassembler();
    conn.on('data', data => {
      const msg = reassemble(data);
      if (msg !== undefined) handlers.message?.(conn.peer, msg as ClientMessage);
    });
    onDisconnect(conn, () => {
      if (conns.delete(conn.peer)) handlers.leave?.(conn.peer);
    });
  });
  // Keep the room reachable for new players if the link to the signalling server drops
  peer.on('disconnected', () => { if (!peer!.destroyed) peer!.reconnect(); });

  return {
    code,
    setHandlers: h => { handlers = h; },
    send: (id, msg) => { const c = conns.get(id); if (c) sendTo(c, msg); },
    broadcast: (msg, except) => {
      const parts = splitMessage(msg); // Split once for everyone
      conns.forEach((c, id) => { if (id !== except && c.open) parts.forEach(p => c.send(p)); });
    },
    kick: id => { conns.get(id)?.close(); conns.delete(id); },
    close: () => peer!.destroy(),
  };
};

// --- Client ---

export interface ClientHandlers {
  message?: (msg: HostMessage) => void;
  close?: () => void;
}

export interface ClientSession {
  code: string;
  setHandlers: (handlers: ClientHandlers) => void;
  send: (msg: ClientMessage) => void;
  close: () => void;
}

export const joinRoom = async (rawCode: string): Promise<ClientSession> => {
  const code = normalizeCode(rawCode);
  if (!/^[A-Z0-9]{4}$/.test(code)) throw new Error('Room codes look like SKY-7QK2.');

  let peer: Peer;
  try {
    peer = await openPeer();
  } catch (err: any) {
    throw new Error(friendlyError(err));
  }

  const conn = await new Promise<DataConnection>((resolve, reject) => {
    const c = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
    const timer = setTimeout(() => { peer.destroy(); reject(new Error('The room did not answer. Is the host still in the lobby?')); }, CONNECT_TIMEOUT_MS);
    c.once('open', () => { clearTimeout(timer); resolve(c); });
    peer.once('error', err => { clearTimeout(timer); peer.destroy(); reject(new Error(friendlyError(err))); });
  });

  let handlers: ClientHandlers = {};
  // Messages can arrive before the app swaps in its handlers; queue them until then
  const pending: HostMessage[] = [];
  const reassemble = createReassembler();
  conn.on('data', data => {
    const msg = reassemble(data) as HostMessage | undefined;
    if (msg === undefined) return;
    if (handlers.message) handlers.message(msg);
    else pending.push(msg);
  });
  onDisconnect(conn, () => handlers.close?.());

  return {
    code,
    setHandlers: h => {
      handlers = h;
      if (h.message) pending.splice(0).forEach(h.message);
    },
    send: msg => sendTo(conn, msg),
    close: () => peer.destroy(),
  };
};
