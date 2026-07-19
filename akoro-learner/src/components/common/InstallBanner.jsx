/**
 * InstallBanner — a slim, dismissible "install the app" banner for returning
 * (logged-in) learners, so they can install the PWA without hunting the browser
 * menu. Reuses usePwaInstall: native one-tap on Android/desktop, a Share-sheet
 * hint on iOS. Hides once installed, and stays dismissed for the session/device.
 */
import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePwaInstall } from '../../hooks/usePwaInstall.js';

const DISMISS_KEY = 'akoro_install_banner_dismissed';
const BRAND = '#6C3BFF';

export default function InstallBanner() {
  const { hidden, canPrompt, isIOS, promptInstall } = usePwaInstall();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [iosHint, setIosHint] = useState(false);

  if (hidden || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
  };

  const onInstall = async () => {
    if (canPrompt) { const r = await promptInstall(); if (r === 'accepted') dismiss(); return; }
    setIosHint((v) => !v);
  };

  return (
    <div style={{
      position: 'relative', display: 'flex', alignItems: 'center', gap: 12,
      background: `linear-gradient(135deg, ${BRAND}14, ${BRAND}0A)`,
      border: `1px solid ${BRAND}33`, borderRadius: 14, padding: '10px 12px',
      margin: '0 0 14px', fontFamily: "'Nunito', system-ui, sans-serif",
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: `${BRAND}1A`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND,
      }}>
        <Download size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: '#1A1A2E' }}>Install the Akoro app</div>
        <div style={{ fontSize: 12, color: '#6B6B80' }}>Add it to your home screen — faster, and it works offline.</div>
      </div>
      <button onClick={onInstall} style={{
        flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
        borderRadius: 10, border: 'none', background: BRAND, color: '#fff',
        fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
      }}>
        <Download size={14} /> Install
      </button>
      <button onClick={dismiss} aria-label="Dismiss" style={{
        flexShrink: 0, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 8, border: 'none', background: 'transparent', color: '#9490A0', cursor: 'pointer',
      }}>
        <X size={15} />
      </button>

      {iosHint && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 8, zIndex: 50, width: 240,
          background: '#fff', color: '#2D2D2D', borderRadius: 12, border: '1px solid #E2DDD6',
          boxShadow: '0 10px 30px rgba(0,0,0,.16)', padding: '12px 14px', fontSize: 12.5, lineHeight: 1.55,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, marginBottom: 4 }}>
            <Share size={13} /> Add to Home Screen
          </div>
          {isIOS
            ? <>Tap the <strong>Share</strong> icon in Safari, then <strong>“Add to Home Screen”</strong>.</>
            : <>Open your browser menu and choose <strong>“Install app”</strong> / <strong>“Add to Home screen”</strong>.</>}
          <button onClick={() => setIosHint(false)} style={{ marginTop: 8, background: 'none', border: 'none', color: BRAND, fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 12 }}>Got it</button>
        </div>
      )}
    </div>
  );
}
