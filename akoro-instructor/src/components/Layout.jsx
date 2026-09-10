import { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import AkoroLogo from './common/AkoroLogo.jsx';
import { Home, BookOpen, Users, Swords, MessageSquare, CheckSquare, LogOut, Bell, Settings, UserCircle, ShieldCheck, Store, Library, LayoutGrid, FileText, ClipboardList, ClipboardCheck, ListChecks, BookMarked, CalendarDays, CalendarClock, GraduationCap, Menu, Search, ChevronDown, Wallet, BookOpenCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { apiGet } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, FONT } from '../constants.js';

const NAV = [
  { to: '/',         icon: Home,          label: 'Home' },
  { to: '/courses',  icon: BookOpen,      label: 'Courses' },
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

/* Poll the pending join-request count for the nav badge. */
function useJoinRequestCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const poll = () => apiGet('/api/profiles/teacher/join-requests')
      .then((r) => { if (alive) setCount((r?.data || []).length); })
      .catch(() => {});
    poll();
    const t = setInterval(poll, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);
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
            <NavLink key={c.label} to={c.to} end={c.to === '/'}
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

export function Sidebar({ collapsed = false }) {
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
  const navItems   = q ? NAV.filter((i) => i.label.toLowerCase().includes(q)) : NAV;
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
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {navItems.map(item => <NavItem key={item.to} {...item} compact={compact} />)}
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
  const [unread, setUnread] = useState(0);

  const poll = useCallback(async () => {
    try {
      const res = await apiGet('/api/notifications?limit=1');
      setUnread(res.unread ?? 0);
    } catch {}
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 60_000);
    const onFocus  = () => poll();
    const onChange = () => poll();
    window.addEventListener('focus', onFocus);
    window.addEventListener('akoro:notifications-changed', onChange);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('akoro:notifications-changed', onChange);
    };
  }, [poll]);

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

export function TopBar({ title, subtitle, action, onToggleSidebar }) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 10,
      background: 'rgba(250,248,245,.95)', backdropFilter: 'blur(8px)',
      borderBottom: `1px solid ${BORDER}`,
      padding: '16px 28px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {/* Hamburger — collapses the sidebar to icons-only */}
        <button onClick={onToggleSidebar} title="Toggle sidebar" style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 10, padding: '8px', cursor: 'pointer', color: INK, display: 'flex', alignItems: 'center' }}>
          <Menu size={17} />
        </button>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: INK, margin: 0, fontFamily: FONT }}>{title}</h1>
          {subtitle && <p style={{ fontSize: 13, color: MUTED, margin: '2px 0 0', fontFamily: FONT }}>{subtitle}</p>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {action}
        <BellButton />
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
      {NAV.map(({ to, icon: Icon, label }) => (
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

export function PageLayout({ children, title, subtitle, action }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar collapsed={collapsed} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar title={title} subtitle={subtitle} action={action} onToggleSidebar={() => setCollapsed((c) => !c)} />
        <main style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
