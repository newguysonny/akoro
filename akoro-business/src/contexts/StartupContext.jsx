/**
 * StartupContext — which of the user's registered startups is "current".
 * A business owner may run more than one storefront; every page reads from
 * here instead of re-fetching /startups/mine.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiGet } from '../services/api.js';
import { useAuth } from './AuthContext.jsx';

const StartupContext = createContext(null);
const CURRENT_KEY = 'akoro_business_current_startup';

export function StartupProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [startups, setStartups] = useState(null);   // null = loading
  const [currentId, setCurrentIdState] = useState(() => localStorage.getItem(CURRENT_KEY) || null);
  const [error, setError] = useState(false);
  // Explicit, NOT derived from `startups === null`. On sign-in the
  // unauthenticated branch below has already set startups to [], so a derived
  // flag reads "loaded + zero businesses" while the real fetch is still in
  // flight — PageLayout then redirects to /create-startup, which is an exempt
  // path, so the user is stranded in onboarding every single login.
  const [loading, setLoading] = useState(true);

  // Returns the promise so callers (e.g. CreateStartupPage) can `await` it
  // before navigating — otherwise the caller races ahead of the state update
  // and PageLayout's needsOnboarding check still sees the stale empty list.
  const refresh = useCallback(() => {
    if (!isAuthenticated) { setStartups([]); setLoading(false); return Promise.resolve(); }
    setError(false);
    setLoading(true);
    return apiGet('/api/vouchers/startups/mine').then((r) => {
      const list = r.startups || [];
      setStartups(list);
      if (!currentId || !list.some((s) => s.id === currentId)) {
        const first = list[0]?.id || null;
        setCurrentIdState(first);
        if (first) localStorage.setItem(CURRENT_KEY, first); else localStorage.removeItem(CURRENT_KEY);
      }
    }).catch(() => {
      // Do NOT fall back to [] — PageLayout reads an empty list as "no
      // businesses yet" and redirects to /create-startup, so an API outage
      // would dump an established business owner into onboarding.
      setError(true);
      setStartups((prev) => prev ?? []);
    }).finally(() => setLoading(false));
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refresh(); }, [refresh]);

  const setCurrentId = (id) => { setCurrentIdState(id); localStorage.setItem(CURRENT_KEY, id); };
  const current = (startups || []).find((s) => s.id === currentId) || null;

  return (
    <StartupContext.Provider value={{ startups, current, currentId, setCurrentId, loading, error, refresh }}>
      {children}
    </StartupContext.Provider>
  );
}

export const useStartup = () => {
  const ctx = useContext(StartupContext);
  if (!ctx) throw new Error('useStartup must be used inside StartupProvider');
  return ctx;
};
