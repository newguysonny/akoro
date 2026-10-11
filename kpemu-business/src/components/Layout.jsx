/**
 * Layout.jsx — sidebar + top bar shell, mirroring the instructor app's
 * PageLayout pattern (Sidebar | TopBar+content), scaled down to this app's
 * page count.
 */
import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, KeyRound, Percent, Wallet, ClipboardList, Settings, LogOut, Building2, Ticket, FileText, ChevronsUpDown, Check, Plus, Settings2, PackageSearch, Webhook, X, MessageCircleQuestion } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { INK, MUTED, MUTED2, BORDER, WHITE, ACCENT, FONT } from '../constants.js';
import AppHeader from './AppHeader.jsx';

const NAV = [
  { to: '/',              icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/api-keys',      icon: KeyRound,        label: 'API Keys' },
  { to: '/docs',          icon: FileText,        label: 'API Docs' },
  { to: '/webhooks',      icon: Webhook,         label: 'Webhooks' },
  { to: '/products',      icon: PackageSearch,   label: 'Voucher Products' },
  { to: '/discounts',     icon: Percent,         label: 'Discount Tiers' },
  { to: '/generated',     icon: Ticket,          label: 'Vouchers Generated' },
  { to: '/wallet',        icon: Wallet,          label: 'Balance & Withdraw' },
  { to: '/redemptions',   icon: ClipboardList,   label: 'Redemptions' },
  { to: '/settings',      icon: Settings,        label: 'Settings' },
];

// ── Responsive shell ──────────────────────────────────────────────────────
// PHONES (below 768px) get the app-shaped shell: a full-width header carries
// the hamburger (the ONLY way the sidebar opens), the brand, the username
// and Sign out — so pages get the whole viewport width. The sidebar itself
// becomes a drawer with its own close (X) button, also closed by the
// backdrop, a nav tap, or Escape. TABLETS AND DESKTOP (768px+) share the
// permanent sidebar + content shell unchanged — a tablet is wide enough
// for both columns.
const MOBILE = '(max-width: 767px)';

function useIsMobile() {
  const [mobile, setMobile] = useState(() => {
    try { return window.matchMedia(MOBILE).matches; } catch { return false; }
  });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia(MOBILE); } catch { return; }
    const onChange = (e) => setMobile(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return mobile;
}

// The mobile app header is now the shared Akoro AppHeader (see AppHeader.jsx):
// hamburger | spacer | help | avatar menu — the old dark bar (username +
// Sign out inline) is gone; those live in the account menu.

function BusinessSwitcher({ onNavigate }) {
  const navigate = useNavigate();
  const { startups, current, setCurrentId } = useStartup();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Always render — even with zero businesses. Previously this returned
  // null when the list was empty, which meant a fresh account (or one
  // whose only business was just deleted) landed on /create-startup with
  // NO sidebar at all and no way to reach "Manage businesses" to see or
  // delete anything.
  const hasStartups = (startups?.length || 0) > 0;

  return (
    <div ref={ref} style={{ position: 'relative', padding: '14px 14px 6px' }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        padding: '9px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,.12)',
        background: 'rgba(255,255,255,.05)', color: '#fff', fontSize: 12.5, fontWeight: 700,
        fontFamily: FONT, cursor: 'pointer',
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current?.name || 'Select business'}</span>
        <ChevronsUpDown size={14} style={{ flexShrink: 0, opacity: .7 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 14, right: 14, marginTop: 6, zIndex: 20,
          background: '#1A1C22', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12,
          boxShadow: '0 12px 28px rgba(0,0,0,.4)', padding: 6, fontFamily: FONT,
        }}>
          {hasStartups ? (
            <>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: .5, padding: '6px 8px' }}>Businesses</div>
              {startups.map((s) => (
                <button key={s.id} onClick={() => { setCurrentId(s.id); setOpen(false); onNavigate?.(); }} style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  padding: '8px 9px', borderRadius: 8, border: 'none', background: s.id === current?.id ? 'rgba(255,255,255,.08)' : 'transparent',
                  color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                  {s.id === current?.id && <Check size={14} style={{ flexShrink: 0, color: ACCENT }} />}
                </button>
              ))}
              <div style={{ height: 1, background: 'rgba(255,255,255,.08)', margin: '6px 2px' }} />
            </>
          ) : (
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.5)', padding: '6px 8px 10px' }}>No businesses yet.</div>
          )}
          <button onClick={() => { setOpen(false); onNavigate?.(); navigate('/create-startup'); }} style={dropdownActionBtn}>
            <Plus size={14} /> Create new business
          </button>
          <button onClick={() => { setOpen(false); onNavigate?.(); navigate('/manage-businesses'); }} style={dropdownActionBtn}>
            <Settings2 size={14} /> Manage businesses
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ mobile = false, open = false, onClose }) {
  const { logout, user } = useAuth();

  // Escape closes the drawer — the same affordance as the backdrop tap.
  useEffect(() => {
    if (!mobile || !open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobile, open, onClose]);

  // Shared chrome: brand, business switcher, nav. On mobile every
  // navigating action inside also closes the drawer, and the brand row
  // carries the drawer's own X close button.
  const inner = (
    <>
      <div style={{ padding: '20px 18px', display: 'flex', alignItems: 'center', gap: 9, borderBottom: '1px solid rgba(255,255,255,.06)' }}>
        <img src="/kpemu-mark.svg" alt="Kpemu" width={24} height={24} />
        <span style={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>Kpemu Business</span>
        {mobile && (
          <button onClick={onClose} aria-label="Close menu" title="Close menu" style={{
            marginLeft: 'auto', width: 34, height: 34, borderRadius: 9,
            border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0,
          }}>
            <X size={16} />
          </button>
        )}
      </div>

      <BusinessSwitcher onNavigate={mobile ? onClose : null} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'} onClick={mobile ? onClose : undefined}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 10, marginBottom: 2,
              textDecoration: 'none', fontSize: 13, fontWeight: 700, fontFamily: FONT,
              color: isActive ? '#fff' : 'rgba(255,255,255,.6)',
              background: isActive ? `${ACCENT}33` : 'transparent',
            })}>
            <Icon size={16} /> {label}
          </NavLink>
        ))}
      </div>
    </>
  );

  // ── Mobile: drawer ──────────────────────────────────────────────────
  // Opens ONLY on the hamburger (open=false until then); closes on the
  // backdrop, a nav/business tap, or Escape. Username + Sign out are NOT
  // in here on mobile — they live in the app header.
  if (mobile) {
    return (
      <>
        {open && (
          <div onClick={onClose} aria-hidden="true" style={{
            position: 'fixed', inset: 0, zIndex: 1090, background: 'rgba(0,0,0,.45)',
          }} />
        )}
        <aside role="navigation" aria-label="Main menu" aria-hidden={!open} style={{
          position: 'fixed', top: 0, left: 0, bottom: 0, width: 272, zIndex: 1100,
          background: '#0F1115', display: 'flex', flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          visibility: open ? 'visible' : 'hidden',
          transition: 'transform .22s ease, visibility .22s',
          boxShadow: open ? '12px 0 32px rgba(0,0,0,.35)' : 'none',
        }}>
          {inner}
        </aside>
      </>
    );
  }

  // ── Desktop: the permanent column, unchanged ─────────────────────────
  return (
    <div style={{ width: 232, flexShrink: 0, background: '#0F1115', display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {inner}
      <div style={{ padding: 14, borderTop: '1px solid rgba(255,255,255,.06)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.75)', marginBottom: 8 }}>{user?.fullName || user?.email}</div>
        <button onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 10px', borderRadius: 9, border: 'none', background: 'rgba(255,255,255,.06)', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  );
}

const dropdownActionBtn = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 9px', borderRadius: 8,
  border: 'none', background: 'transparent', color: 'rgba(255,255,255,.75)', fontSize: 12.5, fontWeight: 600,
  cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
};

export function PageLayout({ title, subtitle, action, children }) {
  const { startups, loading, error } = useStartup();
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  // /manage-businesses stays reachable at zero businesses too — otherwise
  // deleting your only business (or a fresh account before creating one)
  // makes the one page that could show/create/delete businesses itself
  // unreachable, bouncing back to /create-startup before it can render.
  const EXEMPT_PATHS = ['/create-startup', '/manage-businesses'];
  // Belt-and-braces. Three independent conditions must ALL hold before we
  // send someone to onboarding, because getting this wrong strands them:
  //   loading   — a fetch is in flight (or belongs to a previous auth state)
  //   error     — a failed fetch must not look like "zero businesses"
  //   !== null  — [] set by the pre-login branch is NOT proof of zero
  //               businesses; only a completed fetch is.
  const needsOnboarding =
    !loading && !error &&
    Array.isArray(startups) && startups.length === 0 &&
    !EXEMPT_PATHS.includes(window.location.pathname);

  useEffect(() => { if (needsOnboarding) navigate('/create-startup', { replace: true }); }, [needsOnboarding, navigate]);

  // The page behind an open drawer stays put — lock its scroll while the
  // menu is open (mobile only), and never carry an open drawer across a
  // resize back to desktop. (Before the onboarding early-return: hooks
  // must run identically on every render.)
  useEffect(() => {
    if (!mobile) { setMenuOpen(false); return; }
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobile, menuOpen]);

  if (needsOnboarding) return null;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: FONT }}>
      <Sidebar mobile={mobile} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {mobile && (
          <AppHeader
            onMenu={() => setMenuOpen(true)}
            user={user}
            actions={[
              { key: 'help', icon: MessageCircleQuestion, label: 'Help & API docs', variant: 'circle', onClick: () => navigate('/docs') },
            ]}
            menuItems={[
              { key: 'settings', label: 'All Settings', icon: Settings, to: '/settings' },
              { key: 'docs',     label: 'API Docs',     icon: FileText,  to: '/docs' },
              'divider',
              { key: 'logout',   label: 'Log out',      icon: LogOut,    danger: true, onClick: logout },
            ]}
          />
        )}
        <div style={{ padding: mobile ? '14px 16px' : '18px 26px', borderBottom: `1px solid ${BORDER}`, background: WHITE, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: INK }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{subtitle}</div>}
          </div>
          {action}
        </div>
        <main style={{ flex: 1, overflowY: 'auto', padding: mobile ? '16px 14px' : '24px 26px', background: '#FAFAFB' }}>{children}</main>
      </div>
    </div>
  );
}
