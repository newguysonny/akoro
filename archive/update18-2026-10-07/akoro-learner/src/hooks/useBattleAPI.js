import { useState, useEffect } from 'react';
import { apiGet } from '../services/api.js';
import { CHALLENGES, SEED_BATTLES } from '../services/mockData.js';

export function useBattleAPI() {
  const [challenges, setChallenges] = useState(CHALLENGES);
  const [battles,    setBattles]    = useState(SEED_BATTLES);

  useEffect(() => {
    apiGet('/api/battle/my-challenges')
      .then(d => { if (d.challenges?.length) setChallenges(d.challenges); })
      .catch(() => {});

    apiGet('/api/battle/my-battles')
      .then(d => { if (d.battles?.length) setBattles(d.battles); })
      .catch(() => {});
  }, []);

  return { challenges, setChallenges, battles, setBattles };
}
