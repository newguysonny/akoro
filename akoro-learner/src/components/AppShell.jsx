/**
 * AppShell.jsx — admin-style responsive app frame for the learner app.
 *
 * Tablet + desktop (>768px): persistent left sidebar nav, like the admin
 * portal's layout. Full labels above 1024px; an icon-only rail between
 * 769–1024px (the same band the admin sidebar collapses for).
 *
 * Mobile (≤768px): the sidebar is hidden entirely and nothing else changes —
 * the dashboard keeps its bottom nav and the secondary pages keep their
 * back-button headers, exactly as before.
 *
 * Usage — wrap a page's root:
 *   <AppShell badges={{ learn: n, battles: n, agentOnline }}>
 *     <div style={{ width: '100%', height: '100%' }}>…page…</div>
 *   </AppShell>
 *
 * `badges` is optional; the dashboard passes its live counts so the sidebar
 * mirrors the bottom-nav badges. Pages that don't know the counts simply
 * render without them. `nowStudying` is likewise optional — the dashboard
 * passes `{ item, onOpen, onAdd, onDismiss }` when its now-studying bar is
 * showing, and the sidebar renders the desktop twin (NowStudyingSidebarCard)
 * above the user footer.
 *
 * Exports: AppShell, Sidebar
 */
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useLang } from '../contexts/LanguageContext.jsx';
import AkoroLogo from './common/AkoroLogo.jsx';
import { Icon } from './common/Icons.jsx';
import NowStudyingSidebarCard from './dashboard/NowStudyingSidebarCard.jsx';
import { BRAND, RED, GREEN } from '../constants.js';

/* The five dashboard tabs — the same destinations, in the same order, as the
   mobile bottom nav (mirrors goTab() on the dashboard): "Learn" is /app with
   no ?tab, the rest are /app?tab=<key>. "challenges" is Learn's second pill,
   so it keeps Learn lit here just like it does in the bottom nav. */
const TAB_NAV = [
  { tab: 'sessions',  icon: 'ti-book',    key: 'nav.learn'    },
  { tab: 'discovery', icon: 'ti-compass', key: 'nav.discover' },
  { tab: 'rankings',  icon: 'ti-trophy',  key: 'nav.rankings' },
  { tab: 'battles',   icon: 'ti-swords',  key: 'nav.battles'  },
  { tab: 'agent',     icon: 'ti-robot',   key: 'nav.agent'    },
];

/* Standalone pages — on mobile these live behind header buttons and
   back-button flows; on the sidebar they are one click away, always. */
const PAGE_NAV = [
  { to: '/library',     icon: 'ti-books',     key: 'nav.library'     },
  { to: '/activities',  icon: 'ti-activity',  key: 'nav.activities'  },
  { to: '/gradebook',   icon: 'ti-chart-bar', key: 'nav.gradebook'   },
  { to: '/communities', icon: 'ti-users',     key: 'nav.communities' },
  { to: '/wallet',      icon: 'ti-wallet',    key: 'nav.wallet'      },
  { to: '/settings',    icon: 'ti-settings',  key: 'nav.settings'    },
];

/* Current-route matching: tab links match /app + ?tab= (default sessions);
   page links match their route, with sub-routes keeping the parent lit
   (e.g. /communities/:id keeps Communities active). */
function useActiveRoutes() {
  const { pathname, search } = useLocation();
  const tab = new URLSearchParams(search).get('tab') || 'sessions';
  const isTab  = (key) => pathname === '/app' && (tab === key || (key === 'sessions' && tab === 'challenges'));
  const isPage = (to)   => pathname === to || pathname.startsWith(to + '/');
  return { isTab, isPage };
}

/* One sidebar row. `badge`/`badgeColor` mirror the bottom-nav badges (Learn =
   unread sessions on brand, Battles = live battles on red); `dot` is the
   agent-online pulse-free dot. In rail mode (tablet) the badge re-anchors to
   the icon's corner via the .ak-sb-badge CSS in index.css. */
function NavButton({ active, icon, label, badge = 0, badgeColor = BRAND, dot = false, onClick }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="ak-sb-item"
      style={{
        display: 'flex', alignItems: 'center', gap: 11,
        width: 'calc(100% - 20px)', padding: '10px 13px', margin: '2px 10px',
        borderRadius: 12, border: 'none', cursor: 'pointer',
        background: active ? `${BRAND}14` : 'transparent',
        color: active ? BRAND : 'var(--ak-text-sub)',
        fontFamily: "'Nunito',sans-serif", fontSize: 13.5,
        fontWeight: active ? 800 : 600, textAlign: 'left',
        transition: 'background .15s, color .15s', position: 'relative',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--ak-surface-hover)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
        <Icon name={icon} size={19} color={active ? BRAND : undefined}/>
        {dot && (
          <span style={{
            position: 'absolute', top: -2, right: -3, width: 8, height: 8,
            borderRadius: '50%', background: GREEN,
            border: '1.5px solid var(--ak-surface)',
          }}/>
        )}
      </span>
      <span className="ak-sb-label" style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {!!badge && (
        <span className="ak-sb-badge" style={{
          minWidth: 17, height: 17, padding: '0 5px', borderRadius: 9,
          background: badgeColor, color: '#fff', fontSize: 9.5, fontWeight: 800,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, lineHeight: 1,
        }}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

export function Sidebar({ badges = {}, nowStudying }) {
  const navigate  = useNavigate();
  const { t }     = useLang();
  const { user, logout } = useAuth();
  const { isTab, isPage } = useActiveRoutes();

  // Same navigation the dashboard's bottom nav performs (goTab), so the
  // sidebar and the bottom nav can never disagree about where they go.
  const goTab  = (key) => navigate(key === 'sessions' ? '/app' : `/app?tab=${key}`);

  const name = user?.fullName || user?.username || user?.email || 'Learner';
  const initial = (name || 'L').trim().charAt(0).toUpperCase();

  return (
    <aside className="ak-sidebar" style={{ fontFamily: "'Nunito',sans-serif" }}>

      {/* Brand */}
      <div className="ak-sb-brand" style={{
        padding: '20px 18px 14px', borderBottom: '1px solid var(--ak-border)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <AkoroLogo size={34} radius={10}/>
        <div className="ak-sb-brand-text" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', lineHeight: 1.15 }}>Akoro</div>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ak-text-muted)', letterSpacing: '.09em', textTransform: 'uppercase' }}>Learning app</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }} aria-label="App navigation">
        {TAB_NAV.map(({ tab, icon, key }) => (
          <NavButton
            key={tab}
            active={isTab(tab)}
            icon={icon}
            label={t(key)}
            badge={tab === 'sessions' ? (badges.learn || 0) : tab === 'battles' ? (badges.battles || 0) : 0}
            badgeColor={tab === 'battles' ? RED : BRAND}
            dot={tab === 'agent' && !!badges.agentOnline}
            onClick={() => goTab(tab)}
          />
        ))}

        <div className="ak-sb-section" style={{
          padding: '16px 23px 6px', fontSize: 9.5, fontWeight: 800,
          letterSpacing: '.12em', textTransform: 'uppercase',
          color: 'var(--ak-text-muted)',
        }}>{t('nav.more')}</div>

        {PAGE_NAV.map(({ to, icon, key }) => (
          <NavButton
            key={to}
            active={isPage(to)}
            icon={icon}
            label={t(key)}
            onClick={() => navigate(to)}
          />
        ))}
      </nav>

      {/* Now studying — the parked session/record/battle, pinned above the
          user footer (desktop/tablet only; mobile keeps the fixed bar). */}
      {nowStudying?.item && <NowStudyingSidebarCard {...nowStudying} />}

      {/* User + sign out */}
      <div className="ak-sb-user" style={{
        padding: '14px', borderTop: '1px solid var(--ak-border)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        {user?.avatarUrl
          ? <img src={user.avatarUrl} alt="" style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}/>
          : (
            <div style={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
              background: `linear-gradient(135deg,${BRAND},#4C1DCC)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 14, fontWeight: 900,
            }}>{initial}</div>
          )}
        <div className="ak-sb-user-meta" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ak-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t('nav.signed_in_as')}
          </div>
        </div>
        <button
          onClick={logout}
          title={t('nav.signout')}
          aria-label={t('nav.signout')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--ak-text-muted)', padding: 6, borderRadius: 8, flexShrink: 0,
            display: 'flex', alignItems: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ak-text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ak-text-muted)'; }}
        >
          <Icon name="ti-logout" size={17}/>
        </button>
      </div>
    </aside>
  );
}

export function AppShell({ children, badges, nowStudying }) {
  return (
    <div className="ak-shell">
      <Sidebar badges={badges} nowStudying={nowStudying}/>
      <div className="ak-shell-main">{children}</div>
    </div>
  );
}
