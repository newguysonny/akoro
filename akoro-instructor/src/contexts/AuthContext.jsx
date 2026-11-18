/**
 * AuthContext — session backed by HttpOnly cookies set by the backend.
 *
 * Tokens live in HttpOnly cookies — no JS access, XSS-safe.
 * Only the safe user object is cached in localStorage for UI rendering.
 * Proactive refresh runs every 13 min (access token expires at 15 min).
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API, rememberExpiry, refreshSession } from '../services/api.js';
import { refreshAuth } from '../client/authSession';
import { createSessionUser } from '../client/sessionUser';

const AuthContext = createContext(null);

const REDIRECT_KEY = 'akoro_redirect';

const sessionUser = createSessionUser();
const getStoredUser = () => sessionUser.read();

async function authFetch(path, body) {
  const res = await fetch(`${API}${path}`, {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json', 'X-Akoro-Portal': 'instructor' },
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
  const [user,    setUser]    = useState(getStoredUser);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const isAuthenticated = !!user;

  const saveUser = useCallback((userObj) => {
    sessionUser.save(userObj);
    setUser(userObj);
    setError(null);
  }, []);

  const clearUser = useCallback(() => {
    sessionUser.clear();
    setUser(null);
  }, []);

  // Flip the local onboarding flag once the wizard saves it server-side.
  const markOnboarded = useCallback(() => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, onboardingCompleted: true };
      sessionUser.save(next);
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

  const resendCode = useCallback(async ({ challengeId }) => {
    const { data } = await authFetch('/api/auth/resend-code', { challengeId });
    return data;
  }, []);

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
    // Keep a locally-completed onboarding flag: the server row can lag behind
    // the wizard, and regressing it re-gates the user.
    const keepOnboarded = (u) => {
      const prev = getStoredUser();
      return prev?.onboardingCompleted && u.onboardingCompleted === false
        ? { ...u, onboardingCompleted: true } : u;
    };
    const res = await refreshAuth({
      refreshSession,
      saveUser: (u) => saveUser(keepOnboarded(u)),
      clearUser,
      onSoftFailure: (status) => console.warn(`[auth] refresh could not complete (status ${status}), keeping the session`),
    });
    return res.ok;
  }, [saveUser, clearUser]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'instructor' } });
    } catch { /* ignore */ }
    clearUser();
    window.location.href = '/signin';
  }, [clearUser]);

  const loginWithGoogle = useCallback((redirectAfter = '/') => {
    localStorage.setItem(REDIRECT_KEY, redirectAfter);
    window.location.href = `${API}/api/auth/google?portal=instructor`;
  }, []);

  // Token is now in HttpOnly cookie — only user object comes via URL param
  const restoreFromCallback = useCallback((userObj) => {
    if (userObj) saveUser(userObj);
  }, [saveUser]);

  // Verify session on mount.
  //
  // The 15-min access token can expire while the user is off-site (e.g. on a
  // provider's OAuth consent screen while connecting a streaming platform).
  // On return, /me responds 401/403 with no `data`. We must try a refresh
  // (the refresh cookie is still valid) BEFORE clearing — otherwise the user
  // is spuriously logged out and lands on "Access token required" / onboarding
  // despite having a live session.
  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) return;
    fetch(`${API}/api/auth/me`, { credentials: 'include', headers: { 'X-Akoro-Portal': 'instructor' } })
      .then(r => r.json())
      .then(({ data }) => {
        if (data?.id) {
          // Never regress an already-onboarded account back into the
          // onboarding gate on a routine re-verify (e.g. a NULL column).
          if (stored.onboardingCompleted && data.onboardingCompleted === false) {
            data = { ...data, onboardingCompleted: true };
          }
          saveUser(data);
        } else {
          // Access token likely expired — recover via the refresh cookie
          // instead of logging the user out.
          refresh();
        }
      })
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
      login, verifyEmail, verifyLogin, resendCode, verifyTwoFactor, register, loginWithGoogle, logout, refresh, restoreFromCallback,
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
