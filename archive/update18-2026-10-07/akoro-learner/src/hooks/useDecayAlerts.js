import { useState, useEffect } from 'react';
import { apiGet } from '../services/api.js';
import { MOCK_DECAY_ALERTS } from '../services/mockData.js';

export function useDecayAlerts() {
  const [decayAlerts, setDecayAlerts] = useState(MOCK_DECAY_ALERTS);

  useEffect(() => {
    apiGet('/api/adaptive/decay/alerts')
      .then(d => { if (d.alerts?.length) setDecayAlerts(d.alerts); })
      .catch(() => {});
  }, []);

  return [decayAlerts, setDecayAlerts];
}
