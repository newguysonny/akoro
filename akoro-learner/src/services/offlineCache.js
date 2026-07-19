/**
 * offlineCache.js — a tiny, dependency-free IndexedDB store for the last
 * successful GET response per path. Complements the service-worker HTTP cache:
 * it gives the app an explicit last-known-good copy to fall back to when a
 * request fails offline and the SW has nothing (e.g. an endpoint it never
 * cached, or one evicted from the SW cache).
 *
 * Everything degrades gracefully — if IndexedDB is unavailable, reads return
 * null and writes are no-ops, so callers behave exactly as before.
 */
const DB_NAME = 'akoro-offline';
const STORE   = 'api-get';
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
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => resolve(null);
  });
  return _dbPromise;
}

/** Returns { data, ts } for a path, or null. */
export async function cacheGet(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(key);
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror   = () => resolve(null);
    } catch { resolve(null); }
  });
}

/** Stores a path's JSON payload (fire-and-forget). */
export async function cacheSet(key, data) {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ data, ts: Date.now() }, key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
    } catch { resolve(); }
  });
}

/** Wipe the offline cache (e.g. on logout so the next account starts clean). */
export async function cacheClear() {
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
