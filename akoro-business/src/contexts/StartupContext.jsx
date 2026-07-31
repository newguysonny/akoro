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

  const refresh = useCallback(() => {
    if (!isAuthenticated) { setStartups([]); return; }
    apiGet('/api/vouchers/startups/mine').then((r) => {
      const list = r.startups || [];
      setStartups(list);
      if (!currentId || !list.some((s) => s.id === currentId)) {
        const first = list[0]?.id || null;
        setCurrentIdState(first);
        if (first) localStorage.setItem(CURRENT_KEY, first); else localStorage.removeItem(CURRENT_KEY);
      }
    }).catch(() => setStartups([]));
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refresh(); }, [refresh]);

  const setCurrentId = (id) => { setCurrentIdState(id); localStorage.setItem(CURRENT_KEY, id); };
  const current = (startups || []).find((s) => s.id === currentId) || null;

  return (
    <StartupContext.Provider value={{ startups, current, currentId, setCurrentId, loading: startups === null, refresh }}>
      {children}
    </StartupContext.Provider>
  );
}

export const useStartup = () => {
  const ctx = useContext(StartupContext);
  if (!ctx) throw new Error('useStartup must be used inside StartupProvider');
  return ctx;
};
