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

function refreshSession() {
  if (!refreshing) {
    // A bearer session refreshes with the token in the body; a cookie session
    // refreshes with the cookie. /auth/refresh accepts either.
    const rt = ss.get(REFRESH_KEY);
    refreshing = fetch(`${API}/api/auth/refresh`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': PORTAL },
      body: rt ? JSON.stringify({ refreshToken: rt }) : '{}',
    })
      .then(async (r) => {
        if (!r.ok) return false;
        if (rt) {
          const j = await r.json().catch(() => ({}));
          if (j.accessToken) setSiteTokens({ accessToken: j.accessToken, refreshToken: j.refreshToken || rt });
        }
        return true;
      })
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

function endSession() {
  try { localStorage.removeItem(SESSION_USER_KEY); } catch { /* private mode */ }
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/signin')) {
    window.location.href = '/signin?error=session_expired';
  }
}

// Adds Authorization when this tab holds a site-chat token. Cookies still ride
// along for the portal's own origin, so one code path serves both.
function withAuth(opts = {}) {
  const t = siteAccessToken();
  if (!t) return opts;
  return { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` } };
}

/** fetch + one transparent refresh-and-retry on 401. */
async function authedFetch(url, opts) {
  const res = await fetch(url, withAuth(opts));
  if (res.status !== 401) return res;
  // Never recurse on the auth endpoints themselves.
  if (String(url).includes('/api/auth/')) return res;
  const ok = await refreshSession();
  if (!ok) { endSession(); return res; }
  return fetch(url, withAuth(opts));
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

const BASE_OPTS = {
  credentials: 'include',                 // send HttpOnly auth cookies
  headers:     { 'Content-Type': 'application/json', 'X-Akoro-Portal': PORTAL },
};

export async function apiGet(path) {
  const r = await authedFetch(`${API}${path}`, { ...BASE_OPTS, method: 'GET' });
  if (!r.ok) {
    let msg = `GET ${path} -> ${r.status}`;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function apiPost(path, body) {
  const r = await authedFetch(`${API}${path}`, {
    ...BASE_OPTS,
    method: 'POST',
    body:   JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `POST ${path} -> ${r.status}`;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function apiPut(path, body) {
  const r = await authedFetch(`${API}${path}`, {
    ...BASE_OPTS,
    method: 'PUT',
    body:   JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `PUT ${path} -> ${r.status}`;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function apiPatch(path, body) {
  const r = await authedFetch(`${API}${path}`, {
    ...BASE_OPTS,
    method: 'PATCH',
    body:   JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `PATCH ${path} -> ${r.status}`;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function apiDelete(path) {
  const r = await authedFetch(`${API}${path}`, { ...BASE_OPTS, method: 'DELETE' });
  if (!r.ok) {
    let msg = `DELETE ${path} -> ${r.status}`;
    try { const j = await r.json(); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}
