import { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import AkoroLogo from './common/AkoroLogo.jsx';
import { Home, BookOpen, Users, Swords, MessageSquare, CheckSquare, LogOut, Bell, Settings, UserCircle, ShieldCheck, Store, Library, LayoutGrid, FileText, ClipboardList, ClipboardCheck, ListChecks, BookMarked, CalendarDays, CalendarClock, GraduationCap, Menu, Search, ChevronDown, Wallet, BookOpenCheck, X, MessageCircleQuestion } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import AppHeader, { ReferenceChatIcon } from './AppHeader.jsx';

/* Setup progress for the header ring — a fraction of the profile that is
   actually filled in (plus an app-specific extra, e.g. a created business).
   Derived from real data; never a hard-coded number. */
const setupProgressOf = (u, extra = null) =>
  [u?.fullName || u?.name, u?.email, u?.phone, extra].filter(Boolean).length / 4;

import { useInstructorSocket } from '../hooks/useWebSocket.js';
import { apiGet } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, FONT } from '../constants.js';

const NAV = [
  { to: '/',         icon: Home,          label: 'Home' },
  { to: '/courses',  icon: BookOpen,      label: 'Courses' },
  // Course Creator — the marketplace course builder, as an expandable group
  // (same pattern as Student Information / the admin app's Program Courses):
  // its children are the reference's sidebar pages. The admin-only Review
  // Queue is appended in Sidebar for admin sessions.
  { label: 'Course Creator', icon: BookMarked, children: [
    { label: 'Home',            to: '/course-creator', end: true },
    { label: 'My Courses',      to: '/course-creator/courses' },
    { label: 'Content Library', to: '/course-creator/library' },
  ] },
  { to: '/sales',    icon: Wallet,        label: 'Sales & Earnings' },
  { to: '/battles',  icon: Swords,        label: 'Battles' },
  { to: '/tasks',    icon: CheckSquare,   label: 'Tasks' },
  { to: '/submissions', icon: ClipboardCheck, label: 'Submissions' },
  { to: '/activities', icon: ClipboardList, label: 'Activities' },
  { to: '/self-study', icon: BookOpenCheck, label: 'AI Self Study' },
  { to: '/documents', icon: FileText,     label: 'Documents' },
  { to: '/assessments', icon: ShieldCheck, label: 'Assessments' },
  { to: '/apps',     icon: LayoutGrid,    label: 'App Center' },
  { to: '/marketplace', icon: Store,       label: 'Tools & Assets' },
  { to: '/library',  icon: Library,       label: 'Library' },
  { to: '/chat',     icon: MessageSquare, label: 'AI Chat' },
  { to: '/wallet',   icon: Wallet,        label: 'Wallet & Credits' },
  { to: '/profile',  icon: UserCircle,    label: 'Profile' },
  { to: '/settings', icon: Settings,      label: 'Settings' },
];

// Management — teacher-scoped student info + academics, as expandable dropdown
// groups (matches the school dashboard).
const MGMT_NAV = [
  { label: 'Student Information', icon: Users, children: [
    { label: 'My Students',      to: '/mgmt/students' },
    { label: 'Join Requests',    to: '/mgmt/join-requests', badgeKey: 'joinRequests' },
    { label: 'Attendance',       to: '/mgmt/attendance' },
    { label: 'Behavior Records', to: '/mgmt/behavior' },
  ] },
  { label: 'Academic', icon: GraduationCap, children: [
    { label: 'My Timetable',    to: '/mgmt/my-timetable' },
    { label: 'Curriculum',      to: '/mgmt/curriculum' },
    { label: 'Syllabus',        to: '/mgmt/syllabus' },
    { label: 'Subjects',        to: '/mgmt/subjects' },
    { label: 'Gradebook',       to: '/mgmt/gradebook' },
    { label: 'Class Timetable', to: '/mgmt/timetable' },
    { label: 'Weekly Forecast', to: '/mgmt/weekly-forecast' },
    { label: 'Review AI Lessons', to: '/lesson-review' },
    { label: 'Daily Schedule',  to: '/mgmt/daily-schedule' },
  ] },
];

function NavItem({ to, icon: Icon, label, compact }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      title={compact ? label : undefined}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center',
        gap: compact ? 0 : 12,
        justifyContent: compact ? 'center' : 'flex-start',
        padding: compact ? '11px 0' : '10px 16px',
        borderRadius: 10, margin: compact ? '2px 10px' : '2px 8px',
        textDecoration: 'none', color: isActive ? WHITE : MUTED2,
        background: isActive ? `${AMBER}22` : 'transparent',
        fontFamily: FONT, fontSize: 14, fontWeight: isActive ? 600 : 400,
        transition: 'all .15s',
      })}
    >
      <Icon size={18} />
      {!compact && <span>{label}</span>}
    </NavLink>
  );
}

/* Pending join-request count for the nav badge — event-driven over the
   socket (join-requests-changed) instead of polling every minute: the
   platform's command quota is spent on learners, not on idle badges. */
function useJoinRequestCount() {
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

/* Small count pill for nav badges. */
function NavBadge({ count }) {
  if (!count) return null;
  return (
    <span style={{ minWidth: 17, height: 17, padding: '0 5px', borderRadius: 9, background: '#EF4444', color: WHITE, fontSize: 10, fontWeight: 800, fontFamily: FONT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0 }}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

/* Expandable nav group (dropdown) — matches the school dashboard. */
function Group({ item, collapsed, open, onToggle, badges = {} }) {
  const groupBadge = item.children.reduce((n, c) => n + (c.badgeKey ? (badges[c.badgeKey] || 0) : 0), 0);
  return (
    <div>
      <button title={collapsed ? item.label : undefined} onClick={onToggle}
        style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 12, justifyContent: collapsed ? 'center' : 'flex-start', width: 'calc(100% - 16px)', padding: collapsed ? '11px 0' : '10px 16px', margin: '2px 8px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 14, background: open && !collapsed ? 'rgba(255,255,255,.04)' : 'transparent', color: open ? WHITE : MUTED2 }}
        onMouseEnter={(e) => { e.currentTarget.style.color = WHITE; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = open ? WHITE : MUTED2; }}>
        <item.icon size={18} />
        {!collapsed && <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>}
        {!collapsed && groupBadge > 0 && !open && <NavBadge count={groupBadge} />}
        {collapsed && groupBadge > 0 && <span style={{ position: 'absolute', top: 4, right: 12, width: 8, height: 8, borderRadius: '50%', background: '#EF4444' }} />}
        {!collapsed && <ChevronDown size={14} style={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />}
      </button>
      {open && !collapsed && (
        <div style={{ margin: '2px 8px 6px 8px', paddingLeft: 22, borderLeft: '1px solid rgba(255,255,255,.08)' }}>
          {item.children.map((c) => (
            <NavLink key={c.label} to={c.to} end={c.to === '/' || !!c.end}
              style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 10px', textDecoration: 'none', fontFamily: FONT, fontSize: 12.5, color: isActive ? WHITE : MUTED2, background: isActive ? `${AMBER}22` : 'transparent', borderRadius: 8 })}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{c.label}</span>
              {c.badgeKey && <NavBadge count={badges[c.badgeKey] || 0} />}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ collapsed = false, onClose }) {
  const { user, logout } = useAuth();
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState({ 'Student Information': true });
  const toggleGroup = (k) => setOpenGroups((o) => ({ ...o, [k]: !o[k] }));
  // The hamburger is the sole control for collapse/expand (matches the school
  // dashboard). Previously `collapsed || medium` locked the sidebar to
  // icons-only on 769–1024px widths, so the hamburger could never expand it.
  const compact = collapsed;

  const joinRequestCount = useJoinRequestCount();
  const badges = { joinRequests: joinRequestCount };

  const q = query.trim().toLowerCase();
  // Admin sessions get the Course Creator's Review Queue (the reference's
  // admin view); instructors only ever see their own three pages.
  const navBase = user?.role === 'admin'
    ? NAV.map((i) => (i.label === 'Course Creator'
        ? { ...i, children: [...i.children, { label: 'Review Queue', to: '/course-creator/review' }] }
        : i))
    : NAV;
  const navItems = q
    ? navBase
        .map((i) => (i.children ? { ...i, children: i.children.filter((c) => c.label.toLowerCase().includes(q)) } : i))
        .filter((i) => (i.children ? (i.children.length || i.label.toLowerCase().includes(q)) : i.label.toLowerCase().includes(q)))
    : navBase;
  const mgmtGroups = q
    ? MGMT_NAV.map((g) => ({ ...g, children: g.children.filter((c) => c.label.toLowerCase().includes(q)) })).filter((g) => g.children.length || g.label.toLowerCase().includes(q))
    : MGMT_NAV;

  return (
    <aside style={{
      width: compact ? 72 : 240, flexShrink: 0, background: INK,
      display: 'flex', flexDirection: 'column',
      height: '100vh', overflow: 'hidden',
      transition: 'width .15s',
    }}>
      {/* Logo */}
      <div style={{
        padding: compact ? '24px 0 16px' : '24px 20px 16px',
        borderBottom: `1px solid rgba(255,255,255,.07)`,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: compact ? 'center' : 'flex-start', gap: 10,
        }}>
          <AkoroLogo size={36} radius={10} />
          {!compact && (
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: WHITE, fontFamily: FONT }}>Akoro</div>
              <div style={{ fontSize: 10, color: MUTED2, fontFamily: FONT }}>Instructor Portal</div>
            </div>
          )}
          {onClose && (
            <button onClick={onClose} aria-label="Close menu" title="Close menu" style={{ marginLeft: 'auto', width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)', color: WHITE, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Search menu */}
      {!compact ? (
        <div style={{ padding: '12px 14px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, padding: '8px 12px' }}>
            <Search size={15} color={MUTED2} style={{ flexShrink: 0 }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search menu…"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: WHITE, fontSize: 13, fontFamily: FONT, minWidth: 0 }} />
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <Search size={17} color={MUTED2} />
        </div>
      )}

      {/* Nav */}
      <nav onClickCapture={onClose ? (e) => { if (e.target.closest?.('a')) onClose(); } : undefined} style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {navItems.map(item => (item.children
          ? <Group key={item.label} item={item} collapsed={compact} badges={badges}
              open={q ? true : !!openGroups[item.label]} onToggle={() => toggleGroup(item.label)} />
          : <NavItem key={item.to} {...item} compact={compact} />))}
        {mgmtGroups.map((g) => (
          <Group key={g.label} item={g} collapsed={compact} badges={badges}
            open={q ? true : !!openGroups[g.label]} onToggle={() => toggleGroup(g.label)} />
        ))}
        {q && !navItems.length && !mgmtGroups.length && (
          <div style={{ padding: '16px 20px', fontSize: 12.5, color: MUTED2, fontFamily: FONT }}>No menu matches “{query}”.</div>
        )}
      </nav>

      {/* User */}
      <div style={{
        padding: '16px', borderTop: `1px solid rgba(255,255,255,.07)`,
        display: 'flex', flexDirection: compact ? 'column' : 'row',
        alignItems: 'center', gap: compact ? 12 : 10,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: `linear-gradient(135deg, ${AMBER}, ${AMBER}88)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: WHITE, flexShrink: 0,
        }}
        title={compact ? (user?.fullName || user?.email || '') : undefined}>
          {(user?.fullName || user?.email || 'T')[0].toUpperCase()}
        </div>
        {!compact && (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: WHITE, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.fullName || 'Instructor'}
            </div>
            <div style={{ fontSize: 11, color: MUTED2, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email || ''}
            </div>
          </div>
        )}
        <button
          onClick={logout}
          title="Sign out"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: MUTED2, padding: 4, borderRadius: 6, flexShrink: 0,
          }}
        >
          <LogOut size={16} />
        </button>
      </div>
      {/* Legal links */}
      {!compact && (
        <div style={{ padding: '10px 20px 14px', display: 'flex', gap: 12 }}>
          <a href="/privacy" style={{ fontSize: 10, color: MUTED2, textDecoration: 'none', fontFamily: FONT, transition: 'color .15s' }}
            onMouseEnter={e => e.target.style.color = '#fff'}
            onMouseLeave={e => e.target.style.color = MUTED2}>Privacy</a>
          <a href="/terms" style={{ fontSize: 10, color: MUTED2, textDecoration: 'none', fontFamily: FONT, transition: 'color .15s' }}
            onMouseEnter={e => e.target.style.color = '#fff'}
            onMouseLeave={e => e.target.style.color = MUTED2}>Terms</a>
        </div>
      )}
    </aside>
  );
}

function BellButton() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { on, off } = useInstructorSocket(user?.id);
  const [unread, setUnread] = useState(0);

  const poll = useCallback(async () => {
    try {
      const res = await apiGet('/api/notifications?limit=1');
      setUnread(res.unread ?? 0);
    } catch {}
  }, []);

  // The server already pushes a 'notification' socket event for every in-app
  // notification (notify.js), so the badge refetches on the event instead of
  // polling the API every minute.
  useEffect(() => {
    poll();
    const onFocus  = () => poll();
    const onChange = () => poll();
    const onPush   = () => poll();
    window.addEventListener('focus', onFocus);
    window.addEventListener('akoro:notifications-changed', onChange);
    on('notification', onPush);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('akoro:notifications-changed', onChange);
      off('notification', onPush);
    };
  }, [poll, on, off]);

  return (
    <button
      onClick={() => navigate('/notifications')}
      style={{
        position: 'relative', background: WHITE, border: `1.5px solid ${BORDER}`,
        borderRadius: 10, padding: '8px', cursor: 'pointer', color: MUTED,
        display: 'flex', alignItems: 'center',
      }}
    >
      <Bell size={16} />
      {unread > 0 && (
        <span style={{
          position: 'absolute', top: -4, right: -4,
          background: AMBER, color: WHITE, borderRadius: '50%',
          width: 16, height: 16, fontSize: 9, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: FONT, border: `2px solid ${WHITE}`,
        }}>
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}

export function TopBar({ title, subtitle, action, onToggleSidebar, showBell = true }) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 10,
      background: 'rgba(250,248,245,.95)', backdropFilter: 'blur(8px)',
      borderBottom: `1px solid ${BORDER}`,
      padding: '16px 28px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {/* Hamburger — collapses the sidebar to icons-only (desktop; on mobile
            the AppHeader hamburger owns the drawer) */}
        {onToggleSidebar && (
          <button onClick={onToggleSidebar} title="Toggle sidebar" style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 10, padding: '8px', cursor: 'pointer', color: INK, display: 'flex', alignItems: 'center' }}>
            <Menu size={17} />
          </button>
        )}
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: INK, margin: 0, fontFamily: FONT }}>{title}</h1>
          {subtitle && <p style={{ fontSize: 13, color: MUTED, margin: '2px 0 0', fontFamily: FONT }}>{subtitle}</p>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {action}
        {showBell && <BellButton />}
      </div>
    </div>
  );
}

export function BottomNav() {
  return (
    <div style={{
      display: 'none',
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
      background: WHITE, borderTop: `1px solid ${BORDER}`,
      padding: '8px 0 12px',
    }}
    className="bottom-nav"
    >
      {NAV.flatMap((i) => (i.children ? [{ to: i.children[0].to, icon: i.icon, label: i.label }] : [i])).map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          style={({ isActive }) => ({
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            flex: 1, textDecoration: 'none',
            color: isActive ? AMBER : MUTED,
            fontSize: 10, fontFamily: FONT, fontWeight: isActive ? 600 : 400,
          })}
        >
          <Icon size={20} />
          {label}
        </NavLink>
      ))}
    </div>
  );
}

// Phones (below 768px) get the app-shaped shell: the shared Akoro AppHeader
// (hamburger | spacer | actions | avatar menu) and full-width pages — the
// sidebar exists ONLY as a drawer the hamburger opens, closed by its X, the
// hamburger again, the backdrop, or Escape. Tablet/desktop keep the
// permanent collapsible sidebar unchanged.
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

export function PageLayout({ children, title, subtitle, action, hideTopBarOnMobile = false }) {
  const [collapsed, setCollapsed] = useState(false);
  const mobile = useIsMobile();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The page behind an open drawer stays put — lock its scroll (mobile only),
  // and never carry an open drawer back to desktop.
  useEffect(() => {
    if (!mobile) { setDrawerOpen(false); return; }
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobile, drawerOpen]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!mobile || !drawerOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobile, drawerOpen]);

  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <AppHeader
          onMenu={() => setDrawerOpen((o) => !o)}
          user={user}
          actions={[
            { key: 'chat',          icon: ReferenceChatIcon, label: 'AI Chat',      variant: 'square', onClick: () => navigate('/chat') },
            { key: 'notifications', icon: Bell,          label: 'Notifications',  variant: 'square', onClick: () => navigate('/notifications') },
            { key: 'help',          icon: MessageCircleQuestion, label: 'Help & support', variant: 'circle', onClick: () => { window.location.href = 'mailto:support@akoro.app'; } },
          ]}
          progress={setupProgressOf(user)}
          onSetup={() => navigate('/profile')}
          menuItems={[
            { key: 'profile',  label: 'Profile',  icon: UserCircle, to: '/profile' },
            { key: 'settings', label: 'Settings', icon: Settings,   to: '/settings' },
            'divider',
            { key: 'logout',   label: 'Log out',  icon: LogOut,     danger: true, onClick: logout },
          ]}
        />
        {!hideTopBarOnMobile && (
          <TopBar title={title} subtitle={subtitle} action={action} onToggleSidebar={null} showBell={false} />
        )}
        <main style={{ flex: 1, overflowY: 'auto', padding: '16px 14px' }}>
          {children}
        </main>
        {drawerOpen && (
          <div onClick={() => setDrawerOpen(false)} aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 1090, background: 'rgba(0,0,0,.45)' }} />
        )}
        <aside role="navigation" aria-label="Main menu" aria-hidden={!drawerOpen} style={{
          position: 'fixed', top: 0, left: 0, bottom: 0, width: 280, zIndex: 1100,
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
          visibility: drawerOpen ? 'visible' : 'hidden',
          transition: 'transform .22s ease, visibility .22s',
          boxShadow: drawerOpen ? '12px 0 32px rgba(0,0,0,.35)' : 'none',
        }}>
          <Sidebar collapsed={false} onClose={() => setDrawerOpen(false)} />
        </aside>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar collapsed={collapsed} />
      {/* position:relative — the containing block for full-area takeovers
          (the grading surface): they cover the WORKING AREA only, so the
          side nav stays visible and clickable behind them. */}
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar title={title} subtitle={subtitle} action={action} onToggleSidebar={() => setCollapsed((c) => !c)} />
        <main style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
