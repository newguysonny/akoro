/*
 * PresenceHeartbeat — tells the server this learner's app is open, so other
 * learners' agents can see them online (and consult or challenge them).
 * Once a minute while the tab is visible; straight away when it comes back.
 * Renders nothing.
 */
import { useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext.jsx';
import { sendHeartbeat } from '../../../services/agentNetworkApi.js';

const EVERY_MS = 60_000;

export default function PresenceHeartbeat() {
  const { isAuthenticated, user } = useAuth();
  const learner = isAuthenticated && (!user?.role || user.role === 'student');
  useEffect(() => {
    if (!learner) return undefined;
    const beat = () => { if (document.visibilityState === 'visible') sendHeartbeat('app'); };
    beat();
    const t = setInterval(beat, EVERY_MS);
    document.addEventListener('visibilitychange', beat);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', beat); };
  }, [learner]);
  return null;
}
