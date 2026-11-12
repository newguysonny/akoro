/**
 * api.js — HTTP client
 *
 * Auth tokens are stored in HttpOnly cookies by the backend.
 * credentials:'include' ensures the browser sends them on every request.
 * No Authorization header — tokens never touch JS memory.
 */

import { cacheGet, cacheSet } from './offlineCache.js';
import { enqueue, allItems, remove, queueSize } from './offlineQueue.js';
import { API } from '../config/urls.js';

export { API };

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

/* ── Refresh before the herd, not after it ───────────────────────────────
   The access token lives 15 minutes. A screen that opens after that fires its
   whole first batch of requests in parallel, every one 401s, ONE refresh runs
   (refreshSession dedupes), and all of them retry — double the traffic on every
   return visit, and a wall of red in the server logs for something that is
   working exactly as designed.

   The access cookie is HttpOnly and set on the API's domain, so this app cannot
   read its expiry. The API hands it back as accessExpiresAt instead; we stash
   it and, when it has passed, refresh FIRST. Concurrent callers all await the
   same refreshSession() promise, so 16 requests still cost one refresh — they
   just no longer cost 16 rejections first.

   If storage is unavailable (private mode) this is a no-op and the old
   401-then-retry path still carries the request. */
const EXP_KEY = 'akoro_access_exp';

export function rememberExpiry(json) {
  const exp = json?.accessExpiresAt ?? json?.data?.accessExpiresAt;
  if (!exp) return json;
  try { localStorage.setItem(EXP_KEY, String(exp)); } catch { /* private mode */ }
  return json;
}

function accessExpired() {
  try {
    const at = Number(localStorage.getItem(EXP_KEY) || 0);
    // 0 = we've never been told; let the request go and 401 if it must.
    return at > 0 && at <= Date.now() + 5000;   // 5s skew for a slow request
  } catch { return false; }
}

function forgetExpiry() {
  try { localStorage.removeItem(EXP_KEY); } catch { /* private mode */ }
}

/**
 * ONE refresh per tab, whoever asks.
 *
 * AuthContext used to POST /api/auth/refresh itself, on its own 13-minute
 * timer, while this module did the same on a 401 — two in-flight requests
 * carrying the SAME refresh cookie. Rotation spends a token on first use, so
 * the loser presented a spent one, the server called it replay and revoked the
 * whole family, and the user was signed out everywhere. Exporting this makes
 * both paths share one promise, so a tab can no longer race itself.
 *
 * (Two TABS still can; the server's grace window covers that.)
 */
export function refreshSession() {
  if (!refreshing) {
    // One deadline for the whole refresh: connection AND body. A refresh
    // whose response stalls mid-body must not pin `refreshing` (and every
    // authed request behind it) open forever.
    const deadline = armDeadline(REFRESH_TIMEOUT_MS);
    refreshing = fetch(`${API}/api/auth/refresh`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': PORTAL_ID },
      body: '{}',
      signal: deadline.signal,
    }).then(async (r) => {
      const json = r.ok ? await r.json().catch(() => null) : null;
      if (json) rememberExpiry(json);
      // The STATUS, not just ok/not-ok: a 429 or a 502 means we never got an
      // answer, and bouncing someone to /signin for that throws away a session
      // the server would still honour.
      return { ok: r.ok, status: r.status, json };
    }).catch(() => ({ ok: false, status: 0, json: null }))
      .finally(() => { refreshing = null; deadline.settle(); });
  }
  return refreshing;
}

function endSession() {
  forgetExpiry();
  try { localStorage.removeItem(SESSION_USER_KEY); } catch { /* private mode */ }
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/signin')) {
    window.location.href = '/signin?error=session_expired';
  }
}

/* ── Request timeout ───────────────────────────────────────────────────────
   A stalled connection never rejects a fetch — the browser sits on a dead
   socket for minutes (mobile networks do this constantly: the signal drops
   mid-request and nothing ever comes back, not even an error). Without a
   deadline, every page that fires such a request shows its loading skeleton
   forever — no error state, no empty state, no way out. The community pages
   were where this bit first: they are the app's only reads with the offline
   cache disabled, so they had no last-known-good copy to fall back to either.

   The deadline turns a stall into an ordinary network error, which the
   existing machinery already knows how to handle: reads fall back to the
   offline cache (when enabled), pages show their "couldn't reach" state with
   a retry button, and offline-queued writes queue.

   30s default: generous enough for a cold API start to finish answering,
   short enough that a learner on a dead connection isn't staring at a
   skeleton. VITE_API_TIMEOUT_MS overrides it (a slow deploy can raise it);
   per-call `timeout: 0` opts out entirely for genuinely long operations.
   Uploads get their own, longer budget. */
const DEFAULT_TIMEOUT_MS = Number(import.meta.env?.VITE_API_TIMEOUT_MS) || 30000;
const REFRESH_TIMEOUT_MS = 15000;   // a hung refresh must not hang every request behind it
const UPLOAD_TIMEOUT_MS  = 120000;  // bodies can be big; slow is expected, dead is not

/* Recast an abort as the same shape every other network failure has, so the
   cache fallback, offline queue and page error states all engage — whether it
   aborted the connection (fetch) or the body read (json()). The wait length
   travels with the error so an error card can say HOW LONG the silence
   lasted (a screenshot then distinguishes "no answer in 30s" from a server
   that answered with its own timeout). */
function recastAbort(err, timeoutMs) {
  if (err?.name !== 'AbortError' && err?.name !== 'TimeoutError') return err;
  const e = new Error('The request timed out — check your connection and try again.');
  e.isNetwork = true;
  e.timedOut  = true;
  if (timeoutMs > 0) e.timeoutMs = timeoutMs;
  return e;
}

function fetchWithTimeout(url, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!timeoutMs || timeoutMs <= 0 || opts.signal) return fetch(url, opts);   // opt-out, or the caller owns the deadline
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(timer))
    .catch((e) => { throw recastAbort(e, timeoutMs); });
}

/* A deadline the CALLER disarms once the response body has been read.
   fetchWithTimeout bounds time-to-headers; a proxy can still deliver the
   headers and then stall the body, and an unbounded json() read hangs a page
   exactly like an unbounded fetch (the community details page did this:
   "keeps loading, no data arriving"). Arm, thread the signal into
   authedFetch, settle in the finally. */
function armDeadline(timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!timeoutMs || timeoutMs <= 0 || typeof AbortController === 'undefined') {
    return { signal: undefined, settle() {} };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return { signal: ctrl.signal, settle() { clearTimeout(timer); } };
}

/** fetch + one transparent refresh-and-retry on 401. */
async function authedFetch(url, opts, timeoutMs = DEFAULT_TIMEOUT_MS) {
  // Known-expired token: refresh once up front instead of letting every
  // request in this batch discover it independently.
  if (accessExpired()) await refreshSession();
  const res = await fetchWithTimeout(url, opts, timeoutMs);
  if (res.status !== 401) return res;
  // Never recurse on the auth endpoints themselves.
  if (String(url).includes('/api/auth/')) return res;
  const r2 = await refreshSession();
  // Only end the session when the server actually rejected the refresh. A
  // network drop, a rate limit or a gateway error leaves a valid refresh cookie
  // in place — retrying later is right; signing out is not.
  if (!r2.ok) {
    if (r2.status === 401 || r2.status === 403) endSession();
    return res;
  }
  return fetchWithTimeout(url, opts, timeoutMs);
}


const BASE_OPTS = {
  credentials: 'include',                 // send HttpOnly auth cookies
  headers:     { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'student' },
};

/* ── Errors users can act on ─────────────────────────────────────────────
   These messages are shown to learners — in toasts, forms and sheets — so what
   we throw IS the copy. `GET /api/x -> 500` is not copy.

   It also DISCARDED the server's own message, which is the more serious half:
   the API writes messages meant for people ("Opponent has no agent yet"), and
   throwing away the body meant no caller could ever read, match or show one.  */
const STATUS_COPY = {
  400: "Something in that wasn't right. Check it and try again.",
  401: 'Please sign in again to continue.',
  403: "You don't have permission to do that.",
  404: "We couldn't find that — it may have been removed.",
  409: 'That clashes with something that already exists.',
  413: 'That file is too large.',
  422: 'Some of those details are not valid. Please check them.',
  429: "That's a lot at once — wait a moment and try again.",
  500: 'Something went wrong on our side. Please try again.',
  502: 'Akoro is having trouble right now. Try again in a moment.',
  503: 'Akoro is temporarily unavailable. Try again in a moment.',
  504: 'That took too long. Please try again.',
};

async function apiError(res, method, path) {
  let serverMsg = '';
  let serverCode, serverStep;
  try {
    const j = await res.json();
    serverMsg = j.error || j.message || '';
    serverCode = j.code;    // e.g. COMMUNITIES_QUERY_TIMEOUT — lets a page say WHY
    serverStep = j.step;    // the query step a 504 gave up waiting on
  } catch {}
  const err = new Error(
    serverMsg ||
    STATUS_COPY[res.status] ||
    (res.status >= 500 ? 'Something went wrong on our side. Please try again.'
                       : 'That did not work. Please try again.')
  );
  err.status = res.status;
  err.code   = serverCode;
  err.step   = serverStep;
  err.path   = path;
  err.method = method;
  err.detail = `${method} ${path} -> ${res.status}`;   // logs only, never shown
  return err;
}

// A thrown fetch (no HTTP response) or a browser marked offline = network error,
// as opposed to the server responding with a 4xx/5xx.
// `status` is only set when the server actually answered, so its presence is
// what separates "the API said no" from "the request never arrived". Without
// this check a 500 would be served from the offline cache, or a rejected write
// would be queued for replay forever.
const isNetworkError = (err) =>
  !err?.status && ((typeof navigator !== 'undefined' && navigator.onLine === false) || err?.name === 'TypeError' || err?.isNetwork === true);

// Tag a payload served from the offline cache so callers can show a "saved"
// hint if they want; non-enumerable so it never changes the data's shape.
function markOffline(data) {
  try { if (data && typeof data === 'object') Object.defineProperty(data, '_offline', { value: true, enumerable: false }); } catch { /* frozen/primitive */ }
  return data;
}

export async function apiGet(path, { cache = true, timeout } = {}) {
  const ms = timeout ?? DEFAULT_TIMEOUT_MS;
  const deadline = armDeadline(ms);       // headers AND body under one clock
  try {
    const r = await authedFetch(`${API}${path}`, { ...BASE_OPTS, method: 'GET', signal: deadline.signal }, ms);
    if (!r.ok) throw await apiError(r, 'GET', path);
    const json = await r.json();
    if (cache) cacheSet(path, json);            // fire-and-forget snapshot
    return json;
  } catch (err) {
    const e = recastAbort(err, ms);             // a body-read abort is a network error too
    // Offline / network failure → serve the last-known-good copy if we have one.
    if (cache && isNetworkError(e)) {
      const hit = await cacheGet(path);
      if (hit) return markOffline(hit.data);
    }
    throw e;
  } finally {
    deadline.settle();
  }
}

// Shared write path. Pass { queueOffline: true } for replay-safe, fire-and-forget
// mutations: if the request fails because we're offline, it's stored and replayed
// on reconnect, and an optimistic { queued: true } is returned instead of throwing.
async function apiSend(method, path, body, { queueOffline = false, timeout } = {}) {
  const ms = timeout ?? DEFAULT_TIMEOUT_MS;
  const deadline = armDeadline(ms);       // headers AND body under one clock
  try {
    const r = await authedFetch(`${API}${path}`, {
      ...BASE_OPTS,
      method,
      signal: deadline.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }, ms);
    if (!r.ok) throw await apiError(r, method, path);
    return await r.json();
  } catch (err) {
    const e = recastAbort(err, ms);             // a body-read abort is a network error too
    if (queueOffline && isNetworkError(e)) {
      // When a service worker controls the page, its Background Sync queue has
      // already captured this failed request and will replay it (even if the app
      // is closed). Only when there's no SW controller do we fall back to the
      // app-level queue, which flushes on reconnect/boot. Mutually exclusive, so
      // the request is never queued twice.
      const swControlled = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
      if (!swControlled) await enqueue({ method, path, body });
      return { queued: true, _offline: true };
    }
    throw e;
  } finally {
    deadline.settle();
  }
}

export const apiPost   = (path, body, opts) => apiSend('POST', path, body, opts);
export const apiPut    = (path, body, opts) => apiSend('PUT', path, body, opts);
export const apiPatch  = (path, body, opts) => apiSend('PATCH', path, body, opts);
export const apiDelete = (path, opts)       => apiSend('DELETE', path, undefined, opts);

// Multipart companion to apiPost. Do not use BASE_OPTS here: the browser must
// set the FormData boundary itself, so only the portal hint is supplied.
export async function apiUpload(path, formData, { method = 'POST' } = {}) {
  const deadline = armDeadline(UPLOAD_TIMEOUT_MS);
  try {
    const r = await authedFetch(`${API}${path}`, {
      method,
      credentials: 'include',
      headers: { 'X-Akoro-Portal': PORTAL_ID },
      body: formData,
      signal: deadline.signal,
    }, UPLOAD_TIMEOUT_MS);
    if (!r.ok) throw await apiError(r, method, path);
    return await r.json();
  } catch (err) {
    throw recastAbort(err, UPLOAD_TIMEOUT_MS);
  } finally {
    deadline.settle();
  }
}

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
 *   onTrace(event, data) — Agent Chat steps: think_start/think_end,
 *                       tool_start/tool_end, activity (Grand Plan §13.4)
 *   signal             — AbortSignal; aborting it is the ■ stop button
 * Returns the accumulated reply text. Throws on network/stream errors so the
 * caller can fall back to a non-streaming request (an abort throws an
 * AbortError — callers must NOT fall back on a stop).
 */
const TRACE_EVENTS = new Set([
  'think_start', 'think_delta', 'think_end', 'tool_start', 'tool_end',
  'activity', 'activity_start', 'activity_delta', 'activity_end', 'activity_promote', 'activity_drop',
]);
/* The v3 envelope (Grand Plan §7.9.7) rides on every live event; when an
   event's name isn't one this client knows, its envelope type says what it is. */
const NAME_FOR_TYPE = {
  'agent.narration.start': 'think_start', 'agent.narration.delta': 'think_delta', 'agent.narration': 'think_end',
  'tool.started': 'tool_start', 'tool.completed': 'tool_end', 'tool.failed': 'tool_end',
  'activity.start': 'activity_start', 'activity.delta': 'activity_delta',
  'activity.promote': 'activity_promote', 'activity.drop': 'activity_drop',
  'reply.delta': 'delta', 'reply': 'done',
};
export function eventNameOf(event, data) {
  const known = event === 'delta' || event === 'done' || event === 'saved' || event === 'status' || event === 'error' || event === 'thinking' || TRACE_EVENTS.has(event);
  return known ? event : (NAME_FOR_TYPE[data?.envelope?.type] || event);
}

/** One parsed SSE block → [event, data], or null. */
function parseSseBlock(raw) {
  let event = 'message', data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;
  try { return [event, JSON.parse(data)]; } catch { return null; }
}

/**
 * GET a Server-Sent Events stream (a workflow's event stream, §7.9.6).
 * onEvent(event, data) for each event; resolves when the server ends the
 * stream, throws on a non-2xx answer; abort `signal` to close it.
 */
export async function streamGet(path, { onEvent, signal } = {}) {
  const r = await authedFetch(`${API}${path}`, {
    ...BASE_OPTS, method: 'GET', headers: { ...BASE_OPTS.headers, Accept: 'text/event-stream' }, ...(signal ? { signal } : {}),
  });
  if (!r.ok) throw await apiError(r, 'GET', path);
  if (!r.body) return;
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const parsed = parseSseBlock(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
      if (parsed) onEvent?.(parsed[0], parsed[1]);
    }
  }
}

export async function streamPost(path, body, { onDelta, onDone, onThinking, onStatus, onTrace, onCard, onSuggestions, onSaved, signal } = {}) {
  // timeout 0: a chat stream is deliberately long-lived. authedFetch's 30s
  // deadline must never apply to it (tool loops and reasoning can exceed that).
  const r = await authedFetch(`${API}${path}`, {
    ...BASE_OPTS,
    method:  'POST',
    headers: { ...BASE_OPTS.headers, Accept: 'text/event-stream' },
    body:    JSON.stringify(body),
    ...(signal ? { signal } : {}),
  }, 0);
  if (!r.ok) throw await apiError(r, 'POST', path);
  // A 200 with no body means the stream died before it began — the caller's
  // fallback needs a real error, not a silent hang.
  if (!r.body) {
    const err = new Error('The reply stopped before it started. Please try again.');
    err.status = r.status; err.detail = `STREAM ${path} -> no body`;
    throw err;
  }

  const reader  = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full   = '';
  let think  = '';

  const handleEvent = (raw) => {
    const block = parseSseBlock(raw);
    if (!block) return;
    const parsed = block[1];
    const event = eventNameOf(block[0], parsed);
    if (event === 'delta' && parsed.text != null) { full += parsed.text; onDelta?.(parsed.text); }
    else if (event === 'thinking' && parsed.text) { think += parsed.text; onThinking?.(parsed.text, think); }
    else if (event === 'status')  { onStatus?.(parsed); }
    else if (TRACE_EVENTS.has(event)) { onTrace?.(event, parsed); }
    else if (event === 'done')  { if (parsed.reply != null) full = parsed.reply; onDone?.({ ...parsed, thinking: parsed.thinking ?? think }); }
    // A card to act on, the moment the tool made it; the reply's chips right after done.
    else if (event === 'card') { onCard?.(parsed); }
    else if (event === 'suggestions') { onSuggestions?.(parsed?.suggestions || []); }
    // The reply was shown at done; its stored id arrives once the save is finished.
    else if (event === 'saved') { onSaved?.(parsed || {}); }
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
