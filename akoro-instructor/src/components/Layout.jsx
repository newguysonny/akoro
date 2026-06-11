import { NavLink, useNavigate } from 'react-router-dom';
import { Home, BookOpen, Users, Swords, MessageSquare, CheckSquare, LogOut, Bell, Settings } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, FONT } from '../constants.js';

const NAV = [
  { to: '/',        icon: Home,          label: 'Home' },
  { to: '/courses', icon: BookOpen,      label: 'Courses' },
  { to: '/students',icon: Users,         label: 'Students' },
  { to: '/battles', icon: Swords,        label: 'Battles' },
  { to: '/tasks',   icon: CheckSquare,   label: 'Tasks' },
  { to: '/chat',    icon: MessageSquare, label: 'AI Chat' },
  { to: '/settings',icon: Settings,      label: 'Settings' },
];

function NavItem({ to, icon: Icon, label }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 16px', borderRadius: 10, margin: '2px 8px',
        textDecoration: 'none', color: isActive ? WHITE : MUTED2,
        background: isActive ? `${AMBER}22` : 'transparent',
        fontFamily: FONT, fontSize: 14, fontWeight: isActive ? 600 : 400,
        transition: 'all .15s',
        borderLeft: isActive ? `3px solid ${AMBER}` : '3px solid transparent',
      })}
    >
      <Icon size={18} />
      <span>{label}</span>
    </NavLink>
  );
}

export function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <aside style={{
      width: 240, flexShrink: 0, background: INK,
      display: 'flex', flexDirection: 'column',
      height: '100vh', position: 'sticky', top: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: '24px 20px 16px', borderBottom: `1px solid rgba(255,255,255,.07)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `linear-gradient(135deg, ${AMBER}, #D4651E)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>🎓</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: WHITE, fontFamily: FONT }}>Piabam</div>
            <div style={{ fontSize: 10, color: MUTED2, fontFamily: FONT }}>Instructor Portal</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
        {NAV.map(item => <NavItem key={item.to} {...item} />)}
      </nav>

      {/* User */}
      <div style={{
        padding: '16px', borderTop: `1px solid rgba(255,255,255,.07)`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: `linear-gradient(135deg, ${AMBER}, ${AMBER}88)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: WHITE, flexShrink: 0,
        }}>
          {(user?.fullName || user?.email || 'T')[0].toUpperCase()}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: WHITE, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.fullName || 'Instructor'}
          </div>
          <div style={{ fontSize: 11, color: MUTED2, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email || ''}
          </div>
        </div>
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
    </aside>
  );
}

export function TopBar({ title, subtitle, action }) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 10,
      background: 'rgba(250,248,245,.95)', backdropFilter: 'blur(8px)',
      borderBottom: `1px solid ${BORDER}`,
      padding: '16px 28px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: INK, margin: 0, fontFamily: FONT }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13, color: MUTED, margin: '2px 0 0', fontFamily: FONT }}>{subtitle}</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {action}
        <button style={{
          background: WHITE, border: `1.5px solid ${BORDER}`,
          borderRadius: 10, padding: '8px', cursor: 'pointer', color: MUTED,
          display: 'flex', alignItems: 'center',
        }}>
          <Bell size={16} />
        </button>
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
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar title={title} subtitle={subtitle} action={action} />
        <main style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
