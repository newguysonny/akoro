/**
 * ShellPreviewPage.jsx — DEV-ONLY preview of the AppShell responsive layout.
 *
 * Reachable at /dev/shell in `vite dev` only: the route in App.jsx is gated
 * on import.meta.env.DEV, so this page (and its chunk) never ship in a
 * production build. It exists so the sidebar / rail / bottom-nav behaviour
 * can be checked without a signed-in session or a running API.
 *
 * What to verify here:
 *   • >768px   — sidebar (collapsible rail) + the fixed, full-width
 *                now-studying player bar (3 columns: name & details,
 *                progress + prev/next, tool icons) at the bottom; the
 *                sidebar and content stop above it
 *   • ≤768px   — sidebar + player bar gone; bottom nav + the dashboard's
 *                own fixed now-studying bar visible
 *   • Desktop  — FAB sits in the content column clear of the sidebar and
 *                above the player bar, and the bottom nav is hidden
 */
import { AppShell, SidebarToggle } from '../components/AppShell.jsx';
import { Icon } from '../components/common/Icons.jsx';
import { BRAND, RED, GREEN, GOLD } from '../constants.js';
import { useLang } from '../contexts/LanguageContext.jsx';

const CARD = {
  background: 'var(--ak-surface)', borderRadius: 14,
  border: '1px solid var(--ak-border)', padding: '14px 16px',
};

export default function ShellPreviewPage() {
  const { t } = useLang();

  // Fake parked item — exercises the now-studying player bar, the same
  // payload shape utils/nowStudying.js stores ({ type, id, title, sub,
  // emoji, progress }) plus the skip controls the dashboard passes.
  const nowItem = {
    type: 'session', id: 'demo-1', title: 'Maths — Fractions & decimals',
    sub: 'Agent session', emoji: '➗', progress: 42,
  };

  const tabs = [
    { key: 'sessions',  label: t('nav.learn')    },
    { key: 'discovery', label: t('nav.discover') },
    { key: 'rankings',  label: t('nav.rankings') },
    { key: 'battles',   label: t('nav.battles')  },
    { key: 'agent',     label: t('nav.agent')    },
  ];

  return (
    <AppShell
      badges={{ learn: 3, battles: 1, agentOnline: true }}
      nowStudying={{
        item: nowItem,
        onOpen: () => {}, onAdd: () => {}, onDismiss: () => {},
        onPrev: () => {}, onNext: () => {}, canSkip: true,
      }}>
      <div style={{ width: '100%', height: '100%', fontFamily: "'Nunito',sans-serif", background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

        {/* Fake dashboard header — the real one renders on Learn/Challenges */}
        <div style={{ background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border)', padding: '14px 18px 0', zIndex: 100, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <SidebarToggle/>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15, fontWeight: 900 }}>A</div>
              <div>
                <p style={{ fontSize: 15, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>Ada Learner</p>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)' }}>12,400 XP · Year 10</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, background: `${GOLD}1F`, border: `1px solid ${GOLD}55`, borderRadius: 100, height: 34, padding: '0 12px', fontSize: 12.5, fontWeight: 900, color: 'var(--ak-warn-text)' }}>
                <Icon name="ti-coins" size={15} color={GOLD}/> 1,250
              </span>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${BRAND}12`, border: `1px solid ${BRAND}3D`, borderRadius: 100, width: 34, height: 34 }}>
                <Icon name="ti-bell" size={16} color={BRAND}/>
              </span>
            </div>
          </div>
          <div style={{ display: 'flex' }}>
            {['My sessions', 'Challenges'].map((label, i) => (
              <button key={label} style={{ flex: 1, padding: '10px 0 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: i === 0 ? 800 : 600, color: i === 0 ? BRAND : 'var(--ak-text-muted)', borderBottom: `2.5px solid ${i === 0 ? BRAND : 'transparent'}`, fontFamily: "'Nunito',sans-serif" }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Fake scrollable content */}
        <div className="ak-dash-scroll" style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 72px' }}>
          <div style={{ padding: '10px 4px 14px', fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text-muted)' }}>
            /dev/shell — dev-only preview. The sidebar starts expanded; tap the hamburger to collapse it to the icon rail (remembered across loads). Emoji match the mobile bottom nav; Activities + Gradebook are school-UI only; Communities is higher-ed only — each tier sees exactly its own set. Above 768px the now-studying player bar is pinned full-width at the bottom (3 columns: name & details · progress + prev/next · tool icons); below that the bottom nav + the dashboard's own bar take over. (This preview is the Learn tab, so its header shows on mobile too — off-Learn tabs drop the header there.)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 12 }}>
            {['Maths — Fractions', 'English — Comprehension', 'Science — Photosynthesis', 'History — Independence', 'Battles — 2 live', 'Rankings — #4 this week'].map((label, i) => (
              <div key={label} style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 11, background: `${BRAND}14`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="ti-book" size={20} color={BRAND}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)' }}>{label}</div>
                  <div style={{ height: 4, background: 'var(--ak-border)', borderRadius: 3, marginTop: 7, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${25 + i * 12}%`, background: GREEN, borderRadius: 3 }}/>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Fake now-studying bar — verifies the desktop re-anchoring rule */}
        <div className="ak-now-bar" style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))', zIndex: 'var(--z-bar)', background: 'var(--ak-surface)', borderTop: '1px solid var(--ak-border)', boxShadow: '0 -4px 18px rgba(0,0,0,.10)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="ti-player-play" size={16} color={GREEN}/>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>Now studying — now-bar preview</span>
        </div>

        {/* Fake bottom nav (mobile only) */}
        <div className="ak-bottom-nav" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200, background: 'var(--ak-surface)', borderTop: '1px solid var(--ak-border)', padding: '8px 0 env(safe-area-inset-bottom,14px)', display: 'flex', justifyContent: 'space-around', minHeight: 62 }}>
          {tabs.map(({ key, label }, i) => (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer', color: i === 0 ? BRAND : 'var(--ak-text-muted)', minWidth: 56, padding: '2px 0' }}>
              <Icon name={['ti-book', 'ti-compass', 'ti-trophy', 'ti-swords', 'ti-robot'][i]} size={22} color={i === 0 ? BRAND : 'var(--ak-text-muted)'}/>
              <span style={{ fontSize: 10.5, fontWeight: i === 0 ? 800 : 600 }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Fake FAB — verifies the desktop bottom-offset rule */}
        <div className="ak-fab" style={{ position: 'fixed', bottom: 78, right: 18, zIndex: 900, background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, borderRadius: 16, padding: '9px 16px', display: 'flex', alignItems: 'center', gap: 7, boxShadow: `0 4px 18px ${BRAND}50`, cursor: 'pointer' }}>
          <Icon name="ti-microphone" size={15} color="#fff"/>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>Start session</span>
        </div>
      </div>
    </AppShell>
  );
}
