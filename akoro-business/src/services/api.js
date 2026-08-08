/**
 * api.js — HTTP client for the business app. Portal 'business' gets its own
 * HttpOnly session cookie (akoro_access_business), separate from every other
 * Akoro portal (including the agent app, even though both touch the voucher
 * module — a startup owner and an agent are different sessions).
 */
export const API = import.meta.env.VITE_API_URL || 'https://akoro.app';

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
const PORTAL_ID = 'business';
const SESSION_USER_KEY = 'akoro_business_user';
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
    refreshing = fetch(`${API}/api/auth/refresh`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': PORTAL_ID },
      body: '{}',
    }).then(async (r) => {
      const json = r.ok ? await r.json().catch(() => null) : null;
      if (json) rememberExpiry(json);
      return r.ok;
    }).catch(() => false).finally(() => { refreshing = null; });
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

/** fetch + one transparent refresh-and-retry on 401. */
async function authedFetch(url, opts) {
  // Known-expired token: refresh once up front instead of letting every
  // request in this batch discover it independently.
  if (accessExpired()) await refreshSession();
  const res = await fetch(url, opts);
  reportConnection(true);
  if (res.status !== 401) return res;
  // Never recurse on the auth endpoints themselves.
  if (String(url).includes('/api/auth/')) return res;
  const ok = await refreshSession();
  if (!ok) { endSession(); return res; }
  return fetch(url, opts);
}


// Vite inlines VITE_API_URL at BUILD time. If the Vercel project is missing it
// (or was changed without a redeploy) every call silently targets the fallback
// domain and dies as an opaque "Failed to fetch" — so say so, loudly, once.
if (!import.meta.env.VITE_API_URL) {
  console.error(`[akoro-business] VITE_API_URL is not set — falling back to ${API}. Set it in the Vercel project and REDEPLOY.`);
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
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'business' },
};

// fetch() rejects (rather than returning a response) only on network-level
// failures: DNS, TLS, connection refused, or a CORS preflight rejection. The
// browser deliberately hides which — so name the URL we were trying to reach.
async function request(path, opts) {
  try {
    return await authedFetch(`${API}${path}`, opts);
  } catch (e) {
    reportConnection(false, typeof navigator !== 'undefined' && navigator.onLine === false);
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    // The message is what the user reads, so it says what they can do. The
    // configuration hint that used to be the message — VITE_API_URL, CORS_ORIGIN
    // — is a developer's problem and belongs in the console, not on screen.
    const err = new Error(offline
      ? "You're offline. Reconnect and try again."
      : "Couldn't reach Akoro. Check your connection and try again.");
    err.cause   = e;
    err.network = true;
    err.offline = offline;
    err.detail  = `Cannot reach the API at ${API} — check VITE_API_URL and that ${window.location.origin} is in the backend's CORS_ORIGIN.`;
    console.warn('[akoro-business]', err.detail);
    throw err;
  }
}

/* The server's own message when there is one — those are written for people.
   Otherwise a sentence for the status, never "GET /api/x failed". */
const STATUS_COPY = {
  400: "Something in that request wasn't right. Check the details and try again.",
  401: 'Your session has expired. Please sign in again.',
  403: "You don't have permission to do that.",
  404: "We couldn't find that — it may have been deleted.",
  409: 'That conflicts with something that already exists.',
  422: 'Some of those details are not valid. Please check them.',
  429: "That's a lot of requests — please wait a moment and try again.",
  500: 'Something went wrong on our side. Please try again.',
  502: 'Akoro is having trouble right now. Please try again in a moment.',
  503: 'Akoro is temporarily unavailable. Please try again in a moment.',
  504: 'That took too long to respond. Please try again.',
};

async function handle(r, label) {
  if (!r.ok) {
    let serverMsg = '';
    try { const j = await r.json(); serverMsg = j.error || j.message || ''; } catch { /* ignore */ }
    const err = new Error(
      serverMsg ||
      STATUS_COPY[r.status] ||
      (r.status >= 500 ? 'Something went wrong on our side. Please try again.'
                       : 'That did not work. Please try again.')
    );
    err.status = r.status;
    err.detail = label;          // for logs, never for users
    throw err;
  }
  return r.json();
}

export async function apiGet(path) {
  const r = await request(path, { ...BASE_OPTS, method: 'GET' });
  return handle(r, `GET ${path} failed`);
}
export async function apiPost(path, body) {
  const r = await request(path, { ...BASE_OPTS, method: 'POST', body: JSON.stringify(body ?? {}) });
  return handle(r, `POST ${path} failed`);
}
export async function apiPatch(path, body) {
  const r = await request(path, { ...BASE_OPTS, method: 'PATCH', body: JSON.stringify(body ?? {}) });
  return handle(r, `PATCH ${path} failed`);
}
export async function apiDelete(path) {
  const r = await request(path, { ...BASE_OPTS, method: 'DELETE' });
  return handle(r, `DELETE ${path} failed`);
}
