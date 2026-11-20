import { useState, useEffect } from 'react';
import { apiGet } from '../../../services/api.js';
import { getStudentId } from '../../../constants.js';

export function useDecayAlerts() {
  const [decayAlerts, setDecayAlerts] = useState([]);

  useEffect(() => {
    apiGet(`/api/adaptive/chat/decay/alerts/${getStudentId()}`)
      .then(d => { if (d.alerts?.length) setDecayAlerts(d.alerts); })
      .catch(() => {});
  }, []);

  return [decayAlerts, setDecayAlerts];
}
