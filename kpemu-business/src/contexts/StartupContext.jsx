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
  // Which auth state the data in `startups` actually belongs to.
  //
  // This must be computed during RENDER, not set from an effect. React runs
  // child effects before parent ones, so PageLayout's redirect effect fires
  // BEFORE StartupProvider's fetch effect — a `loading` flag flipped inside
  // an effect is still false at that moment, PageLayout sees "loaded + zero
  // businesses" (the [] left by the pre-login branch) and redirects to
  // /create-startup, which is exempt, so the user is stranded there. Deriving
  // it from state makes it correct on the very first render after sign-in.
  const [loadedFor, setLoadedFor] = useState(null);
  const loading = loadedFor !== isAuthenticated;

  // Returns the promise so callers (e.g. CreateStartupPage) can `await` it
  // before navigating — otherwise the caller races ahead of the state update
  // and PageLayout's needsOnboarding check still sees the stale empty list.
  const refresh = useCallback(() => {
    if (!isAuthenticated) { setStartups([]); setLoadedFor(false); return Promise.resolve(); }
    setError(false);
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
    }).finally(() => setLoadedFor(true));
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
