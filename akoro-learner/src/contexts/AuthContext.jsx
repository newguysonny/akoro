/**
 * AuthContext — session backed by HttpOnly cookies set by the backend.
 *
 * Tokens live in HttpOnly cookies — no JS access, XSS-safe.
 * Only the safe user object is cached in localStorage for UI rendering.
 * Proactive refresh runs every 13 min (access token expires at 15 min).
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API, rememberExpiry } from '../services/api.js';
import { cacheClear } from '../services/offlineCache.js';

const AuthContext = createContext(null);

const USER_KEY     = 'akoro_user';
const REDIRECT_KEY = 'akoro_redirect';

function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}

async function authFetch(path, body) {
  const res = await fetch(`${API}${path}`, {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'student' },
    body:        JSON.stringify(body),
  });
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
  const [user,    setUser]    = useState(getStoredUser);
  const [loading, setLoading] = useState(false);
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

  // Flip the local onboarding flag once the wizard saves it server-side,
  // so the gate releases without a full reload.
  const markOnboarded = useCallback(() => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, onboardingCompleted: true };
      localStorage.setItem(USER_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const register = useCallback(async ({ email, password, username, fullName }) => {
    setLoading(true); setError(null);
    try {
      const { data } = await authFetch('/api/auth/register', { email, password, username, fullName });
      if (data?.user) saveUser(data.user);
      return data;
    } catch (err) { setError(err.message); throw err; }
    finally { setLoading(false); }
  }, [saveUser]);

  const login = useCallback(async ({ email, password }) => {
    setLoading(true); setError(null);
    try {
      const { data } = await authFetch('/api/auth/login', { email, password });
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
      // Only a real REJECTION ends a session. This used to ask "are we offline?"
      // and sign out whenever the answer was no — but a 429 from the refresh
      // limiter, or a 502, is the server failing to answer, not the server
      // saying no. The proactive refresh runs every 13 minutes, so one such
      // reply logged the learner out with a valid 30-day refresh cookie in hand.
      //
      // 401/403 means the server looked and rejected us. Anything else — a
      // network throw, a rate limit, a gateway error — means we simply have no
      // answer yet, and the session should survive until we do. The service
      // worker keeps serving cached content in the meantime.
      if (err?.status === 401 || err?.status === 403) { clearUser(); return false; }
      console.warn('[auth] refresh could not complete, keeping the session:', err?.message);
      return false;
    }
  }, [saveUser, clearUser]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'student' } });
    } catch { /* ignore */ }
    cacheClear().catch(() => {});   // drop cached data so the next account starts clean
    clearUser();
    window.location.href = '/signin';
  }, [clearUser]);

  const loginWithGoogle = useCallback((redirectAfter = '/') => {
    localStorage.setItem(REDIRECT_KEY, redirectAfter);
    window.location.href = `${API}/api/auth/google`;
  }, []);

  // Token is now in HttpOnly cookie — only user object comes via URL param
  const restoreFromCallback = useCallback((userObj) => {
    if (userObj) saveUser(userObj);
  }, [saveUser]);

  // Verify session on mount
  useEffect(() => {
    if (!getStoredUser()) return;
    fetch(`${API}/api/auth/me`, { credentials: 'include', headers: { 'X-Akoro-Portal': 'student' } })
      .then(r => r.json())
      // Expired access token → /me 401 with no data. Try the (30-day) refresh
      // cookie BEFORE clearing, so an inactive user isn't logged out at 15 min.
      .then(({ data }) => { if (data?.id) saveUser(data); else refresh(); })
      .catch(() => refresh());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Proactive refresh every 13 minutes (access token TTL = 15 min)
  useEffect(() => {
    if (!isAuthenticated) return;
    const id = setInterval(() => refresh(), 13 * 60 * 1000);
    return () => clearInterval(id);
  }, [isAuthenticated, refresh]);

  return (
    <AuthContext.Provider value={{
      user, loading, error, isAuthenticated,
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
