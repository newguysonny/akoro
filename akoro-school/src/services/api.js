import { API } from '../config/urls.js';
/**
 * api.js — HTTP client
 *
 * Auth tokens are stored in HttpOnly cookies by the backend.
 * credentials:'include' ensures the browser sends them on every request.
 * No Authorization header — tokens never touch JS memory.
 */

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
const PORTAL_ID = 'school';
const SESSION_USER_KEY = 'akoro_user';
let refreshing = null;

/* ── Bearer tokens for the site chat ────────────────────────────────────────
 *
 * When the AI chat is served from the SCHOOL'S OWN domain
 * (SCHOOL_CHAT_SAME_DOMAIN=true), the page runs on a tenant origin. Tenant
 * origins are deliberately not granted credentialed CORS — a school admin can
 * put arbitrary script on their own site, and a credentialed origin would let
 * that script call the API as whoever is visiting. So no cookie reaches this
 * page, and it authenticates with the tokens the hand-off exchange returns.
 *
 * sessionStorage, not localStorage: the token dies with the tab, and it is
 * never written on the portal's own origin, where cookies work normally.
 */
/* The hand-off token is grabbed AT MODULE LOAD, before React mounts and before
 * anything can rewrite the URL. A tenant deployment proxies /ai-chat to this
 * build, and a proxy rewrite or a /ai-chat → /ai-chat/ redirect can drop the
 * query string — after which the page looks like a plain unauthenticated visit
 * and the sign-in silently "does nothing".
 *
 * Checked in both the query and the hash, then stashed, so a later re-render or
 * a history.replaceState can't lose it either. */
const HANDOFF_KEY = 'akoro_site_handoff';

// Held in a module variable FIRST. sessionStorage is only a backup: it throws
// in private mode and when storage is blocked, and making the token depend on
// it would lose a perfectly good sign-in in exactly those browsers — a
// regression on simply reading the query string.
let handoffInMemory = null;

// The URL AS THE PAGE WAS OPENED. Captured before anything runs, because the
// hand-off effect strips ?ai= with history.replaceState — so reading
// window.location later reports a clean /ai-chat whether or not a token ever
// arrived, which is worse than no diagnostic at all.
let entryUrl = '';

function captureHandoff() {
  try {
    entryUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const fromSearch = new URLSearchParams(window.location.search).get('ai');
    const fromHash = new URLSearchParams(String(window.location.hash || '').replace(/^#/, '')).get('ai');
    handoffInMemory = fromSearch || fromHash || null;
    if (handoffInMemory) { try { sessionStorage.setItem(HANDOFF_KEY, handoffInMemory); } catch { /* storage blocked */ } }
    if (!handoffInMemory) { try { handoffInMemory = sessionStorage.getItem(HANDOFF_KEY); } catch { /* storage blocked */ } }
  } catch { /* ignore */ }
}
captureHandoff();

export const takeHandoffToken = () => {
  const t = handoffInMemory;
  handoffInMemory = null;                                    // single use
  try { sessionStorage.removeItem(HANDOFF_KEY); } catch { /* ignore */ }
  return t;
};
/** For the "no session" screen: what the page was actually opened with. */
export const entryUrlInfo = () => entryUrl;

const TOKEN_KEY = 'akoro_site_access';
const REFRESH_KEY = 'akoro_site_refresh';
const ss = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch { /* ignore */ } },
};
export const setSiteTokens = ({ accessToken, refreshToken } = {}) => {
  ss.set(TOKEN_KEY, accessToken || null);
  ss.set(REFRESH_KEY, refreshToken || null);
};
export const clearSiteTokens = () => setSiteTokens({});
const siteAccessToken = () => ss.get(TOKEN_KEY);

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
    // A bearer session refreshes with the token in the body; a cookie session
    // refreshes with the cookie. /auth/refresh accepts either.
    const rt = ss.get(REFRESH_KEY);
    refreshing = fetch(`${API}/api/auth/refresh`, {
      method: 'POST',
      // A bearer session carries its refresh token in the body and must not ask
      // for credentials; a cookie session does the opposite.
      credentials: rt ? 'omit' : 'include',
      headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': PORTAL },
      body: rt ? JSON.stringify({ refreshToken: rt }) : '{}',
    })
      .then(async (r) => {
        // The STATUS, not just ok/not-ok: a 429 or a 502 means we never got an
        // answer, and bouncing someone to /signin for that throws away a session
        // the server would still honour.
        if (!r.ok) return { ok: false, status: r.status };
        const j = await r.json().catch(() => ({}));
        if (rt && j.accessToken) setSiteTokens({ accessToken: j.accessToken, refreshToken: j.refreshToken || rt });
        rememberExpiry(j);
        return { ok: true, status: r.status };
      })
      .catch(() => ({ ok: false, status: 0 }))
      .finally(() => { refreshing = null; });
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

/**
 * Decide how this request proves who it is.
 *
 * A bearer token means we are on a tenant origin — the school's own domain —
 * which is NOT granted credentialed CORS. Sending credentials there doesn't
 * merely fail to attach a cookie: the browser rejects the whole request and
 * fetch throws "Failed to fetch". So a bearer session must also drop
 * credentials, or nothing gets through at all.
 *
 * No token → the portal's own origin, where cookies are the session.
 */
export function withAuth(opts = {}) {
  const t = siteAccessToken();
  if (!t) return { credentials: 'include', ...opts };
  return {
    ...opts,
    credentials: 'omit',
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` },
  };
}

/** fetch + one transparent refresh-and-retry on 401. */
async function authedFetch(url, opts) {
  // Known-expired token: refresh once up front instead of letting every
  // request in this batch discover it independently.
  if (accessExpired()) await refreshSession();
  // A dead network throws here rather than answering, so translate it once —
  // otherwise every caller in the app shows the browser's "Failed to fetch".
  let res;
  try { res = await fetch(url, withAuth(opts)); }
  catch (e) {
    reportConnection(false, typeof navigator !== 'undefined' && navigator.onLine === false);
    throw networkError(e, opts?.method || 'GET', String(url).replace(API, ''));
  }
  reportConnection(true);
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
  try { return await fetch(url, withAuth(opts)); }
  catch (e) {
    reportConnection(false, typeof navigator !== 'undefined' && navigator.onLine === false);
    throw networkError(e, opts?.method || 'GET', String(url).replace(API, ''));
  }
}


// This build serves BOTH the school admin app AND the public student-facing
// site AI chat (/ai-chat, /ai-guest). They must NOT share a session cookie —
// a student signing into the site chat would otherwise clobber the admin's
// akoro_access_school cookie. So the site chat uses its own portal ('site' →
// akoro_access_site). Decided once at load from the entry path.
function detectPortal() {
  try {
    const p = window.location.pathname || '';
    if (p.startsWith('/ai-chat') || p.startsWith('/ai-guest')) return 'site';
  } catch { /* ignore */ }
  return 'school';
}
const PORTAL = detectPortal();
export const getPortal = () => PORTAL;

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

/* ── Connection state ────────────────────────────────────────────────────
   Reads that pages choose to swallow still tell us something: whether the API
   is reachable at all. Publishing that here lets one banner explain an outage
   that would otherwise render as "you have nothing". */
const connListeners = new Set();
let connOk = true;

export function onConnectionChange(fn) {
  connListeners.add(fn);
  fn({ ok: connOk, offline: typeof navigator !== 'undefined' && navigator.onLine === false });
  return () => connListeners.delete(fn);
}

function reportConnection(ok, offline = false) {
  if (ok === connOk) return;              // only announce transitions
  connOk = ok;
  connListeners.forEach((fn) => { try { fn({ ok, offline }); } catch { /* a bad listener must not break fetch */ } });
}

const BASE_OPTS = {
  credentials: 'include',                 // send HttpOnly auth cookies
  headers:     { 'Content-Type': 'application/json', 'X-Akoro-Portal': PORTAL },
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
