import { useState, useEffect, useCallback, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import AkoroLogo from './common/AkoroLogo.jsx';
import {LayoutDashboard, Users, GraduationCap, BookOpen, BookMarked, LayoutTemplate, FileText, Briefcase, Bell, Settings, LogOut, BarChart2, CreditCard, Star, Tag, DollarSign, FileBarChart, Inbox, Megaphone, Building2, Bot, ChevronDown, Menu, Store, Library, Cpu, FlaskConical, Wrench, Layers, School, History, Repeat, Receipt, Ticket, RefreshCw, X, Home, BookCopy, FolderOpen, ClipboardCheck, ShieldCheck, Search, Eye, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import AppHeader from './AppHeader.jsx';

/* Setup progress for the header ring — a fraction of the profile that is
   actually filled in (plus an app-specific extra, e.g. a created business).
   Derived from real data; never a hard-coded number. */
const setupProgressOf = (u, extra = null) =>
  [u?.fullName || u?.name, u?.email, u?.phone, extra].filter(Boolean).length / 4;

import { apiGet } from '../services/api.js';
import { WHITE, FONT } from '../constants.js';

/* bachs design tokens (local — section-by-section rollout, do not touch globals) */
const BX = {
  primary: '#4A5CD5',
  primaryDark: '#3E4FC4',
  ink: '#1A1B25',
  muted: '#6B7280',
  line: '#E8E8EE',
  sideBg: '#F7F7F9',
  white: '#FFFFFF',
  red: '#DC2626',
  font: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

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
   links; entries with `children` are collapsible groups. */
const NAV_GROUPS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { label: 'Insights', icon: BarChart2, children: [
    { to: '/analytics', icon: BarChart2,    label: 'Analytics' },
    { to: '/reports',   icon: FileBarChart, label: 'Reports' },
    { to: '/ai-spend',  icon: Cpu,          label: 'AI spend' },
    { to: '/evals',     icon: FlaskConical, label: 'Evals' },
    { to: '/agent-tool-requests', icon: Wrench, label: 'Agent requests' },
    { to: '/real-account-checks', icon: ShieldCheck, label: 'Real-account checks' },
  ] },
  { label: 'Agent capabilities', icon: Bot, children: [
    { to: '/agent-capabilities/tools',         icon: Layers,   label: 'Agent tools' },
    { to: '/agent-capabilities/learner-tools', icon: Wrench,   label: 'Learners’ tools' },
    { to: '/agent-capabilities/features',      icon: Sparkles, label: 'Agent features' },
  ] },
  { label: 'People', icon: Users, children: [
    { to: '/users',       icon: Users,         label: 'Users' },
    { to: '/instructors', icon: GraduationCap, label: 'Instructors' },
    { to: '/schools',     icon: Building2,      label: 'Schools' },
    { to: '/pilot-schools', icon: School,       label: 'Pilot Schools' },
    { to: '/agents',      icon: Bot,            label: 'Agents' },
  ] },
  { label: 'Program Courses', icon: Layers, children: [
    { to: '/program-courses',          icon: Home,       label: 'Overview', end: true },
    { to: '/program-courses/programs', icon: Layers,     label: 'Programs' },
    { to: '/program-courses/courses',  icon: BookCopy,   label: 'Courses' },
    { to: '/program-courses/contents', icon: FolderOpen, label: 'Contents' },
  ] },
  { label: 'Catalog', icon: BookOpen, children: [
    { to: '/courses',           icon: BookOpen,       label: 'Courses' },
    { to: '/course-approvals',  icon: ClipboardCheck, label: 'Course Approvals' },
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

// Flattened destinations (compact sidebar).
const NAV = NAV_GROUPS.flatMap((g) => (g.children ? g.children : [g]));

function Badge({ count, style }) {
  if (!count) return null;
  return (
    <span style={{
      minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
      background: '#EF4444', color: WHITE, fontSize: 10.5, fontWeight: 800,
      fontFamily: BX.font, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      lineHeight: 1, ...style,
    }}>{count > 99 ? '99+' : count}</span>
  );
}

const NAV_ITEM = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '8px 12px', borderRadius: 8, margin: '1px 8px',
  textDecoration: 'none', fontFamily: BX.font, fontSize: 13, fontWeight: 500,
  transition: 'background .12s, color .12s', position: 'relative',
};

function NavItem({ to, icon: Icon, label, compact, badge = 0 }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      title={compact ? label : undefined}
      style={({ isActive }) => ({
        ...NAV_ITEM,
        gap: compact ? 0 : 10,
        justifyContent: compact ? 'center' : 'flex-start',
        padding: compact ? '10px 0' : '8px 12px',
        color: isActive ? BX.primary : '#3F4354',
        background: isActive ? `${BX.primary}12` : 'transparent',
        fontWeight: isActive ? 600 : 500,
      })}
    >
      <span style={{ position: 'relative', display: 'flex' }}>
        <Icon size={15} strokeWidth={1.8} />
        {compact && <Badge count={badge} style={{ position: 'absolute', top: -7, left: 10, minWidth: 16, height: 16 }} />}
      </span>
      {!compact && <span>{label}</span>}
      {!compact && <Badge count={badge} style={{ marginLeft: 'auto' }} />}
    </NavLink>
  );
}

/* Indented child link inside an expandable group. */
function ChildLink({ to, label, badge = 0, end = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderRadius: 7,
        textDecoration: 'none', fontFamily: BX.font, fontSize: 12.5,
        fontWeight: isActive ? 600 : 400,
        color: isActive ? BX.primary : BX.muted,
        background: isActive ? `${BX.primary}0F` : 'transparent',
        transition: 'all .12s',
      })}
    >
      {({ isActive }) => (
        <>
          <span style={{
            width: 3, borderRadius: 2, alignSelf: 'stretch', flexShrink: 0,
            background: isActive ? BX.primary : 'transparent',
          }} />
          <span style={{ flex: 1 }}>{label}</span>
          <Badge count={badge} />
        </>
      )}
    </NavLink>
  );
}

/* Expandable group header + its children. */
function Group({ item, open, onToggle, unread }) {
  const hasMessages = item.children.some((c) => c.to === '/messages');
  return (
    <div style={{ margin: '1px 0' }}>
      <button
        onClick={onToggle}
        style={{
          ...NAV_ITEM, width: 'calc(100% - 16px)', border: 'none', cursor: 'pointer',
          textAlign: 'left', color: open ? BX.ink : '#3F4354',
          background: open ? '#EFEFEF' : 'transparent',
        }}
      >
        <item.icon size={15} strokeWidth={1.8} />
        <span style={{ flex: 1 }}>{item.label}</span>
        {!open && hasMessages && <Badge count={unread} />}
        <ChevronDown size={13} style={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0, color: BX.muted }} />
      </button>
      {open && (
        <div style={{ margin: '2px 8px 4px 20px', paddingLeft: 12, borderLeft: `1px solid ${BX.line}` }}>
          {item.children.map((c) => (
            <ChildLink key={c.to} to={c.to} label={c.label} badge={c.to === '/messages' ? unread : 0} end={c.end} />
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

export function Sidebar({ collapsed = false, onClose }) {
  const { user, logout } = useAuth();
  const unread = useUnreadMessages();
  const { pathname } = useLocation();
  const iconOnly = collapsed;
  const [flyout, setFlyout] = useState(null); // label of group with open flyout
  const flyoutRef = useRef(null);

  const activeGroup = NAV_GROUPS.find((g) => g.children?.some((c) => c.to === pathname))?.label;
  const [open, setOpen] = useState({});
  useEffect(() => { if (activeGroup) setOpen((o) => ({ ...o, [activeGroup]: true })); }, [activeGroup]);
  const toggle = (label) => setOpen((o) => ({ ...o, [label]: !o[label] }));

  // Close flyout on outside click / Escape, and when expanding the sidebar
  useEffect(() => {
    if (!flyout) return;
    const onDoc = (e) => { if (flyoutRef.current && !flyoutRef.current.contains(e.target)) setFlyout(null); };
    const onKey = (e) => { if (e.key === 'Escape') setFlyout(null); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [flyout]);
  useEffect(() => { if (!iconOnly) setFlyout(null); }, [iconOnly]);

  const openFlyout = (label, anchorEl) => {
    setFlyout(flyout === label ? null : label);
    // position next to the clicked icon
    requestAnimationFrame(() => {
      const el = flyoutRef.current;
      if (!el || !anchorEl) return;
      const r = anchorEl.getBoundingClientRect();
      el.style.left = `${r.right + 8}px`;
      el.style.top = `${Math.min(r.top, window.innerHeight - el.offsetHeight - 16)}px`;
    });
  };

  const flyoutGroup = NAV_GROUPS.find((g) => g.label === flyout);

  return (
    <aside style={{
      width: iconOnly ? 68 : 224, flexShrink: 0, background: BX.sideBg,
      borderRight: `1px solid ${BX.line}`,
      display: 'flex', flexDirection: 'column',
      height: '100vh', overflow: 'hidden',
      transition: 'width .15s', fontFamily: BX.font,
    }}>
      {/* Brand */}
      <div style={{
        padding: iconOnly ? '20px 0 14px' : '18px 16px 14px',
        borderBottom: `1px solid ${BX.line}`,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: iconOnly ? 'center' : 'flex-start', gap: 10,
        }}>
          <AkoroLogo size={32} radius={8} />
          {!iconOnly && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: BX.ink, fontFamily: BX.font, letterSpacing: '-0.01em' }}>Akoro</div>
              <div style={{ fontSize: 10.5, color: BX.muted, fontFamily: BX.font }}>Admin Portal</div>
            </div>
          )}
          {onClose && (
            <button onClick={onClose} aria-label="Close menu" title="Close menu"
              style={{ marginLeft: 'auto', width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: BX.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Nav — expandable groups when open, icon rail with flyouts when collapsed */}
      <nav onClickCapture={onClose ? (e) => { if (e.target.closest?.('a')) onClose(); } : undefined}
        style={{ flex: 1, padding: '10px 0', overflowY: 'auto' }}>
        {iconOnly
          ? NAV_GROUPS.map(item => (
              item.children
                ? (
                  <button key={item.label}
                    onClick={(e) => openFlyout(item.label, e.currentTarget)}
                    title={item.label}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 'calc(100% - 20px)', padding: '10px 0', margin: '1px 10px',
                      borderRadius: 8, border: 'none', cursor: 'pointer',
                      color: flyout === item.label ? BX.primary : '#3F4354',
                      background: flyout === item.label ? `${BX.primary}12` : 'transparent',
                      fontFamily: BX.font,
                    }}>
                    <item.icon size={18} strokeWidth={1.8} />
                  </button>
                )
                : <NavItem key={item.to} {...item} compact badge={item.to === '/messages' ? unread : 0} />
            ))
          : NAV_GROUPS.map(item => (
              item.children
                ? <Group key={item.label} item={item} open={!!open[item.label]} onToggle={() => toggle(item.label)} unread={unread} />
                : <NavItem key={item.to} {...item} badge={item.to === '/messages' ? unread : 0} />
            ))}
      </nav>

      {/* Collapsed flyout */}
      {iconOnly && flyoutGroup?.children && (
        <div ref={flyoutRef} style={{
          position: 'fixed', zIndex: 200, minWidth: 210,
          background: BX.white, border: `1px solid ${BX.line}`, borderRadius: 10,
          boxShadow: '0 12px 32px rgba(20,20,40,.14)', padding: 6, fontFamily: BX.font,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: BX.muted, textTransform: 'uppercase',
            letterSpacing: '.05em', padding: '8px 10px 4px',
          }}>{flyoutGroup.label}</div>
          {flyoutGroup.children.map((c) => (
            <NavLink key={c.to} to={c.to} end={c.end}
              onClick={() => setFlyout(null)}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', borderRadius: 7, textDecoration: 'none',
                fontFamily: BX.font, fontSize: 13, fontWeight: isActive ? 600 : 500,
                color: isActive ? BX.primary : BX.ink,
                background: isActive ? `${BX.primary}0F` : 'transparent',
              })}>
              <span style={{ flex: 1 }}>{c.label}</span>
              {c.to === '/messages' && <Badge count={unread} />}
            </NavLink>
          ))}
        </div>
      )}

      {/* User */}
      <div style={{
        padding: '12px 14px', borderTop: `1px solid ${BX.line}`,
        display: 'flex', flexDirection: iconOnly ? 'column' : 'row',
        alignItems: 'center', gap: iconOnly ? 10 : 10,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: BX.primary, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, flexShrink: 0, fontFamily: BX.font,
        }}
        title={iconOnly ? (user?.fullName || user?.email || '') : undefined}>
          {(user?.fullName || user?.email || 'A')[0].toUpperCase()}
        </div>
        {!iconOnly && (
          <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: BX.ink, fontFamily: BX.font, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.fullName || 'Admin'}
            </div>
            <div style={{ fontSize: 11, color: BX.muted, fontFamily: BX.font, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email || ''}
            </div>
          </div>
        )}
        <button onClick={logout} title="Sign out"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: BX.muted, padding: 4, borderRadius: 6, flexShrink: 0, display: 'flex' }}>
          <LogOut size={15} />
        </button>
      </div>
      {!iconOnly && (
        <div style={{ padding: '8px 16px 12px', display: 'flex', gap: 12 }}>
          <a href="/privacy" style={{ fontSize: 10.5, color: BX.muted, textDecoration: 'none', fontFamily: BX.font }}>Privacy</a>
          <a href="/terms" style={{ fontSize: 10.5, color: BX.muted, textDecoration: 'none', fontFamily: BX.font }}>Terms</a>
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
    <button onClick={() => navigate('/notifications')} title="Notifications"
      style={{
        position: 'relative', background: 'none', border: 'none',
        borderRadius: 8, padding: 7, cursor: 'pointer', color: '#3F4354',
        display: 'flex', alignItems: 'center',
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#F1F1F5'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      <Bell size={16} strokeWidth={1.8} />
      {unread > 0 && (
        <span style={{
          position: 'absolute', top: 4, right: 4,
          background: '#EF4444', color: WHITE, borderRadius: '50%',
          width: 7, height: 7, border: `1.5px solid ${BX.white}`,
        }} />
      )}
    </button>
  );
}

/* Avatar + account dropdown (desktop header). Items mirror AppHeader's mobile menu. */
function AvatarMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open ]);

  const item = {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    border: 'none', background: 'none', fontFamily: BX.font, fontSize: 13, fontWeight: 500,
    color: BX.ink, padding: '9px 10px', borderRadius: 7, cursor: 'pointer', textAlign: 'left',
  };

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <div onClick={() => setOpen(o => !o)} role="button" tabIndex={0} aria-label="Account menu"
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
        style={{
          width: 30, height: 30, borderRadius: '50%', background: BX.primary, color: '#fff',
          fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontFamily: BX.font,
        }}>
        {(user?.fullName || user?.email || 'A')[0].toUpperCase()}
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, minWidth: 200,
          background: BX.white, border: `1px solid ${BX.line}`, borderRadius: 10,
          boxShadow: '0 12px 32px rgba(20,20,40,.14)', padding: 6, zIndex: 60, fontFamily: BX.font,
        }}>
          <button style={item} onClick={() => { setOpen(false); navigate('/settings'); }}
            onMouseEnter={e => e.currentTarget.style.background = BX.sideBg}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            <Settings size={15} style={{ color: BX.muted }} /> All Settings
          </button>
          <button style={item} onClick={() => { setOpen(false); navigate('/wallet'); }}
            onMouseEnter={e => e.currentTarget.style.background = BX.sideBg}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            <CreditCard size={15} style={{ color: BX.muted }} /> Wallet
          </button>
          <div style={{ height: 1, background: '#F1F1F5', margin: '5px 4px' }} />
          <button style={{ ...item, color: BX.red }} onClick={() => { setOpen(false); logout(); }}
            onMouseEnter={e => e.currentTarget.style.background = '#FDECEC'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            <LogOut size={15} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

/* bachs app header — shared across all pages (desktop/tablet). */
export function TopBar({ onToggleSidebar }) {
  const [q, setQ] = useState('');
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 20,
      background: 'rgba(255,255,255,.96)',
      borderBottom: `1px solid ${BX.line}`,
      padding: '10px 20px',
      display: 'flex', alignItems: 'center', gap: 10, fontFamily: BX.font,
    }}>
      {onToggleSidebar && (
        <button onClick={onToggleSidebar} title="Toggle sidebar" aria-label="Toggle sidebar"
          style={{ border: 'none', background: 'none', borderRadius: 8, padding: 7, cursor: 'pointer', color: BX.ink, display: 'flex', alignItems: 'center' }}
          onMouseEnter={e => e.currentTarget.style.background = '#F1F1F5'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}>
          <Menu size={18} strokeWidth={1.8} />
        </button>
      )}
      <button
        onClick={() => {}}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          border: `1px solid ${BX.line}`, background: BX.white, borderRadius: 999,
          padding: '7px 14px', fontFamily: BX.font, fontSize: 12.5, fontWeight: 500,
          color: BX.ink, cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
        <span style={{ width: 13, height: 13, border: `1.5px solid ${BX.muted}`, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: BX.muted }}>i</span>
        Get started
      </button>
      <div className="bx-search" style={{
        display: 'flex', alignItems: 'center', gap: 8,
        border: `1px solid ${BX.line}`, borderRadius: 8, padding: '7px 10px',
        color: BX.muted, fontSize: 12.5, minWidth: 220, cursor: 'pointer', background: BX.white,
      }}>
        <Search size={14} />
        <span>Search</span>
        <kbd style={{
          marginLeft: 'auto', fontFamily: BX.font, fontSize: 11, fontWeight: 500,
          background: BX.sideBg, border: `1px solid ${BX.line}`, borderRadius: 5,
          padding: '1px 6px', color: BX.muted,
        }}>Ctrl K</kbd>
      </div>
      <div style={{ flex: 1 }} />
      <button className="bx-search-mob" title="Search"
        style={{ border: 'none', background: 'none', borderRadius: 8, padding: 7, cursor: 'pointer', color: '#3F4354', display: 'none', alignItems: 'center' }}>
        <Search size={16} strokeWidth={1.8} />
      </button>
      <button title="Preview"
        style={{ border: 'none', background: 'none', borderRadius: 8, padding: 7, cursor: 'pointer', color: '#3F4354', display: 'flex', alignItems: 'center' }}
        onMouseEnter={e => e.currentTarget.style.background = '#F1F1F5'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}>
        <Eye size={16} strokeWidth={1.8} />
      </button>
      <BellButton />
      <button
        onClick={() => { window.location.href = 'mailto:support@akoro.app'; }}
        style={{
          border: `1px solid ${BX.line}`, background: BX.white, borderRadius: 8,
          padding: '7px 14px', fontFamily: BX.font, fontSize: 12.5, fontWeight: 500,
          color: BX.ink, cursor: 'pointer', whiteSpace: 'nowrap',
        }}
        className="bx-feedback">
        Feedback
      </button>
      <AvatarMenu />
      <style>{`
        @media (max-width: 900px) {
          .bx-search { display: none !important; }
          .bx-search-mob { display: flex !important; }
          .bx-feedback { display: none !important; }
        }
      `}</style>
    </div>
  );
}

export function BottomNav() {
  // Mobile uses the hamburger drawer (per product decision); bottom nav retired.
  return null;
}

const COLLAPSE_KEY = 'akoro_admin_sidebar_collapsed';

// Phones (below 768px) get the app-shaped shell: the shared Akoro AppHeader
// (hamburger | spacer | actions | avatar menu) and full-width pages — the
// sidebar exists ONLY as a drawer the hamburger opens, closed by its X, the
// hamburger again, the backdrop, or Escape. Tablet/desktop keep the
// permanent collapsible sidebar unchanged.
const MOBILE_QUERY = '(max-width: 767px)';
function useIsMobile() {
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

export function PageLayout({ children, title, subtitle, action, contentMaxWidth = 1100 }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const toggleSidebar = () => setCollapsed((c) => {
    const next = !c;
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });
  const mobile = useIsMobile();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!mobile) { setDrawerOpen(false); return; }
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobile, drawerOpen]);

  useEffect(() => {
    if (!mobile || !drawerOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobile, drawerOpen]);

  const pageHead = (title || subtitle || action) ? (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, flexWrap: 'wrap', marginBottom: 18, fontFamily: BX.font,
    }}>
      <div>
        {title && <h1 style={{ fontSize: 20, fontWeight: 600, color: BX.ink, margin: 0, letterSpacing: '-0.01em' }}>{title}</h1>}
        {subtitle && <div style={{ fontSize: 12.5, color: BX.muted, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {action && <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{action}</div>}
    </div>
  ) : null;

  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', fontFamily: BX.font, background: BX.white }}>
        <AppHeader
          onMenu={() => setDrawerOpen((o) => !o)}
          user={user}
          actions={[
            { key: 'search',        icon: Search,   label: 'Search',        variant: 'square', onClick: () => {} },
            { key: 'preview',       icon: Eye,      label: 'Preview',       variant: 'square', onClick: () => {} },
            { key: 'notifications', icon: Bell,     label: 'Notifications', variant: 'square', onClick: () => navigate('/notifications') },
          ]}
          progress={setupProgressOf(user)}
          onSetup={() => navigate('/settings')}
          menuItems={[
            { key: 'settings', label: 'All Settings', icon: Settings,  to: '/settings' },
            { key: 'wallet',   label: 'Wallet',       icon: CreditCard, to: '/wallet' },
            'divider',
            { key: 'logout',   label: 'Log out',      icon: LogOut,    danger: true, onClick: logout },
          ]}
        />
        <main style={{ flex: 1, overflowY: 'auto', padding: '16px 14px' }}>
          <div style={{ maxWidth: contentMaxWidth, margin: '0 auto' }}>
            {pageHead}
            {children}
          </div>
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
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: BX.font, background: BX.white }}>
      <style>{`
        /* When sidebar is collapsed, let Program Courses use the freed width (all viewports) */
        .bx-main[data-collapsed="true"] .pcroot { max-width: 1000px; }
      `}</style>
      <Sidebar collapsed={collapsed} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <TopBar onToggleSidebar={toggleSidebar} />
        <main className="bx-main" data-collapsed={collapsed ? 'true' : 'false'}
          style={{ flex: 1, overflowY: 'auto', padding: collapsed ? '24px 20px' : '24px 28px' }}>
          <div style={{ maxWidth: collapsed ? 1200 : contentMaxWidth, margin: '0 auto' }}>
            {pageHead}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
