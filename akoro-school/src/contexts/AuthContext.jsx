/**
 * AuthContext — session backed by HttpOnly cookies set by the backend.
 *
 * Tokens live in HttpOnly cookies — no JS access, XSS-safe.
 * Only the safe user object is cached in localStorage for UI rendering.
 * Proactive refresh runs every 13 min (access token expires at 15 min).
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API } from '../services/api.js';

const AuthContext = createContext(null);

const USER_KEY     = 'akoro_user';
const REDIRECT_KEY = 'akoro_redirect';

function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}

async function authFetch(path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'school' },
      body:        JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  // Tolerate empty / non-JSON bodies (e.g. rate-limit or gateway errors) so we
  // surface a clear message instead of "Unexpected end of JSON input".
  const text = await res.text();
  let json = {};
  if (text) { try { json = JSON.parse(text); } catch { json = {}; } }
  if (!res.ok) throw new Error(json.message || json.error || `Request failed (${res.status})`);
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
    } catch { clearUser(); return false; }
  }, [saveUser, clearUser]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'school' } });
    } catch { /* ignore */ }
    clearUser();
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
    fetch(`${API}/api/auth/me`, { credentials: 'include', headers: { 'X-Akoro-Portal': 'school' } })
      .then(async (r) => { const t = await r.text(); try { return t ? JSON.parse(t) : {}; } catch { return {}; } })
      .then(({ data }) => { if (data?.id) { saveUser(data); return true; } clearUser(); return false; })
      .catch(() => false),
  [saveUser, clearUser]);

  // Verify session on mount. An AI-chat hand-off (?ai=<token>) from the public
  // school website is exchanged HERE (on the portal's own origin) for a real
  // session cookie, then the URL is cleaned.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const handoff = params.get('ai');
    if (handoff) {
      fetch(`${API}/api/school/site/ai-login/exchange`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'school' },
        body: JSON.stringify({ token: handoff }),
      })
        .then((r) => (r.ok ? loadMe() : false))
        .catch(() => false)
        .finally(() => {
          params.delete('ai');
          const q = params.toString();
          window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : ''));
          setBooting(false);
        });
      return;
    }
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
      user, loading, error, isAuthenticated, booting,
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
