/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { AssetSpec, AssetTerms, assetId, cleanTerms } from './spec';

/**
 * Your assets, stored in this browser (IndexedDB). Each library entry points at the latest version of
 * an asset; every version is kept, so monuments already placed in a city still draw after you edit it.
 * If storage is unavailable (private browsing, blocked site data), the library lives in memory for this visit.
 */

export interface LibraryEntry {
  key: string; // Stable across edits
  id: string; // Content id of the latest version
  terms: AssetTerms; // Default asking terms when licensing it
  updatedAt: number;
}

export interface Library {
  entries: LibraryEntry[]; // Newest first
  versions: Record<string, AssetSpec>; // Every version by content id
  persistent: boolean; // false when saved in memory only
}

const DB_NAME = 'skymetropolis-assets';
const ENTRIES = 'entries';
const VERSIONS = 'versions';

let memory: { entries: Map<string, LibraryEntry>; versions: Map<string, AssetSpec> } | null = null;

const openDb = (): Promise<IDBDatabase | null> => new Promise(resolve => {
  try {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(VERSIONS)) db.createObjectStore(VERSIONS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  } catch {
    resolve(null);
  }
});

const useMemory = () => {
  memory ??= { entries: new Map(), versions: new Map() };
  return memory;
};

const run = <T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => T): Promise<T> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const result = body(tx);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const getAll = <T>(db: IDBDatabase, store: string): Promise<T[]> => new Promise((resolve, reject) => {
  const req = db.transaction(store, 'readonly').objectStore(store).getAll();
  req.onsuccess = () => resolve(req.result as T[]);
  req.onerror = () => reject(req.error);
});

export const loadLibrary = async (): Promise<Library> => {
  const db = await openDb();
  if (db) {
    try {
      const [entries, versions] = await Promise.all([getAll<LibraryEntry>(db, ENTRIES), getAll<AssetSpec & { id: string }>(db, VERSIONS)]);
      return {
        entries: entries.map(e => ({ ...e, terms: cleanTerms(e.terms) })).sort((a, b) => b.updatedAt - a.updatedAt),
        versions: Object.fromEntries(versions.map(({ id, ...spec }) => [id, spec as AssetSpec])),
        persistent: true,
      };
    } catch { /* Fall back to memory */ }
  }
  const m = useMemory();
  return {
    entries: [...m.entries.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    versions: Object.fromEntries(m.versions),
    persistent: false,
  };
};

const newKey = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Save a (validated) asset as a new entry, or as the latest version of an existing one
export const saveAsset = async (asset: AssetSpec, terms: AssetTerms, key?: string): Promise<LibraryEntry> => {
  const entry: LibraryEntry = { key: key ?? newKey(), id: await assetId(asset), terms: cleanTerms(terms), updatedAt: Date.now() };
  const db = await openDb();
  if (db) {
    try {
      await run(db, [ENTRIES, VERSIONS], 'readwrite', tx => {
        tx.objectStore(VERSIONS).put({ ...asset, id: entry.id });
        tx.objectStore(ENTRIES).put(entry);
      });
      return entry;
    } catch { /* Fall back to memory */ }
  }
  const m = useMemory();
  m.versions.set(entry.id, asset);
  m.entries.set(entry.key, entry);
  return entry;
};

// Remove from the list; its versions stay so placed monuments keep drawing
export const deleteAsset = async (key: string): Promise<void> => {
  const db = await openDb();
  if (db) {
    try {
      await run(db, [ENTRIES], 'readwrite', tx => { tx.objectStore(ENTRIES).delete(key); });
      return;
    } catch { /* Fall back to memory */ }
  }
  useMemory().entries.delete(key);
};

// Keep a copy of an asset someone else shared (so it can be drawn), without listing it as yours
export const rememberVersion = async (id: string, asset: AssetSpec): Promise<void> => {
  const db = await openDb();
  if (db) {
    try {
      await run(db, [VERSIONS], 'readwrite', tx => { tx.objectStore(VERSIONS).put({ ...asset, id }); });
      return;
    } catch { /* Fall back to memory */ }
  }
  useMemory().versions.set(id, asset);
};
