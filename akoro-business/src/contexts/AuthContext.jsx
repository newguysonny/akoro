/**
 * AuthContext — session backed by the 'business'-portal HttpOnly cookie.
 * Same refresh-before-clear pattern as the rest of Akoro's apps.
 */
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { API } from '../services/api.js';

const AuthContext = createContext(null);
const USER_KEY = 'akoro_business_user';
const REDIRECT_KEY = 'akoro_business_redirect';

function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}

async function authFetch(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'business' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || `${path} failed`);
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

  const refresh = useCallback(async () => {
    try {
      const { data } = await authFetch('/api/auth/refresh', {});
      if (data?.user) saveUser(data.user);
      return true;
    } catch { clearUser(); return false; }
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
