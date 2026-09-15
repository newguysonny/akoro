/**
 * AppShell.jsx — admin-style responsive app frame for the learner app.
 *
 * Tablet + desktop (>768px): persistent left sidebar nav, like the admin
 * portal's layout — collapsible to an icon rail via the hamburger
 * (SidebarToggle) in the page header, exactly like the admin portal's
 * TopBar toggle. EXPANDED is the DEFAULT (better with the player bar
 * owning the bottom edge); the choice is remembered in localStorage and
 * is purely user-driven (no viewport media query overriding it).
 *
 * Mobile (≤768px): the sidebar is hidden entirely and nothing else changes —
 * the dashboard keeps its bottom nav and the secondary pages keep their
 * back-button headers, exactly as before.
 *
 * Nav icons are the SAME emoji the mobile bottom nav uses (📚🧭🏆⚔️🤖), so a
 * destination reads identically on every surface.
 *
 * Tier-aware: Activities and Gradebook are school-UI only — higher-ed
 * learners don't get them in the sidebar. The tier is resolved the same way
 * LibraryPage does it (/api/profiles/me → isHigherEdUI), defaulting to the
 * school UI while it loads (studyLevel.js: unknown → school, never the
 * other way round).
 *
 * Usage — wrap a page's root:
 *   <AppShell badges={{ learn: n, battles: n, agentOnline }}>
 *     <div style={{ width: '100%', height: '100%' }}>…page…</div>
 *   </AppShell>
 *
 * `badges` is optional; the dashboard passes its live counts so the sidebar
 * mirrors the bottom-nav badges. Pages that don't know the counts simply
 * render without them. `nowStudying` is likewise optional — the dashboard
 * passes `{ item, onOpen, onAdd, onDismiss, onPrev, onNext, canSkip }` when
 * its now-studying bar is showing. Two surfaces share that one payload:
 * the fixed full-width player bar (NowStudyingTabletBar, rendered here at
 * the bottom of the frame) on EVERYTHING above mobile — tablet and desktop
 * alike — and the mobile bar (≤768px, rendered by the dashboard itself
 * above the bottom nav). The sidebar no longer carries a now-studying
 * card; NowStudyingSidebarCard.jsx stays on disk, retired.
 *
 * Exports: AppShell, Sidebar, SidebarToggle, useAppShell
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLang } from '../contexts/LanguageContext.jsx';
import AkoroLogo from './common/AkoroLogo.jsx';
import { Icon } from './common/Icons.jsx';
import NowStudyingTabletBar from './dashboard/NowStudyingTabletBar.jsx';
import { isHigherEdUI } from '../utils/studyLevel.js';
import { apiGet } from '../services/api.js';
import { BRAND, RED, GREEN } from '../constants.js';

/* ── Sidebar collapse — user-driven, remembered, EXPANDED by default ──
   v2 key: the default flipped from collapsed to expanded, and v1 values
   ('1' = collapsed from experimentation under the old default) must not
   pin anyone to the old default — so the key was renamed to start clean. */
const COLLAPSE_KEY = 'akoro_learner_sidebar_collapsed_v2';

const ShellContext = createContext(null);

/* Access the wrapping AppShell's collapse state (for SidebarToggle). */
export function useAppShell() {
  return useContext(ShellContext);
}

/* The hamburger. Drop it in a page header (the dashboard's, like the admin
   portal's TopBar) — hidden on mobile where the sidebar doesn't exist. */
export function SidebarToggle() {
  const shell = useAppShell();
  if (!shell) return null;                    // outside an AppShell — nothing to toggle
  const { collapsed, toggleSidebar } = shell;
  return (
    <button
      onClick={toggleSidebar}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className="ak-sb-toggle"
      style={{
        width: 34, height: 34, borderRadius: 100, flexShrink: 0, cursor: 'pointer',
        background: `${BRAND}12`, border: `1px solid ${BRAND}3D`, color: BRAND,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Icon name="ti-menu-2" size={17}/>
    </button>
  );
}

/* The five dashboard tabs — the same destinations, in the same order, with
   the same emoji as the mobile bottom nav (mirrors goTab() on the
   dashboard): "Learn" is /app with no ?tab, the rest are /app?tab=<key>.
   "challenges" is Learn's second pill, so it keeps Learn lit here just like
   it does in the bottom nav. */
const TAB_NAV = [
  { tab: 'sessions',  emoji: '📚', key: 'nav.learn'    },
  { tab: 'discovery', emoji: '🧭', key: 'nav.discover' },
  { tab: 'rankings',  emoji: '🏆', key: 'nav.rankings' },
  { tab: 'battles',   emoji: '⚔️', key: 'nav.battles'  },
  { tab: 'agent',     emoji: '🤖', key: 'nav.agent'    },
];

/* Standalone pages — on mobile these live behind header buttons and
   back-button flows; on the sidebar they are one click away, always.
   `schoolOnly` entries (Activities, Gradebook) are hidden for higher-ed
   learners — that content is school-UI territory. */
const PAGE_NAV = [
  { to: '/library',     emoji: '🗂️', key: 'nav.library'     },
  { to: '/activities',  emoji: '📝', key: 'nav.activities',  schoolOnly: true },
  { to: '/gradebook',   emoji: '📊', key: 'nav.gradebook',   schoolOnly: true },
  { to: '/communities', emoji: '👥', key: 'nav.communities' },
  { to: '/wallet',      emoji: '🪙', key: 'nav.wallet'      },
  { to: '/settings',    emoji: '⚙️', key: 'nav.settings'    },
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

/* Which UI tier is this learner on? Same resolution LibraryPage uses:
   /api/profiles/me → isHigherEdUI. School UI while unknown (the documented
   default — never the other way round), best-effort fetch. */
function useHigherEd() {
  const [higherEd, setHigherEd] = useState(false);
  useEffect(() => {
    let alive = true;
    apiGet('/api/profiles/me')
      .then((d) => { if (alive) setHigherEd(isHigherEdUI(d?.data ?? d ?? {})); })
      .catch(() => { /* offline/unknown → school UI stays */ });
    return () => { alive = false; };
  }, []);
  return higherEd;
}

/* One sidebar row. `badge`/`badgeColor` mirror the bottom-nav badges (Learn =
   unread sessions on brand, Battles = live battles on red); `dot` is the
   agent-online dot. In collapsed-rail mode the badge re-anchors to the
   emoji's corner via the .ak-sb-badge CSS in index.css. */
function NavButton({ active, emoji, label, badge = 0, badgeColor = BRAND, dot = false, onClick }) {
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
      <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, fontSize: 19, lineHeight: 1 }}>
        {emoji}
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

export function Sidebar({ badges = {}, collapsed = false }) {
  const navigate  = useNavigate();
  const { t }     = useLang();
  const { isTab, isPage } = useActiveRoutes();
  const higherEd  = useHigherEd();

  // Same navigation the dashboard's bottom nav performs (goTab), so the
  // sidebar and the bottom nav can never disagree about where they go.
  const goTab  = (key) => navigate(key === 'sessions' ? '/app' : `/app?tab=${key}`);

  // Activities + Gradebook are school-UI only.
  const pageNav = PAGE_NAV.filter((p) => !higherEd || !p.schoolOnly);

  return (
    <aside className={`ak-sidebar${collapsed ? ' ak-collapsed' : ''}`} style={{ fontFamily: "'Nunito',sans-serif" }}>

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
        {TAB_NAV.map(({ tab, emoji, key }) => (
          <NavButton
            key={tab}
            active={isTab(tab)}
            emoji={emoji}
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

        {pageNav.map(({ to, emoji, key }) => (
          <NavButton
            key={to}
            active={isPage(to)}
            emoji={emoji}
            label={t(key)}
            onClick={() => navigate(to)}
          />
        ))}
      </nav>

    </aside>
  );
}

export function AppShell({ children, badges, nowStudying }) {
  // Expanded by default; purely user-driven afterwards and remembered
  // across page loads. Only an EXPLICIT saved '1' collapses — absent key
  // or '0' means expanded.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const toggleSidebar = () => setCollapsed((c) => {
    const next = !c;
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

  return (
    <ShellContext.Provider value={{ collapsed, toggleSidebar }}>
      {/* ak-has-nowbar — a parked now-studying item exists, so the frame
          makes room for the fixed bottom player bar (index.css). */}
      <div className={`ak-shell${nowStudying?.item ? ' ak-has-nowbar' : ''}`}>
        <Sidebar badges={badges} collapsed={collapsed}/>
        <div className="ak-shell-main">{children}</div>
        {/* Now-studying surface for everything above mobile — fixed,
            full-width, 3-column player bar. CSS shows it only >768px (the
            dashboard's own mobile bar covers ≤768px). Renders null without
            an item. */}
        <NowStudyingTabletBar {...(nowStudying || {})} />
      </div>
    </ShellContext.Provider>
  );
}
