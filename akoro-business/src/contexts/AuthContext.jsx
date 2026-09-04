/**
 * AuthContext — session backed by the 'business'-portal HttpOnly cookie.
 * Same refresh-before-clear pattern as the rest of Akoro's apps.
 */
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { API, rememberExpiry, refreshSession } from '../services/api.js';

const AuthContext = createContext(null);
const USER_KEY = 'akoro_business_user';
const REDIRECT_KEY = 'akoro_business_redirect';

function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}

async function authFetch(path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'business' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // Network-level failure (DNS/TLS/CORS preflight) — surface the target so
    // "Failed to fetch" is diagnosable instead of anonymous.
    throw new Error(`Cannot reach the API at ${API}. Check VITE_API_URL and the backend's CORS_ORIGIN.`);
  }
  const json = await res.json();
  if (!res.ok) {
    // The STATUS is what tells refresh() whether the session is really gone or
    // the request merely didn't land. Without it every failure looked fatal.
    const err = new Error(json.message || `${path} failed`);
    err.status = res.status;
    throw err;
  }
  // Sign-in is where the first expiry comes from — without it the next visit
  // after 15 minutes still discovers the dead token once per request.
  rememberExpiry(json);
  return json;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const isAuthenticated = !!user;

  const saveUser = useCallback((u) => { localStorage.setItem(USER_KEY, JSON.stringify(u)); setUser(u); setError(null); }, []);
  const clearUser = useCallback(() => { localStorage.removeItem(USER_KEY); setUser(null); }, []);

  const register = useCallback(async ({ email, password, fullName }) => {
    setLoading(true); setError(null);
    try {
      const { data } = await authFetch('/api/auth/register', { email, password, fullName, role: 'student' });
      if (data?.user) saveUser(data.user);
      return data;
    } catch (e) { setError(e.message); throw e; } finally { setLoading(false); }
  }, [saveUser]);

  const login = useCallback(async ({ email, password }) => {
    setLoading(true); setError(null);
    try {
      const { data } = await authFetch('/api/auth/login', { email, password });
      if (data?.twoFactorRequired) return data;
      if (data?.user) saveUser(data.user);
      return data;
    } catch (e) { setError(e.message); throw e; } finally { setLoading(false); }
  }, [saveUser]);

  /**
   * Delegates to services/api.js so there is exactly ONE refresh in flight per
   * tab. This used to POST the endpoint itself, which meant this timer and the
   * 401-retry path could both be carrying the same refresh cookie — and since
   * rotation spends a token on first use, the loser looked like a replay and
   * the server revoked every session the user had.
   */
  const refresh = useCallback(async () => {
    const r = await refreshSession();
    if (r.ok) {
      const u = r.json?.data?.user ?? r.json?.user;
      if (u) saveUser(u);
      return true;
    }
    // Only a real REJECTION ends a session. A 429, a 502 or a dropped
    // connection means we never got an answer — the 30-day refresh cookie is
    // still valid and the next attempt should use it, so the session stays.
    if (r.status === 401 || r.status === 403) { clearUser(); return false; }
    console.warn(`[auth] refresh could not complete (status ${r.status}), keeping the session`);
    return false;
  }, [saveUser, clearUser]);

  // Google sign-in is a full-page redirect (not a fetch) — the backend sets the
  // business-scoped cookie and bounces back to /auth/callback with the user blob.
  const loginWithGoogle = useCallback((redirectAfter = '/') => {
    localStorage.setItem(REDIRECT_KEY, redirectAfter);
    window.location.href = `${API}/api/auth/google?portal=business`;
  }, []);

  const restoreFromCallback = useCallback((userObj) => { if (userObj) saveUser(userObj); }, [saveUser]);

  const logout = useCallback(async () => {
    try { await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'business' } }); } catch { /* ignore */ }
    clearUser();
    window.location.href = '/signin';
  }, [clearUser]);

  useEffect(() => {
    if (!getStoredUser()) return;
    fetch(`${API}/api/auth/me`, { credentials: 'include', headers: { 'X-Akoro-Portal': 'business' } })
      .then((r) => r.json())
      .then(({ data }) => { if (data?.id) saveUser(data); else refresh(); })
      .catch(() => refresh());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAuthenticated) return;
    const id = setInterval(() => refresh(), 13 * 60 * 1000);
    return () => clearInterval(id);
  }, [isAuthenticated, refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, error, isAuthenticated, login, register, loginWithGoogle, restoreFromCallback, logout, refresh, clearError: () => setError(null) }}>
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
