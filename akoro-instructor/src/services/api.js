/**
 * api.js — HTTP client
 *
 * Auth tokens are stored in HttpOnly cookies by the backend.
 * credentials:'include' ensures the browser sends them on every request.
 * No Authorization header — tokens never touch JS memory.
 */

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
const PORTAL_ID = 'instructor';
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
  // A dead network throws here rather than answering, so translate it once —
  // otherwise every caller in the app shows the browser's "Failed to fetch".
  let res;
  try { res = await fetch(url, opts); }
  catch (e) { throw networkError(e, opts?.method || 'GET', String(url).replace(API, '')); }
  if (res.status !== 401) return res;
  // Never recurse on the auth endpoints themselves.
  if (String(url).includes('/api/auth/')) return res;
  const ok = await refreshSession();
  if (!ok) { endSession(); return res; }
  try { return await fetch(url, opts); }
  catch (e) { throw networkError(e, opts?.method || 'GET', String(url).replace(API, '')); }
}


/* ── Errors users can act on ─────────────────────────────────────────────
   Every call site shows err.message somewhere — a toast, a form, a page. So
   what we throw IS the user-facing copy, and "POST /api/self-study -> 500" is
   not copy, it is a stack trace with a URL in it.
   apiError() keeps the server's own message when there is one (those are
   written for humans: "Opponent has no agent yet"), and otherwise turns the
   status into a sentence that says what happened and what to do. The technical
   detail stays on the error object — err.status, err.path, err.method — so
   logging and branching lose nothing.                                       */
const STATUS_COPY = {
  400: 'Something in that request wasn\'t right. Check the details and try again.',
  401: 'Your session has expired. Please sign in again.',
  403: "You don't have permission to do that.",
  404: "We couldn't find that — it may have been deleted.",
  409: 'That conflicts with something that already exists.',
  413: 'That file is too large.',
  422: 'Some of those details are not valid. Please check them.',
  429: "That's a lot of requests — please wait a moment and try again.",
  500: 'Something went wrong on our side. Please try again.',
  502: 'Akoro is having trouble right now. Please try again in a moment.',
  503: 'Akoro is temporarily unavailable. Please try again in a moment.',
  504: 'That took too long to respond. Please try again.',
};

async function apiError(res, method, path) {
  let serverMsg = '';
  try {
    const j = await res.json();
    serverMsg = j.error || j.message || '';
  } catch { /* HTML error page or empty body — fall through to the status copy */ }

  const err = new Error(
    serverMsg ||
    STATUS_COPY[res.status] ||
    (res.status >= 500
      ? 'Something went wrong on our side. Please try again.'
      : 'That did not work. Please try again.')
  );
  err.status = res.status;
  err.path   = path;
  err.method = method;
  err.detail = `${method} ${path} -> ${res.status}`;   // for logs, never for users
  return err;
}

/* A thrown fetch means the request never reached us — offline, DNS, CORS, a
   dead API. "Failed to fetch" tells the user nothing, so name the likely cause
   and mark it so callers can offer Retry rather than treating it as a bug. */
function networkError(cause, method, path) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const err = new Error(offline
    ? "You're offline. Reconnect and try again."
    : "Couldn't reach Akoro. Check your connection and try again.");
  err.isNetwork = true;
  err.offline   = offline;
  err.path      = path;
  err.method    = method;
  err.detail    = cause?.message || 'network error';
  return err;
}

const BASE_OPTS = {
  credentials: 'include',                 // send HttpOnly auth cookies
  headers:     { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'instructor' },
};

export async function apiGet(path) {
  const r = await authedFetch(`${API}${path}`, { ...BASE_OPTS, method: 'GET' });
  if (!r.ok) throw await apiError(r, 'GET', path);
  return r.json();
}

export async function apiPost(path, body) {
  const r = await authedFetch(`${API}${path}`, {
    ...BASE_OPTS,
    method: 'POST',
    body:   JSON.stringify(body),
  });
  if (!r.ok) throw await apiError(r, 'POST', path);
  return r.json();
}

export async function apiPut(path, body) {
  const r = await authedFetch(`${API}${path}`, {
    ...BASE_OPTS,
    method: 'PUT',
    body:   JSON.stringify(body),
  });
  if (!r.ok) throw await apiError(r, 'PUT', path);
  return r.json();
}

export async function apiPatch(path, body) {
  const r = await authedFetch(`${API}${path}`, {
    ...BASE_OPTS,
    method: 'PATCH',
    body:   JSON.stringify(body),
  });
  if (!r.ok) throw await apiError(r, 'PATCH', path);
  return r.json();
}

export async function apiDelete(path) {
  const r = await authedFetch(`${API}${path}`, { ...BASE_OPTS, method: 'DELETE' });
  if (!r.ok) throw await apiError(r, 'DELETE', path);
  return r.json();
}
