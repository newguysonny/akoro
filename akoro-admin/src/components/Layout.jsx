import { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import AkoroLogo from './common/AkoroLogo.jsx';
import { LayoutDashboard, Users, GraduationCap, BookOpen, BookMarked, LayoutTemplate, FileText, Briefcase, Bell, Settings, LogOut, BarChart2, CreditCard, Star, Tag, DollarSign, FileBarChart, Inbox, Megaphone, Building2, Bot, ChevronDown, Menu, Store, Library, Cpu, FlaskConical, Wrench, Layers, School, History, Repeat, Receipt, Ticket, RefreshCw} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { apiGet } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, FONT } from '../constants.js';

/* Collapse the sidebar to icons-only on tablet widths (769–1024px).
   Desktop (>1024px) and mobile (≤768px) are unchanged. */
function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/* Grouped, expandable nav (desktop). Top-level entries with `to` are single
   links; entries with `children` are collapsible groups. The tablet-compact
   sidebar and the mobile bottom bar use the flattened list (NAV) below. */
const NAV_GROUPS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { label: 'Insights', icon: BarChart2, children: [
    { to: '/analytics', icon: BarChart2,    label: 'Analytics' },
    { to: '/reports',   icon: FileBarChart, label: 'Reports' },
    { to: '/ai-spend',  icon: Cpu,          label: 'AI spend' },
    { to: '/evals',     icon: FlaskConical, label: 'Evals' },
    { to: '/agent-tool-requests', icon: Wrench, label: 'Agent requests' },
  ] },
  { label: 'People', icon: Users, children: [
    { to: '/users',       icon: Users,         label: 'Users' },
    { to: '/instructors', icon: GraduationCap, label: 'Instructors' },
    { to: '/schools',     icon: Building2,      label: 'Schools' },
    { to: '/pilot-schools', icon: School,       label: 'Pilot Schools' },
    { to: '/agents',      icon: Bot,            label: 'Agents' },
  ] },
  { label: 'Catalog', icon: BookOpen, children: [
    { to: '/courses',           icon: BookOpen,       label: 'Courses' },
    { to: '/syllabus',          icon: BookMarked,     label: 'Syllabus' },
    { to: '/past-questions',    icon: Library,        label: 'Past Questions' },
    { to: '/website-templates', icon: LayoutTemplate, label: 'Web Templates' },
    { to: '/app-center',        icon: Store,          label: 'App Center' },
  ] },
  { label: 'Finance', icon: CreditCard, children: [
    { to: '/billing/overview', icon: BarChart2, label: 'Billing Overview' },
    { to: '/payments', icon: CreditCard, label: 'Payments' },
    { to: '/payouts',  icon: DollarSign, label: 'Payouts' },
    { to: '/coupons',  icon: Tag,        label: 'Coupons' },
    { to: '/tiers',   icon: Layers,     label: 'Tiers & Credits' },
    { to: '/subscriptions', icon: Repeat,  label: 'Subscriptions' },
    { to: '/billing-customers', icon: Users, label: 'Customers' },
    { to: '/invoices', icon: Receipt,    label: 'Invoices' },
    { to: '/billing/coupons', icon: Ticket, label: 'Billing Coupons' },
    { to: '/billing/reconciliation', icon: RefreshCw, label: 'Reconciliation' },
  ] },
  { label: 'Engagement', icon: Megaphone, children: [
    { to: '/reviews',       icon: Star,      label: 'Reviews' },
    { to: '/marketing',     icon: Megaphone, label: 'Marketing' },
    { to: '/messages',      icon: Inbox,     label: 'Messages' },
    { to: '/notifications', icon: Bell,      label: 'Notifications' },
  ] },
  { label: 'Content', icon: FileText, children: [
    { to: '/content/blog',    icon: FileText,  label: 'Blog' },
    { to: '/content/careers', icon: Briefcase, label: 'Careers' },
  ] },
  { to: '/audit-log', icon: History, label: 'Audit Log' },
  { to: '/wallet', icon: CreditCard, label: 'Wallet & Credits' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

// Flattened destinations (compact sidebar + mobile bottom bar).
const NAV = NAV_GROUPS.flatMap((g) => (g.children ? g.children : [g]));

function Badge({ count, style }) {
  if (!count) return null;
  return (
    <span style={{
      minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
      background: '#EF4444', color: WHITE, fontSize: 10.5, fontWeight: 800,
      fontFamily: FONT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      lineHeight: 1, ...style,
    }}>{count > 99 ? '99+' : count}</span>
  );
}

function NavItem({ to, icon: Icon, label, compact, badge = 0 }) {
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
        transition: 'all .15s', position: 'relative',
      })}
    >
      <span style={{ position: 'relative', display: 'flex' }}>
        <Icon size={18} />
        {compact && <Badge count={badge} style={{ position: 'absolute', top: -7, left: 10, minWidth: 16, height: 16 }} />}
      </span>
      {!compact && <span>{label}</span>}
      {!compact && <Badge count={badge} style={{ marginLeft: 'auto' }} />}
    </NavLink>
  );
}

/* Indented child link inside an expandable group (desktop, expanded width). */
function ChildLink({ to, label, badge = 0 }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '7px 10px', borderRadius: 8,
        textDecoration: 'none', fontFamily: FONT, fontSize: 12.5,
        fontWeight: isActive ? 600 : 400,
        color: isActive ? WHITE : MUTED2,
        background: isActive ? `${AMBER}1F` : 'transparent',
        transition: 'all .15s',
      })}
    >
      <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{label}</span>
      <Badge count={badge} />
    </NavLink>
  );
}

/* Expandable group header + its children (desktop, expanded width). */
function Group({ item, open, onToggle, unread }) {
  const hasMessages = item.children.some((c) => c.to === '/messages');
  return (
    <div style={{ margin: '2px 0' }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, width: 'calc(100% - 16px)',
          padding: '10px 16px', margin: '0 8px', borderRadius: 10, border: 'none', cursor: 'pointer',
          fontFamily: FONT, fontSize: 14, textAlign: 'left',
          background: open ? 'rgba(255,255,255,.04)' : 'transparent',
          color: open ? WHITE : MUTED2, transition: 'all .15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = WHITE; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = open ? WHITE : MUTED2; }}
      >
        <item.icon size={18} />
        <span style={{ flex: 1 }}>{item.label}</span>
        {!open && hasMessages && <Badge count={unread} />}
        <ChevronDown size={14} style={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
      </button>
      {open && (
        <div style={{ margin: '2px 8px 6px', paddingLeft: 22, borderLeft: '1px solid rgba(255,255,255,.08)' }}>
          {item.children.map((c) => (
            <ChildLink key={c.to} to={c.to} label={c.label} badge={c.to === '/messages' ? unread : 0} />
          ))}
        </div>
      )}
    </div>
  );
}

// Poll the unread contact-message count for the Messages nav badge.
function useUnreadMessages() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const poll = () => apiGet('/api/contact/messages?status=new&limit=1')
      .then(r => { if (alive) setUnread(r?.unread ?? 0); })
      .catch(() => {});
    poll();
    const t = setInterval(poll, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return unread;
}

export function Sidebar({ collapsed = false }) {
  const { user, logout } = useAuth();
  const unread = useUnreadMessages();
  const { pathname } = useLocation();
  // Driven purely by the hamburger (like the school & instructor apps) so the
  // toggle always works — no viewport media query overriding it.
  const iconOnly = collapsed;

  // Which group holds the current route (so it auto-expands on load / nav).
  const activeGroup = NAV_GROUPS.find((g) => g.children?.some((c) => c.to === pathname))?.label;
  const [open, setOpen] = useState({});
  useEffect(() => { if (activeGroup) setOpen((o) => ({ ...o, [activeGroup]: true })); }, [activeGroup]);
  const toggle = (label) => setOpen((o) => ({ ...o, [label]: !o[label] }));

  return (
    <aside style={{
      width: iconOnly ? 72 : 240, flexShrink: 0, background: INK,
      display: 'flex', flexDirection: 'column',
      height: '100vh', overflow: 'hidden',
      transition: 'width .15s',
    }}>
      {/* Logo */}
      <div style={{
        padding: iconOnly ? '24px 0 16px' : '24px 20px 16px',
        borderBottom: `1px solid rgba(255,255,255,.07)`,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: iconOnly ? 'center' : 'flex-start', gap: 10,
        }}>
          <AkoroLogo size={36} radius={10} />
          {!iconOnly && (
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: WHITE, fontFamily: FONT }}>Akoro</div>
              <div style={{ fontSize: 10, color: MUTED2, fontFamily: FONT }}>Admin Portal</div>
            </div>
          )}
        </div>
      </div>

      {/* Nav — expandable groups when open, flat icon list when collapsed */}
      <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
        {iconOnly
          ? NAV.map(item => <NavItem key={item.to} {...item} compact badge={item.to === '/messages' ? unread : 0} />)
          : NAV_GROUPS.map(item => (
              item.children
                ? <Group key={item.label} item={item} open={!!open[item.label]} onToggle={() => toggle(item.label)} unread={unread} />
                : <NavItem key={item.to} {...item} badge={item.to === '/messages' ? unread : 0} />
            ))}
      </nav>

      {/* User */}
      <div style={{
        padding: '16px', borderTop: `1px solid rgba(255,255,255,.07)`,
        display: 'flex', flexDirection: iconOnly ? 'column' : 'row',
        alignItems: 'center', gap: iconOnly ? 12 : 10,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: `linear-gradient(135deg, ${AMBER}, ${AMBER}88)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: WHITE, flexShrink: 0,
        }}
        title={iconOnly ? (user?.fullName || user?.email || '') : undefined}>
          {(user?.fullName || user?.email || 'T')[0].toUpperCase()}
        </div>
        {!iconOnly && (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: WHITE, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.fullName || 'Admin'}
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
      {!iconOnly && (
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
        {onToggleSidebar && (
          <button onClick={onToggleSidebar} title="Toggle sidebar" aria-label="Toggle sidebar"
            className="sidebar-toggle"
            style={{ background: WHITE, border: `1.5px solid ${BORDER}`, borderRadius: 10, padding: '8px', cursor: 'pointer', color: INK, display: 'flex', alignItems: 'center' }}>
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
        <BellButton />
      </div>
    </div>
  );
}

export function BottomNav() {
  const unread = useUnreadMessages();
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
          <span style={{ position: 'relative', display: 'flex' }}>
            <Icon size={20} />
            {to === '/messages' && <Badge count={unread} style={{ position: 'absolute', top: -6, left: 12, minWidth: 15, height: 15 }} />}
          </span>
          {label}
        </NavLink>
      ))}
    </div>
  );
}

const COLLAPSE_KEY = 'akoro_admin_sidebar_collapsed';

export function PageLayout({ children, title, subtitle, action }) {
  // User-controlled collapse (hamburger), remembered across page loads.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const toggleSidebar = () => setCollapsed((c) => {
    const next = !c;
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar collapsed={collapsed} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar title={title} subtitle={subtitle} action={action} onToggleSidebar={toggleSidebar} />
        <main style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
