/**
 * api.js — HTTP client
 *
 * Auth tokens are stored in HttpOnly cookies by the backend.
 * credentials:'include' ensures the browser sends them on every request.
 * No Authorization header — tokens never touch JS memory.
 */

import { cacheGet, cacheSet } from './offlineCache.js';
import { enqueue, allItems, remove, queueSize } from './offlineQueue.js';

export const API = import.meta.env.VITE_API_URL || "https://akoro.app";

/* ── Session recovery ────────────────────────────────────────────────────────
 * The access token lives ~15 minutes. Leave a tab idle past that and the next
 * request comes back 401 with the raw backend message ("Access token required"),
 * which used to land in the UI as if it were a real error.
 *
 * Instead: on a 401 we silently spend the (30-day) refresh cookie once and
 * replay the request, so an idle user notices nothing. Only if the refresh
 * ALSO fails is the session genuinely over — then we clear it and send them to
 * sign-in with an explanation, rather than showing a cryptic string.
 *
 * `refreshing` dedupes: when a page fires six requests at once they all 401
 * together, and without it we'd hit /refresh six times and rotate the token
 * out from under ourselves.
 */
const PORTAL_ID = 'student';
const SESSION_USER_KEY = 'akoro_user';
let refreshing = null;

function refreshSession() {
  if (!refreshing) {
    refreshing = fetch(`${API}/api/auth/refresh`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': PORTAL_ID },
      body: '{}',
    }).then((r) => r.ok).catch(() => false).finally(() => { refreshing = null; });
  }
  return refreshing;
}

function endSession() {
  try { localStorage.removeItem(SESSION_USER_KEY); } catch { /* private mode */ }
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/signin')) {
    window.location.href = '/signin?error=session_expired';
  }
}

/** fetch + one transparent refresh-and-retry on 401. */
async function authedFetch(url, opts) {
  const res = await fetch(url, opts);
  if (res.status !== 401) return res;
  // Never recurse on the auth endpoints themselves.
  if (String(url).includes('/api/auth/')) return res;
  const ok = await refreshSession();
  if (!ok) { endSession(); return res; }
  return fetch(url, opts);
}


const BASE_OPTS = {
  credentials: 'include',                 // send HttpOnly auth cookies
  headers:     { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'student' },
};

// A thrown fetch (no HTTP response) or a browser marked offline = network error,
// as opposed to the server responding with a 4xx/5xx.
const isNetworkError = (err) => (typeof navigator !== 'undefined' && navigator.onLine === false) || err?.name === 'TypeError';

// Tag a payload served from the offline cache so callers can show a "saved"
// hint if they want; non-enumerable so it never changes the data's shape.
function markOffline(data) {
  try { if (data && typeof data === 'object') Object.defineProperty(data, '_offline', { value: true, enumerable: false }); } catch { /* frozen/primitive */ }
  return data;
}

export async function apiGet(path, { cache = true } = {}) {
  try {
    const r = await authedFetch(`${API}${path}`, { ...BASE_OPTS, method: 'GET' });
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    const json = await r.json();
    if (cache) cacheSet(path, json);            // fire-and-forget snapshot
    return json;
  } catch (err) {
    // Offline / network failure → serve the last-known-good copy if we have one.
    if (cache && isNetworkError(err)) {
      const hit = await cacheGet(path);
      if (hit) return markOffline(hit.data);
    }
    throw err;
  }
}

// Shared write path. Pass { queueOffline: true } for replay-safe, fire-and-forget
// mutations: if the request fails because we're offline, it's stored and replayed
// on reconnect, and an optimistic { queued: true } is returned instead of throwing.
async function apiSend(method, path, body, { queueOffline = false } = {}) {
  try {
    const r = await authedFetch(`${API}${path}`, {
      ...BASE_OPTS,
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}`);
    return r.json();
  } catch (err) {
    if (queueOffline && isNetworkError(err)) {
      // When a service worker controls the page, its Background Sync queue has
      // already captured this failed request and will replay it (even if the app
      // is closed). Only when there's no SW controller do we fall back to the
      // app-level queue, which flushes on reconnect/boot. Mutually exclusive, so
      // the request is never queued twice.
      const swControlled = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
      if (!swControlled) await enqueue({ method, path, body });
      return { queued: true, _offline: true };
    }
    throw err;
  }
}

export const apiPost   = (path, body, opts) => apiSend('POST', path, body, opts);
export const apiPatch  = (path, body, opts) => apiSend('PATCH', path, body, opts);
export const apiDelete = (path, opts)       => apiSend('DELETE', path, undefined, opts);

let _flushing = false;
/**
 * Replay queued offline writes in FIFO order. Stops on a network error (still
 * offline — retry later); drops an item that gets any HTTP response, including
 * 4xx/5xx, so a permanently-rejected request can't wedge the queue. Emits
 * `akoro:synced` when anything was flushed so the UI can refresh.
 */
export async function flushQueue() {
  if (_flushing) return { flushed: 0, remaining: await queueSize() };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { flushed: 0, remaining: await queueSize() };
  _flushing = true;
  let flushed = 0;
  try {
    for (const it of await allItems()) {
      try {
        await authedFetch(`${API}${it.path}`, {
          ...BASE_OPTS,
          method: it.method,
          ...(it.body !== undefined ? { body: JSON.stringify(it.body) } : {}),
        });
        await remove(it.id); flushed++;          // server saw it (any status) → done
      } catch (err) {
        if (isNetworkError(err)) break;           // still offline — keep for next time
        await remove(it.id); flushed++;           // client-side/other error — drop
      }
    }
  } finally { _flushing = false; }
  if (flushed && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('akoro:synced', { detail: { flushed } }));
  }
  return { flushed, remaining: await queueSize() };
}

/** Register reconnect + boot flushing. Call once at app start. */
export function initOfflineSync() {
  if (typeof window === 'undefined') return;
  const run = () => flushQueue().catch(() => {});
  window.addEventListener('online', run);
  run();   // catch anything queued from a previous offline session
}

/**
 * POST a request and consume a Server-Sent Events stream.
 *   onDelta(textChunk) — called for each incremental token
 *   onDone(payload)    — called once with the final { reply, metadata }
 * Returns the accumulated reply text. Throws on network/stream errors so the
 * caller can fall back to a non-streaming request.
 */
export async function streamPost(path, body, { onDelta, onDone } = {}) {
  const r = await authedFetch(`${API}${path}`, {
    ...BASE_OPTS,
    method:  'POST',
    headers: { ...BASE_OPTS.headers, Accept: 'text/event-stream' },
    body:    JSON.stringify(body),
  });
  if (!r.ok || !r.body) throw new Error(`STREAM ${path} -> ${r.status}`);

  const reader  = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full   = '';

  const handleEvent = (raw) => {
    let event = 'message', data = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    let parsed; try { parsed = JSON.parse(data); } catch { return; }
    if (event === 'delta' && parsed.text != null) { full += parsed.text; onDelta?.(parsed.text); }
    else if (event === 'done')  { if (parsed.reply != null) full = parsed.reply; onDone?.(parsed); }
    else if (event === 'error') { throw new Error(parsed.error || 'stream error'); }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      handleEvent(raw);
    }
  }
  if (buffer.trim()) handleEvent(buffer);
  return full;
}
