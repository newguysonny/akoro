/**
 * AuthContext — session backed by HttpOnly cookies set by the backend.
 *
 * Tokens live in HttpOnly cookies — no JS access, XSS-safe.
 * Only the safe user object is cached in localStorage for UI rendering.
 * Proactive refresh runs every 13 min (access token expires at 15 min).
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API, rememberExpiry, refreshSession } from '../services/api.js';

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
    headers:     { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'admin' },
    body:        JSON.stringify(body),
  });
  // Tolerate empty / non-JSON bodies (rate limits, gateway restarts) so the
  // learner sees a clear message instead of "Unexpected end of JSON input".
  const text = await res.text();
  let json = {};
  if (text) { try { json = JSON.parse(text); } catch { json = {}; } }
  if (!res.ok) {
    const message = json.message
      || (res.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : null)
      || `${path} failed`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  // Sign-in is where the first expiry comes from — without it the next visit
  // after 15 minutes still discovers the dead token once per request.
  rememberExpiry(json);
  return json;
}

export function AuthProvider({ children }) {
  const [user,         setUser]         = useState(getStoredUser);
  const [loading,      setLoading]      = useState(false);
  const [initializing, setInitializing] = useState(true);   // true until session verified
  const [error,        setError]        = useState(null);

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

  const verifyEmail = useCallback(async ({ challengeId, code }) => {
    setLoading(true); setError(null);
    try {
      const { data } = await authFetch('/api/auth/verify-email', { challengeId, code });
      if (data?.user) saveUser(data.user);
      return data;
    } catch (err) { setError(err.message); throw err; }
    finally { setLoading(false); }
  }, [saveUser]);

  const verifyLogin = useCallback(async ({ challengeId, code }) => {
    setLoading(true); setError(null);
    try {
      const { data } = await authFetch('/api/auth/verify-login', { challengeId, code });
      if (data?.twoFactorRequired) return data;
      if (data?.user) saveUser(data.user);
      return data;
    } catch (err) { setError(err.message); throw err; }
    finally { setLoading(false); }
  }, [saveUser]);

  const resendCode = useCallback(async ({ challengeId, email }) => {
    const { data } = await authFetch('/api/auth/resend-code', { challengeId, email });
    return data;
  }, []);

  const setupTwoFactor = useCallback(async ({ setupToken }) => {
    const { data } = await authFetch('/api/auth/2fa/setup', { setupToken });
    return data;
  }, []);

  const enableTwoFactor = useCallback(async ({ setupToken, code }) => {
    const { data } = await authFetch('/api/auth/2fa/enable', { setupToken, code });
    if (data?.user) saveUser(data.user);
    return data;
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

  const logout = useCallback(async () => {
    try {
      await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'admin' } });
    } catch { /* ignore */ }
    clearUser();
    window.location.href = '/signin';
  }, [clearUser]);

  // Same as logout but without the hard redirect — caller controls navigation.
  const logoutSilent = useCallback(async () => {
    try {
      await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'admin' } });
    } catch { /* ignore */ }
    clearUser();
  }, [clearUser]);

  const loginWithGoogle = useCallback((redirectAfter = '/') => {
    localStorage.setItem(REDIRECT_KEY, redirectAfter);
    window.location.href = `${API}/api/auth/google?portal=admin`;
  }, []);

  // Token is now in HttpOnly cookie — only user object comes via URL param
  const restoreFromCallback = useCallback((userObj) => {
    if (userObj) saveUser(userObj);
  }, [saveUser]);

  // Verify session on mount — sets initializing=false when done regardless of outcome
  useEffect(() => {
    if (!getStoredUser()) { setInitializing(false); return; }
    fetch(`${API}/api/auth/me`, { credentials: 'include', headers: { 'X-Akoro-Portal': 'admin' } })
      .then(r => r.json())
      // Expired access token → /me 401 with no data. Try the (30-day) refresh
      // cookie BEFORE clearing, so an inactive user isn't logged out at 15 min.
      .then(({ data }) => { if (data?.id) saveUser(data); else refresh(); })
      .catch(() => refresh())
      .finally(() => setInitializing(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Proactive refresh every 13 minutes (access token TTL = 15 min)
  useEffect(() => {
    if (!isAuthenticated) return;
    const id = setInterval(() => refresh(), 13 * 60 * 1000);
    return () => clearInterval(id);
  }, [isAuthenticated, refresh]);

  return (
    <AuthContext.Provider value={{
      user, loading, initializing, error, isAuthenticated,
      login, verifyEmail, verifyLogin, resendCode, verifyTwoFactor, setupTwoFactor, enableTwoFactor, register, loginWithGoogle, logout, logoutSilent, refresh, restoreFromCallback,
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
