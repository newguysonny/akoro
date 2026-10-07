import { useState, useEffect } from 'react';
import { apiGet } from '../services/api.js';
import { SESSIONS, AGENT_SESSIONS } from '../services/mockData.js';

export function useSessionAPI() {
  const [sessions,     setSessions]     = useState(SESSIONS);
  const [agentSessions,setAgentSessions]= useState(AGENT_SESSIONS);

  useEffect(() => {
    apiGet('/api/student/sessions')
      .then(d => { if (d.sessions?.length) setSessions(d.sessions); })
      .catch(() => {});

    apiGet('/api/adaptive/sessions')
      .then(d => { if (d.sessions?.length) setAgentSessions(d.sessions); })
      .catch(() => {});
  }, []);

  return { sessions, setSessions, agentSessions, setAgentSessions };
}
