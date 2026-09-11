/**
 * MobileGate — phones get a friendly full-page "built for bigger screens"
 * notice instead of the app (tablet and desktop render normally).
 *
 * Why a gate and not a banner: the console is designed for tablet/desktop —
 * on a phone it is cramped, and an open phone tab used to poll the API around
 * the clock (the platform bills every DB command). A gated phone mounts
 * NOTHING, so it costs zero commands.
 *
 * Phones only: the gate triggers below 768px CSS width, so tablets (iPad
 * mini/Pro, Android tabs) keep the full experience. "Continue anyway" is
 * remembered for the browser tab (sessionStorage) — a fresh tab re-gates.
 */

import { useEffect, useState } from 'react';
import { AkoroWordmark } from './common/AkoroLogo.jsx';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, PURPLE, FONT } from '../constants.js';

const PHONE_QUERY = '(max-width: 767px)';
const BYPASS_KEY = 'akoro_mobile_gate_bypass';

const isPhoneNow = () => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches;

/* Device trio: desktop, laptop, tablet — pure SVG, no assets to load. */
function DevicesIllustration() {
  const screen = (x, y, w, h, rx) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={WHITE} stroke={INK} strokeWidth="3" />
      <rect x={x + 8} y={y + 8} width={w - 16} height={10} rx={3} fill={AMBER} opacity="0.85" />
      <rect x={x + 8} y={y + 24} width={(w - 16) * 0.62} height={6} rx={3} fill={BORDER} />
      <rect x={x + 8} y={y + 36} width={(w - 16) * 0.8} height={6} rx={3} fill={BORDER} />
      <rect x={x + 8} y={y + h - 18} width={(w - 16) * 0.45} height={8} rx={3} fill={PURPLE} opacity="0.55" />
    </g>
  );
  return (
    <svg width="300" height="150" viewBox="0 0 320 160" role="img" aria-label="Desktop, laptop and tablet">
      {/* Desktop with stand */}
      {screen(24, 18, 118, 82, 8)}
      <rect x="72" y="100" width="22" height="14" fill={INK} />
      <rect x="52" y="114" width="62" height="8" rx="4" fill={INK} />
      {/* Laptop */}
      {screen(168, 40, 100, 64, 7)}
      <path d="M156 116 L280 116 L288 126 Q289 130 284 130 L152 130 Q147 130 148 126 Z" fill={INK} />
      {/* Tablet */}
      <rect x="236" y="14" width="66" height="92" rx="10" fill={WHITE} stroke={INK} strokeWidth="3" />
      <rect x="244" y="24" width="50" height="8" rx="3" fill={AMBER} opacity="0.85" />
      <rect x="244" y="38" width="50" height="5" rx="2.5" fill={BORDER} />
      <rect x="244" y="48" width="50" height="5" rx="2.5" fill={BORDER} />
      <rect x="244" y="58" width="34" height="5" rx="2.5" fill={BORDER} />
      <circle cx="269" cy="96" r="4" fill={BORDER} />
    </svg>
  );
}

export default function MobileGate({ children, product = 'console' }) {
  const [phone, setPhone] = useState(isPhoneNow);
  const [bypassed, setBypassed] = useState(() => {
    try { return sessionStorage.getItem(BYPASS_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = (e) => setPhone(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  if (!phone || bypassed) return children;

  const continueAnyway = () => {
    try { sessionStorage.setItem(BYPASS_KEY, '1'); } catch { /* private mode */ }
    setBypassed(true);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, overflowY: 'auto',
      background: LIGHT, fontFamily: FONT, color: INK,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px 20px calc(24px + env(safe-area-inset-bottom))',
    }}>
      <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <AkoroWordmark height={40} />
        </div>
        <h1 style={{ fontSize: 21, lineHeight: 1.35, fontWeight: 800, margin: '0 0 12px', color: INK }}>
          We're hard at work bringing the {product} to mobile browsers soon ✨
        </h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.55, color: MUTED, margin: '0 0 10px' }}>
          For now, enjoy the full experience — open Akoro on your desktop, laptop, or tablet.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', margin: '18px 0 6px' }}>
          <DevicesIllustration />
        </div>
        <button
          onClick={continueAnyway}
          style={{
            marginTop: 14, background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12.5, fontWeight: 700, color: AMBER, fontFamily: FONT,
            textDecoration: 'underline', textUnderlineOffset: 3,
          }}
        >
          Continue to the full app anyway →
        </button>
      </div>
    </div>
  );
}
