import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../common/Icons.jsx';
import { BRAND } from '../../constants.js';
import { AppShell } from '../AppShell.jsx';

/* Round icon chip used in community headers (settings / people /
   analytics / profile) — same visual language as the back button.
   `disabled` renders a calm placeholder (the pre-data loading chip). */
export function IconChip({ icon, onClick, label, size = 34, disabled = false }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} disabled={disabled}
      style={{ background: '#F0EBFF', border: '1px solid #DDD3FF', borderRadius: 100, width: size, height: size, cursor: disabled ? 'default' : 'pointer', color: BRAND, opacity: disabled ? .55 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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

/* Notifications-page-style shell for the community sub-pages:
   header (back, title + sub, optional header-right slot) + scrollable
   content with the standard skeleton. `empty` is a React node for the
   zero-state; otherwise `children` renders. `headerLoading` swaps the
   title/sub for pulsing bars so the header never shows a placeholder
   word ("Community") while the real name is still in flight. */
export default function CommunityShell({ title, sub, backTo, right, loading, headerLoading = false, empty, children }) {
  const navigate = useNavigate();
  return (
    <AppShell>
    <div style={{ width: '100%', height: '100%', fontFamily: "'Nunito',sans-serif", background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{`@keyframes akHeaderPulse{0%,100%{opacity:.45}50%{opacity:.85}}`}</style>
      {/* HEADER */}
      <div style={{ background: 'var(--ak-surface)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--ak-border)', padding: '14px 18px', zIndex: 100, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigate(backTo)}
            style={{ background: '#F0EBFF', border: '1px solid #DDD3FF', borderRadius: 100, width: 34, height: 34, cursor: 'pointer', color: BRAND, fontSize: 16, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            ‹
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            {headerLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <HeaderSkeletonBar w={130}/>
                <HeaderSkeletonBar w={64} h={9}/>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {title}
                </p>
                {sub && (
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sub}
                  </p>
                )}
              </>
            )}
          </div>
          {right && <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{right}</div>}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 80px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3].map(i => <div key={i} style={{ height: 70, borderRadius: 14, background: 'var(--ak-border)', opacity: .4 }} />)}
          </div>
        ) : empty ? empty : children}
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
