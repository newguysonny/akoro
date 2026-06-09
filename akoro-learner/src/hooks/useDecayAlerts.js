import { useState, useEffect } from 'react';
import { apiGet } from '../services/api.js';

export function useDecayAlerts() {
  const [decayAlerts, setDecayAlerts] = useState([]);

  useEffect(() => {
    apiGet('/api/adaptive/decay/alerts')
      .then(d => { if (d.alerts?.length) setDecayAlerts(d.alerts); })
      .catch(() => {});
  }, []);

  return [decayAlerts, setDecayAlerts];
}
