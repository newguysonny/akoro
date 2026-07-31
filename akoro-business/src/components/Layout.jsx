/**
 * Layout.jsx — sidebar + top bar shell, mirroring the instructor app's
 * PageLayout pattern (Sidebar | TopBar+content), scaled down to this app's
 * page count.
 */
import { useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, KeyRound, Percent, Wallet, ClipboardList, Settings, LogOut, Building2, Ticket, FileText } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { INK, MUTED, MUTED2, BORDER, WHITE, ACCENT, FONT } from '../constants.js';

const NAV = [
  { to: '/',              icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/api-keys',      icon: KeyRound,        label: 'API Keys' },
  { to: '/docs',          icon: FileText,        label: 'API Docs' },
  { to: '/discounts',     icon: Percent,         label: 'Discount Tiers' },
  { to: '/generated',     icon: Ticket,          label: 'Vouchers Generated' },
  { to: '/wallet',        icon: Wallet,          label: 'Balance & Withdraw' },
  { to: '/redemptions',   icon: ClipboardList,   label: 'Redemptions' },
  { to: '/settings',      icon: Settings,        label: 'Settings' },
];

export function Sidebar() {
  const { logout, user } = useAuth();
  const { startups, current, setCurrentId } = useStartup();
  return (
    <div style={{ width: 232, flexShrink: 0, background: '#0F1115', display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ padding: '20px 18px', display: 'flex', alignItems: 'center', gap: 9, borderBottom: '1px solid rgba(255,255,255,.06)' }}>
        <span style={{ fontSize: 20 }}>🏢</span>
        <span style={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>Akoro Business</span>
      </div>

      {startups?.length > 0 && (
        <div style={{ padding: '14px 14px 6px' }}>
          <select value={current?.id || ''} onChange={(e) => setCurrentId(e.target.value)}
            style={{ width: '100%', padding: '9px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)', color: '#fff', fontSize: 12.5, fontWeight: 700, fontFamily: FONT }}>
            {startups.map((s) => <option key={s.id} value={s.id} style={{ color: INK }}>{s.name}</option>)}
          </select>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'}
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

      <div style={{ padding: 14, borderTop: '1px solid rgba(255,255,255,.06)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.75)', marginBottom: 8 }}>{user?.fullName || user?.email}</div>
        <button onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 10px', borderRadius: 9, border: 'none', background: 'rgba(255,255,255,.06)', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  );
}

export function PageLayout({ title, subtitle, action, children }) {
  const { startups, loading } = useStartup();
  const navigate = useNavigate();
  const needsOnboarding = !loading && startups && startups.length === 0 && window.location.pathname !== '/create-startup';

  useEffect(() => { if (needsOnboarding) navigate('/create-startup', { replace: true }); }, [needsOnboarding, navigate]);
  if (needsOnboarding) return null;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: FONT }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 26px', borderBottom: `1px solid ${BORDER}`, background: WHITE, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: INK }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{subtitle}</div>}
          </div>
          {action}
        </div>
        <main style={{ flex: 1, overflowY: 'auto', padding: '24px 26px', background: '#FAFAFB' }}>{children}</main>
      </div>
    </div>
  );
}
