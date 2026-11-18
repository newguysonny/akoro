import { API } from '../config/urls.js';
import { createApiCore } from '../client/apiCore';

/**
 * api.js — HTTP client
 *
 * Auth tokens are stored in HttpOnly cookies by the backend.
 * credentials:'include' ensures the browser sends them on every request.
 * No Authorization header — tokens never touch JS memory.
 *
 * The session rules themselves live in the shared core
 * (design-system/client/apiCore.ts → src/client): one deduped refresh per tab,
 * refresh-before-the-herd when the expiry is known, a single 401 replay, the
 * one user-facing error shape and connection state. This file keeps what is
 * this build's own: the school/site portal choice, the tenant-site bearer
 * tokens, and the ?ai= hand-off.
 */

export { API };

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

/* ── Shared session core ────────────────────────────────────────────────────
 * ONE instance for this build. The portal is fixed at load (a full navigation
 * is what puts a tab on the site portal), so it is passed as a getter.
 *
 * `authorize` applies the cookie/bearer choice to every request and replay.
 * `refresh` keeps the tenant path: a bearer session renews with the token in
 * the body and must omit credentials (a tenant origin is not granted
 * credentialed CORS), then stores the rotated pair; a cookie session returns
 * null and the core refreshes with the cookie. */
const core = createApiCore({
  apiBase: API,
  portalId: () => PORTAL,
  authorize: withAuth,
  refresh: () => {
    const rt = ss.get(REFRESH_KEY);
    if (!rt) return null;
    return fetch(`${API}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': PORTAL },
      body: JSON.stringify({ refreshToken: rt }),
    })
      .then(async (r) => {
        if (!r.ok) return { ok: false, status: r.status, json: null };
        const j = await r.json().catch(() => ({}));
        if (j.accessToken) setSiteTokens({ accessToken: j.accessToken, refreshToken: j.refreshToken || rt });
        core.rememberExpiry(j);
        return { ok: true, status: r.status, json: j };
      })
      .catch(() => ({ ok: false, status: 0, json: null }));
  },
});

export const {
  rememberExpiry,
  refreshSession,
  onConnectionChange,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
} = core;
