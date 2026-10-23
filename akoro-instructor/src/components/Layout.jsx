import { useState, useEffect, createContext, useContext } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import NextLayout from './NextLayout.jsx';
import { useInstructorSocket } from '../hooks/useWebSocket.js';
import { apiGet } from '../services/api.js';

/* Pending join-request count for the nav badge — event-driven over the
   socket (join-requests-changed) instead of polling every minute: the
   platform's command quota is spent on learners, not on idle badges. */
export function useJoinRequestCount() {
  const [count, setCount] = useState(0);
  const { user } = useAuth();
  const { on, off } = useInstructorSocket(user?.id);
  useEffect(() => {
    let alive = true;
    const poll = () => apiGet('/api/profiles/teacher/join-requests')
      .then((r) => { if (alive) setCount((r?.data || []).length); })
      .catch(() => {});
    poll();
    const onEvent = () => poll();
    const onFocus  = () => poll();
    on('join-requests-changed', onEvent);
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      off('join-requests-changed', onEvent);
      window.removeEventListener('focus', onFocus);
    };
  }, [on, off]);
  return count;
}

const MOBILE_QUERY = '(max-width: 767px)';

export function useIsMobile() {
  const [mobile, setMobile] = useState(() => {
    try { return window.matchMedia(MOBILE_QUERY).matches; } catch { return false; }
  });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia(MOBILE_QUERY); } catch { return; }
    const onChange = (e) => setMobile(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return mobile;
}

// The page frame: the shared frame (NextLayout, the learner app's look).
// Inside <PageEmbed>, a page renders without its frame (a page shown in a tab of another page).
const PageEmbedContext = createContext(false);
export const PageEmbed = ({ children }) => <PageEmbedContext.Provider value>{children}</PageEmbedContext.Provider>;

export function PageLayout(props) {
  const embedded = useContext(PageEmbedContext);
  if (embedded) return <>{props.children}</>;
  return <NextLayout {...props}/>;
}
