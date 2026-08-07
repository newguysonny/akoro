import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../services/api.js';

export function useBattleAPI() {
  const [challenges, setChallenges] = useState([]);
  const [battles,    setBattles]    = useState([]);

  // Both endpoints answer { success, data } and already return the card shape
  // the tabs render, so there's nothing to map here.
  const refetch = useCallback(() => {
    apiGet('/api/battle/my-challenges')
      .then(d => setChallenges(d?.data ?? []))
      .catch(() => {});
    apiGet('/api/battle/my-battles')
      .then(d => setBattles(d?.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { challenges, setChallenges, battles, setBattles, refetch };
}
