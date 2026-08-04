/**
 * api.js — HTTP client for the agent app. Portal 'agent' gets its own
 * HttpOnly session cookie (akoro_access_agent), fully separate from every
 * other Akoro portal.
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
const PORTAL_ID = 'agent';
const SESSION_USER_KEY = 'akoro_agent_user';
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


// Vite inlines VITE_API_URL at BUILD time. If the Vercel project is missing it
// (or was changed without a redeploy) every call silently targets the fallback
// domain and dies as an opaque "Failed to fetch" — so say so, loudly, once.
if (!import.meta.env.VITE_API_URL) {
  console.error(`[akoro-agent] VITE_API_URL is not set — falling back to ${API}. Set it in the Vercel project and REDEPLOY.`);
}

const BASE_OPTS = {
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'agent' },
};

// fetch() rejects (rather than returning a response) only on network-level
// failures: DNS, TLS, connection refused, or a CORS preflight rejection. The
// browser deliberately hides which — so name the URL we were trying to reach.
async function request(path, opts) {
  try {
    return await authedFetch(`${API}${path}`, opts);
  } catch (e) {
    const err = new Error(`Cannot reach the API at ${API} — check VITE_API_URL and that ${window.location.origin} is in the backend's CORS_ORIGIN.`);
    err.cause = e;
    err.network = true;
    throw err;
  }
}

async function handle(r, label) {
  if (!r.ok) {
    let msg = label;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch { /* ignore */ }
    const err = new Error(msg);
    err.status = r.status;
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
