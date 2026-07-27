/**
 * useWallet — fetch the learner's coin balance + recent ledger from /api/wallet.
 * Shared by the dashboard header chip, the settings card, and the Wallet page.
 */
import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../services/api.js';

export function useWallet() {
  const [wallet, setWallet]   = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await apiGet('/api/wallet', { cache: false });
      setWallet(r.data || { balance: 0, accounts: [], recent: [] });
    } catch {
      setWallet({ balance: 0, accounts: [], recent: [] });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { wallet, balance: wallet?.balance ?? 0, loading, refresh };
}
