/**
 * offlineQueue.js — an IndexedDB-backed queue for writes made while offline.
 *
 * Opt-in only: a call must pass { queueOffline: true } to be queued. This is
 * reserved for fire-and-forget, replay-safe mutations (mark-read, preference
 * toggles, link requests) — NOT for writes whose response the UI needs
 * immediately, and NOT for the AI/real-time flows (those run over WebSocket).
 *
 * Replays in FIFO order when connectivity returns (window 'online' event and on
 * app boot). Degrades to a no-op if IndexedDB is unavailable.
 */
const DB_NAME = 'akoro-offline-queue';
const STORE   = 'queue';
const VERSION = 1;

let _dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => resolve(null);
  });
  return _dbPromise;
}

export async function enqueue(item) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const rq = tx.objectStore(STORE).add({ ...item, ts: Date.now() });
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror   = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function allItems() {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).getAll();
      rq.onsuccess = () => resolve((rq.result || []).sort((a, b) => a.id - b.id));
      rq.onerror   = () => resolve([]);
    } catch { resolve([]); }
  });
}

export async function remove(id) {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
    } catch { resolve(); }
  });
}

export async function queueSize() {
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).count();
      rq.onsuccess = () => resolve(rq.result || 0);
      rq.onerror   = () => resolve(0);
    } catch { resolve(0); }
  });
}

export async function clearQueue() {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
    } catch { resolve(); }
  });
}
