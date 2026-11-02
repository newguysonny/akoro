import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiPost } from '../services/api.js';

const AuthContext = createContext(null);

const STORAGE_KEY  = 'akoro_jwt';
const USER_KEY     = 'akoro_user';
const REDIRECT_KEY = 'akoro_redirect';

function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(getStoredUser);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const isAuthenticated = !!user && !!localStorage.getItem(STORAGE_KEY);

  // ── Persist session ───────────────────────────────────────────
  const saveSession = useCallback((token, userObj) => {
    localStorage.setItem(STORAGE_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(userObj));
    setUser(userObj);
    setError(null);
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  // ── Register ──────────────────────────────────────────────────
  const register = useCallback(async ({ email, password, username, fullName }) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiPost('/api/auth/register', { email, password, username, fullName });
      if (data.token) saveSession(data.token, data.user);
      return data;
    } catch (err) {
      const msg = err.message || 'Registration failed';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [saveSession]);

  // ── Login ─────────────────────────────────────────────────────
  const login = useCallback(async ({ email, password }) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiPost('/api/auth/login', { email, password });
      if (data.token) saveSession(data.token, data.user);
      return data;
    } catch (err) {
      const msg = err.message || 'Invalid email or password';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [saveSession]);

  // ── Google OAuth ──────────────────────────────────────────────
  const loginWithGoogle = useCallback((redirectAfter = '/') => {
    localStorage.setItem(REDIRECT_KEY, redirectAfter);
    const API = import.meta?.env?.VITE_API_URL || 'https://akoro.app';
    window.location.href = `${API}/api/auth/google`;
  }, []);

  // ── Logout ────────────────────────────────────────────────────
  const logout = useCallback(() => {
    clearSession();
    window.location.href = '/signin';
  }, [clearSession]);

  // ── Restore from OAuth callback ───────────────────────────────
  const restoreFromCallback = useCallback((token, userObj) => {
    saveSession(token, userObj);
  }, [saveSession]);

  // ── Check token on mount ──────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEY);
    const storedUser = getStoredUser();
    if (token && storedUser) {
      setUser(storedUser);
    } else {
      clearSession();
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user, loading, error, isAuthenticated,
      login, register, loginWithGoogle, logout, restoreFromCallback,
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
