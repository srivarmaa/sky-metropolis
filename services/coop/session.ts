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
    conn.on('data', data => handlers.message?.(conn.peer, data as ClientMessage));
    onDisconnect(conn, () => {
      if (conns.delete(conn.peer)) handlers.leave?.(conn.peer);
    });
  });
  // Keep the room reachable for new players if the link to the signalling server drops
  peer.on('disconnected', () => { if (!peer!.destroyed) peer!.reconnect(); });

  return {
    code,
    setHandlers: h => { handlers = h; },
    send: (id, msg) => { const c = conns.get(id); if (c?.open) c.send(msg); },
    broadcast: (msg, except) => conns.forEach((c, id) => { if (id !== except && c.open) c.send(msg); }),
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
  conn.on('data', data => {
    if (handlers.message) handlers.message(data as HostMessage);
    else pending.push(data as HostMessage);
  });
  onDisconnect(conn, () => handlers.close?.());

  return {
    code,
    setHandlers: h => {
      handlers = h;
      if (h.message) pending.splice(0).forEach(h.message);
    },
    send: msg => { if (conn.open) conn.send(msg); },
    close: () => peer.destroy(),
  };
};
