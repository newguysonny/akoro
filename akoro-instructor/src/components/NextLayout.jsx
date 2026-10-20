/**
 * NextLayout — the instructor app in the shared frame (the "next" look,
 * ?ui=next): the learner app's sidebar, header and phone bottom nav, from the
 * UI kit (src/ui, synced from design-system/ui). Same destinations as the
 * legacy Layout.jsx; groups are dropdowns in the open sidebar and flyouts on
 * the collapsed rail. See reference/Akoro Console Rebuild — Plan.md.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Shell, CoinPill, CartButton, BellButton, AgentToggle, Icon, GOLD } from '../ui/index.js';
import { useAgentOnline } from '../hooks/useAgentOnline.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useInstructorSocket } from '../hooks/useWebSocket.js';
import { apiGet } from '../services/api.js';
import { useJoinRequestCount } from './Layout.jsx';

/** PURE: the instructor's nav for the shared frame. */
export function instructorNav({ isAdmin = false, joinRequests = 0 } = {}) {
  return [
    { section: null, items: [
      { key: 'home', label: 'Home', to: '/', icon: 'sessions' },
      // Course Creator replaces the Courses page; its own Schedule sessions page joins the group.
      { key: 'course-creator', label: 'Course Creator', short: 'Courses', to: '/course-creator', icon: 'library', children: [
        { label: 'Home', to: '/course-creator', end: true },
        { label: 'My Courses', to: '/course-creator/courses' },
        { label: 'Content Library', to: '/course-creator/library' },
        { label: 'Schedule sessions', to: '/courses/schedule' },
        ...(isAdmin ? [{ label: 'Review Queue', to: '/course-creator/review' }] : []),
      ] },
      { key: 'battles', label: 'Battles', to: '/battles', icon: 'battles' },
      { key: 'agent', label: 'Agent', to: '/chat', icon: 'agent', dot: true },
    ] },
    { section: 'Teaching', items: [
      { key: 'student-info', label: 'Student Information', icon: 'communities', children: [
        { label: 'My Students', to: '/mgmt/students' },
        { label: 'Join Requests', to: '/mgmt/join-requests', badge: joinRequests },
        { label: 'Attendance', to: '/mgmt/attendance' },
        { label: 'Behavior Records', to: '/mgmt/behavior' },
      ] },
      { key: 'academic', label: 'Academic', icon: 'gradebook', children: [
        { label: 'My Timetable', to: '/mgmt/my-timetable' },
        { label: 'Curriculum', to: '/mgmt/curriculum' },
        { label: 'Syllabus', to: '/mgmt/syllabus' },
        { label: 'Subjects', to: '/mgmt/subjects' },
        { label: 'Gradebook', to: '/mgmt/gradebook' },
        { label: 'Class Timetable', to: '/mgmt/timetable' },
        { label: 'Weekly Forecast', to: '/mgmt/weekly-forecast' },
        { label: 'Review AI Lessons', to: '/lesson-review' },
        { label: 'Daily Schedule', to: '/mgmt/daily-schedule' },
      ] },
      { key: 'activities', label: 'Activities', to: '/activities', icon: 'activities' },
      { key: 'submissions', label: 'Submissions', to: '/submissions', ti: 'ti-clipboard-check' },
      { key: 'tasks', label: 'Tasks', to: '/tasks', ti: 'ti-checkbox' },
      { key: 'self-study', label: 'AI Self Study', to: '/self-study', ti: 'ti-sparkles' },
      { key: 'assessments', label: 'Assessments', to: '/assessments', ti: 'ti-shield-check' },
      { key: 'documents', label: 'Documents', to: '/documents', ti: 'ti-file-text' },
      { key: 'library', label: 'Library', to: '/library', ti: 'ti-library' },
    ] },
    { section: 'More', items: [
      { key: 'wallet', label: 'Wallet & Credits', to: '/wallet', icon: 'wallet' },
      { key: 'sales', label: 'Sales & Earnings', to: '/sales', ti: 'ti-chart-line' },
      { key: 'marketplace', label: 'Tools & Assets', to: '/marketplace', ti: 'ti-building-store' },
      { key: 'apps', label: 'App Center', to: '/apps', ti: 'ti-apps' },
      { key: 'profile', label: 'Profile', to: '/profile', ti: 'ti-user-circle' },
      { key: 'settings', label: 'Settings', to: '/settings', icon: 'settings' },
    ] },
  ];
}
export const INSTRUCTOR_BOTTOM = ['home', 'course-creator', 'battles', 'agent'];

/* Unread notifications for the bell — refetched on the server's push, like the legacy BellButton. */
function useUnreadNotifications(userId) {
  const { on, off } = useInstructorSocket(userId);
  const [unread, setUnread] = useState(0);
  const poll = useCallback(() => apiGet('/api/notifications?limit=1').then((r) => setUnread(r.unread ?? 0)).catch(() => {}), []);
  useEffect(() => {
    poll();
    window.addEventListener('focus', poll);
    window.addEventListener('akoro:notifications-changed', poll);
    on('notification', poll);
    return () => {
      window.removeEventListener('focus', poll);
      window.removeEventListener('akoro:notifications-changed', poll);
      off('notification', poll);
    };
  }, [poll, on, off]);
  return unread;
}

function useCoins() {
  const [coins, setCoins] = useState(null);
  useEffect(() => { apiGet('/api/wallet').then((r) => setCoins(r.data?.balance ?? 0)).catch(() => {}); }, []);
  return coins;
}

/* The shared cart's item count (instructors buy Tools & Assets; the cart opens the marketplace). */
function useCartCount() {
  const [n, setN] = useState(0);
  useEffect(() => { apiGet('/api/cart').then((r) => setN((r?.data ?? r)?.item_count ?? 0)).catch(() => {}); }, []);
  return n;
}

/* The agent's XP, for the line under the name (as the learner header shows it). */
function useAgentXp() {
  const [xp, setXp] = useState(null);
  useEffect(() => { apiGet('/api/instructor/stats').then((r) => setXp(r?.data?.agent_xp ?? null)).catch(() => {}); }, []);
  return xp;
}

// Every page spans the frame, like the learner app's (onboarding keeps its card width).
const NARROW = ['/onboarding'];

export default function NextLayout({ children, title, subtitle, action, bare = false }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const joinRequests = useJoinRequestCount();
  const unread = useUnreadNotifications(user?.id);
  const coins = useCoins();
  const cart = useCartCount();
  const xp = useAgentXp();
  const agent = useAgentOnline();
  const name = user?.fullName || user?.email || 'Instructor';
  const role = user?.role === 'admin' ? 'Admin · Instructor' : 'Instructor';
  return (
    <Shell
      brand="Instructor"
      nav={instructorNav({ isAdmin: user?.role === 'admin', joinRequests })}
      bottom={INSTRUCTOR_BOTTOM}
      online={agent.loaded ? agent.online : undefined}
      user={{ name, initial: name[0].toUpperCase(),
        sub: <><Icon name="ti-bolt" size={11} color={GOLD}/>{xp != null ? `${Number(xp).toLocaleString()} XP · ${role}` : role}</> }}
      onProfile={() => navigate('/profile')}
      title={title} subtitle={subtitle} action={action}
      bare={bare} wide={!NARROW.some((p) => pathname === p || pathname.startsWith(`${p}/`))}
      headerRight={(
        <>
          {coins != null && <CoinPill coins={coins} low={coins < 50} onClick={() => navigate('/wallet')}/>}
          <CartButton count={cart} onClick={() => navigate('/marketplace')}/>
          <BellButton count={unread} onClick={() => navigate('/notifications')}/>
          <AgentToggle online={agent.online} loaded={agent.loaded} saving={agent.saving} onToggle={agent.toggle}
            onTitle="Agent online: it watches your classes and proposes next steps (missing work, low scores) for you to approve."
            offTitle="Agent offline: no background work on your classes."/>
        </>
      )}
    >
      {children}
    </Shell>
  );
}
