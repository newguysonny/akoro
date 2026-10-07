import { useState, useEffect } from 'react';
import { apiGet } from '../services/api.js';

export function useSessionAPI() {
  const [sessions,     setSessions]     = useState([]);
  const [agentSessions,setAgentSessions]= useState([]);

  useEffect(() => {
    apiGet('/api/student/sessions')
      .then(d => { if (d.sessions?.length) setSessions(d.sessions); })
      .catch(() => {});

    apiGet('/api/adaptive/teaching/sessions')
      .then(d => { if (d.sessions?.length) setAgentSessions(d.sessions); })
      .catch(() => {});
  }, []);

  return { sessions, setSessions, agentSessions, setAgentSessions };
}
