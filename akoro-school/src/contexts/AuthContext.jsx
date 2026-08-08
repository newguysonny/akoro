/**
 * AuthContext — session backed by HttpOnly cookies set by the backend.
 *
 * Tokens live in HttpOnly cookies — no JS access, XSS-safe.
 * Only the safe user object is cached in localStorage for UI rendering.
 * Proactive refresh runs every 13 min (access token expires at 15 min).
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API, getPortal, setSiteTokens, clearSiteTokens, takeHandoffToken, withAuth, rememberExpiry } from '../services/api.js';

const AuthContext = createContext(null);

const USER_KEY     = 'akoro_user';
const REDIRECT_KEY = 'akoro_redirect';

function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}

async function authFetch(path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, withAuth({
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': getPortal() },
      body:    JSON.stringify(body),
    }));
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  // Tolerate empty / non-JSON bodies (e.g. rate-limit or gateway errors) so we
  // surface a clear message instead of "Unexpected end of JSON input".
  const text = await res.text();
  let json = {};
  if (text) { try { json = JSON.parse(text); } catch { json = {}; } }
  if (!res.ok) {
    // The STATUS is what tells refresh() whether the session is really gone or
    // the request merely didn't land. Without it every failure looked fatal.
    const err = new Error(json.message || json.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  // Sign-in is where the first expiry comes from — without it the next visit
  // after 15 minutes still discovers the dead token once per request.
  rememberExpiry(json);
  return json;
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(getStoredUser);
  const [loading, setLoading] = useState(false);
  // True while we exchange an AI-chat hand-off token (?ai=) from the public
  // school website for a session — routing waits so it doesn't bounce to /signin.
  const [booting, setBooting] = useState(() => {
    try { return new URLSearchParams(window.location.search).has('ai'); } catch { return false; }
  });
  // True when an AI-chat hand-off was attempted but no session resulted (e.g. the
  // cross-site cookie didn't stick) — the AI chat shows a clear retry screen
  // instead of a silent bounce to /signin.
  const [handoffError, setHandoffError] = useState(false);
  // Why it failed, so the retry screen can say something actionable instead of
  // 'we couldn't complete your sign-in' for four different causes.
  const [handoffReason, setHandoffReason] = useState('');
  const [error,   setError]   = useState(null);

  const isAuthenticated = !!user;

  const saveUser = useCallback((userObj) => {
    localStorage.setItem(USER_KEY, JSON.stringify(userObj));
    setUser(userObj);
    setError(null);
  }, []);

  const clearUser = useCallback(() => {
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  // Flip the local onboarding flag once the wizard saves it server-side.
  const markOnboarded = useCallback(() => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, onboardingCompleted: true };
      localStorage.setItem(USER_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const register = useCallback(async ({ email, password, username, fullName, role = 'instructor' }) => {
    setLoading(true); setError(null);
    try {
      const { data } = await authFetch('/api/auth/register', { email, password, username, fullName, role });
      if (data?.user) saveUser(data.user);
      return data;
    } catch (err) { setError(err.message); throw err; }
    finally { setLoading(false); }
  }, [saveUser]);

  const login = useCallback(async ({ email, password }) => {
    setLoading(true); setError(null);
    try {
      const { data } = await authFetch('/api/auth/login', { email, password });
      // 2FA-enabled accounts get a challenge token instead of a session.
      if (data?.twoFactorRequired) return data;
      if (data?.user) saveUser(data.user);
      return data;
    } catch (err) { setError(err.message); throw err; }
    finally { setLoading(false); }
  }, [saveUser]);

  const verifyTwoFactor = useCallback(async ({ challengeToken, code }) => {
    setLoading(true); setError(null);
    try {
      const { data } = await authFetch('/api/auth/2fa/login', { challengeToken, code });
      if (data?.user) saveUser(data.user);
      return data;
    } catch (err) { setError(err.message); throw err; }
    finally { setLoading(false); }
  }, [saveUser]);

  const refresh = useCallback(async () => {
    try {
      const { data } = await authFetch('/api/auth/refresh', {});
      if (data?.user) saveUser(data.user);
      return true;
    } catch (err) {
      // Only a real REJECTION ends a session. The proactive refresh runs every
      // 13 minutes, so treating any failure as fatal meant one dropped request,
      // one 429, one 502, one laptop waking from sleep signed the teacher out
      // mid-lesson — with a 30-day refresh cookie still sitting there, valid.
      //
      // 401/403 means the server looked and said no. Anything else — a network
      // throw, a rate limit, a gateway error — means we simply didn't get an
      // answer, and the session should survive until we do.
      if (err?.status === 401 || err?.status === 403) { clearUser(); return false; }
      console.warn('[auth] refresh could not complete, keeping the session:', err?.message);
      return false;
    }
  }, [saveUser, clearUser]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API}/api/auth/logout`, withAuth({ method: 'POST', headers: { 'X-Akoro-Portal': getPortal() } }));
    } catch { /* ignore */ }
    clearUser();
    clearSiteTokens();     // a bearer session lives in this tab, not in a cookie
    window.location.href = '/signin';  // full reload also clears the cached school-verification status
  }, [clearUser]);

  const loginWithGoogle = useCallback((redirectAfter = '/') => {
    localStorage.setItem(REDIRECT_KEY, redirectAfter);
    window.location.href = `${API}/api/auth/google?portal=school`;
  }, []);

  // Token is now in HttpOnly cookie — only user object comes via URL param
  const restoreFromCallback = useCallback((userObj) => {
    if (userObj) saveUser(userObj);
  }, [saveUser]);

  const loadMe = useCallback(() =>
    fetch(`${API}/api/auth/me`, withAuth({ headers: { 'X-Akoro-Portal': getPortal() } }))
      .then(async (r) => { const t = await r.text(); try { return t ? JSON.parse(t) : {}; } catch { return {}; } })
      .then(({ data }) => { if (data?.id) { saveUser(data); return true; } clearUser(); return false; })
      .catch(() => false),
  [saveUser, clearUser]);

  /**
   * Turn a hand-off token into a live session. Used by the ?ai= boot path and
   * by the chat build's own sign-in form, which has a token in hand and no
   * reason to bounce through a redirect to use it.
   */
  const exchangeHandoff = useCallback(async (token) => {
    // credentials OMITTED deliberately. The tokens come back in the body, so no
    // cookie is needed — and on the school's own domain, asking for credentials
    // makes the browser reject the request outright ("Failed to fetch") because
    // that origin is not granted credentialed CORS. Omitting works on both the
    // portal and a tenant domain, so there is one path rather than two.
    let r;
    try {
      r = await fetch(`${API}/api/school/site/ai-login/exchange`, {
        method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': getPortal() },
        body: JSON.stringify({ token }),
      });
    } catch (netErr) {
      // "Failed to fetch" says nothing about WHY. Probe the API root: if that
      // is reachable the problem is this endpoint's CORS; if it isn't, the
      // build is pointing at the wrong host — which no amount of CORS work
      // would ever fix.
      let reachable = false;
      try { await fetch(`${API}/health`, { mode: 'no-cors' }); reachable = true; } catch { /* stays false */ }
      throw new Error(
        `Could not reach the API at ${API} (${netErr?.message || 'network error'}). ` +
        (reachable
          ? 'The server answered on /health, so this endpoint is being blocked — most likely CORS.'
          : 'The server did not answer at all, so this build is pointing at the wrong API address.')
      );
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.message || `The sign-in hand-off was rejected (HTTP ${r.status}).`);
    }
    // On the school's own domain there is no cookie — the tokens in the body
    // ARE the session. Stored before loadMe, which needs them.
    const j = await r.json().catch(() => ({}));
    if (j.accessToken) setSiteTokens({ accessToken: j.accessToken, refreshToken: j.refreshToken });
    const ok = await loadMe();
    if (!ok) throw new Error('Signed in, but the session could not be read back.');
    return true;
  }, [loadMe]);

  // Verify session on mount. An AI-chat hand-off (?ai=<token>) from the public
  // school website is exchanged HERE for a session.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Read the token from the module-load capture, not from the URL: by the
    // time this effect runs the query may already have been rewritten away.
    const handoff = takeHandoffToken();
    if (handoff) {
      exchangeHandoff(handoff)
        .then(() => true)
        .catch((e) => { setHandoffReason(e.message || ''); return false; })
        .then((ok) => { if (!ok) setHandoffError(true); })
        .finally(() => {
          params.delete('ai');
          const q = params.toString();
          window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : ''));
          setBooting(false);
        });
      return;
    }
    // No hand-off. Whatever happens next, stop booting — a page that never
    // leaves "Signing you in…" is the one failure with no way out.
    setBooting(false);
    if (!getStoredUser()) return;
    loadMe().then((ok) => { if (!ok) refresh(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Proactive refresh every 13 minutes (access token TTL = 15 min)
  useEffect(() => {
    if (!isAuthenticated) return;
    const id = setInterval(() => refresh(), 13 * 60 * 1000);
    return () => clearInterval(id);
  }, [isAuthenticated, refresh]);

  return (
    <AuthContext.Provider value={{
      user, loading, error, isAuthenticated, booting, handoffError, handoffReason, exchangeHandoff,
      login, verifyTwoFactor, register, loginWithGoogle, logout, refresh, restoreFromCallback,
      markOnboarded,
      clearError: () => setError(null),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};

export { REDIRECT_KEY };
