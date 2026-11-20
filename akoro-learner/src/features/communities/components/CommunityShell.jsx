import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../../components/common/Icons.jsx';
import { BRAND } from '../../../constants.js';
import { AppShell } from '../../../components/AppShell.jsx';

/**
 * CommunityShell.jsx — the community pages' shell, overhauled to the
 * reference UI (reference/communities pages.md):
 *
 *   · a STICKY header-group (top-bar + optional extras) that rides at the
 *     top of the page scroll, exactly like the reference's .header-group —
 *     the follow row and the type tabs live INSIDE it on the main page;
 *   · the reference's top-bar: neutral back-btn, optional community icon,
 *     title + sub, and the icon-row of round purple chips on the right;
 *   · body content on the app's own --ak-* tokens with the reference's
 *     radius/spacing scale (--r-*, --s-*), which index.css already defines.
 *
 * Layout: the shell fills the app shell's content area at every size —
 * mobile keeps the bottom nav, tablet/desktop render in-tab full width
 * (side nav + header stay), the same treatment as the Discover hub,
 * Contents and Pharm D pages. No max-width caps anywhere.
 */

/* Accent cycle for avatars/thumbs — the reference's palette. The app has no
   --ak-* soft tokens for these hues, so they ride the brand hex constants. */
export const ACCENTS = ['#6C3BFF', '#FF6B57', '#2BB673', '#3BA7E0'];

/* Round icon chip used in community headers (settings / people /
   analytics / profile) — the reference's .icon-btn: a soft purple disc.
   `disabled` renders a calm placeholder (the pre-data loading chip). */
export function IconChip({ icon, onClick, label, size = 36, disabled = false }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className="ak-cm-iconbtn"
      style={{ background: `${BRAND}14`, border: 'none', borderRadius: 'var(--r-full)', width: size, height: size, cursor: disabled ? 'default' : 'pointer', color: BRAND, opacity: disabled ? .55 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon name={icon} size={17}/>
    </button>
  );
}

/* Pulsing placeholder bar for the header title while the community loads —
   the name has a loading state, like the content skeleton below it. */
function HeaderSkeletonBar({ w, h = 14 }) {
  return (
    <span className="ak-hskel" style={{
      display: 'inline-block', width: w, height: h, borderRadius: h / 2,
      background: 'var(--ak-border)', animation: 'akHeaderPulse 1.4s ease-in-out infinite',
    }}/>
  );
}

/* The reference's empty state: a soft icon tile, a bold title, a quiet sub.
   `compact` trims the tile and padding for section-level rails (the full
   size is for whole-body zero states). */
export function CommunityEmptyState({ icon = 'ti-clipboard', title, sub, compact = false }) {
  const tile = compact ? 44 : 52;
  return (
    <div style={{ textAlign: 'center', padding: compact ? '14px 20px 26px' : '36px 30px 60px', color: 'var(--ak-text-sub)' }}>
      <div style={{ width: tile, height: tile, borderRadius: 'var(--r-lg)', background: 'var(--ak-border)', color: 'var(--ak-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
        <Icon name={icon} size={compact ? 20 : 24}/>
      </div>
      <div style={{ fontWeight: 800, color: 'var(--ak-text)', fontSize: 15, marginBottom: 3 }}>{title}</div>
      {sub && <div style={{ fontSize: 13 }}>{sub}</div>}
    </div>
  );
}

/* The reference's .section-title — the quiet uppercase rail label. */
export function SectionTitle({ children }) {
  return (
    <div style={{ padding: '16px 0 8px', fontSize: 11.5, fontWeight: 800, color: 'var(--ak-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
      {children}
    </div>
  );
}

/* Shell for the community pages. `icon` is the community's gradient tile
   (main page); `headerExtras` renders inside the sticky header-group below
   the top-bar (the follow row + tabs on the main page). `empty` is a React
   node for the zero-state; otherwise `children` renders. `headerLoading`
   swaps the title/sub for pulsing bars so the header never shows a
   placeholder word ("Community") while the real name is still in flight. */
export default function CommunityShell({ title, sub, backTo, right, loading, headerLoading = false, empty, children, icon, headerExtras }) {
  const navigate = useNavigate();
  return (
    <AppShell>
    <div style={{ width: '100%', height: '100%', fontFamily: "'Nunito',sans-serif", background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{`
        @keyframes akHeaderPulse{0%,100%{opacity:.45}50%{opacity:.85}}
        .ak-cm-iconbtn:active{transform:scale(.92)}
        .ak-cm-noscr::-webkit-scrollbar{display:none}
        .ak-cm-noscr{scrollbar-width:none}
      `}</style>

      {/* SCROLL — the header-group rides sticky at the top of this scroll,
          the reference's .header-group, so the tabs/follow row stay put
          while the feed scrolls under them. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>

        {/* ── Sticky header-group ── */}
        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border2)' }}>
          <div style={{ padding: 'var(--s-4)', display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
            <button onClick={() => navigate(backTo)} aria-label="Back"
              className="ak-cm-iconbtn"
              style={{ width: 34, height: 34, borderRadius: 'var(--r-full)', border: '1px solid var(--ak-border2)', background: 'var(--ak-surface)', color: 'var(--ak-text-sub)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name="ti-chevron-left" size={18}/>
            </button>
            {icon}
            <div style={{ flex: 1, minWidth: 0 }}>
              {headerLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <HeaderSkeletonBar w={130}/>
                  <HeaderSkeletonBar w={64} h={9}/>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 17, fontWeight: 800, color: 'var(--ak-text)', margin: 0, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title}
                  </p>
                  {sub && (
                    <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-sub)', margin: 0, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sub}
                    </p>
                  )}
                </>
              )}
            </div>
            {right && <div style={{ display: 'flex', gap: 'var(--s-2)', flexShrink: 0 }}>{right}</div>}
          </div>
          {headerExtras}
        </div>

        {/* ── Body ── */}
        <div style={{ padding: 'var(--s-4) var(--s-4) 80px' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1,2,3].map(i => <div key={i} style={{ height: 70, borderRadius: 'var(--r-lg)', background: 'var(--ak-border)', opacity: .4 }} />)}
            </div>
          ) : empty ? empty : children}
        </div>
      </div>
    </div>
    </AppShell>
  );
}

/* Small toast shared by the community pages. */
export function useCommunityToast() {
  const [toast, setToast] = useState(null);
  const show = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };
  const node = toast && (
    <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 3000, background: 'var(--ak-text)', color: '#fff', fontSize: 12.5, fontWeight: 800, padding: '9px 18px', borderRadius: 100, boxShadow: '0 6px 20px rgba(0,0,0,.25)' }}>
      {toast}
    </div>
  );
  return [show, node];
}
