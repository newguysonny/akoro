/**
 * InstallBanner — a slim, dismissible "install the app" banner for the
 * instructor dashboard, so instructors can install the PWA without hunting
 * the browser menu.
 *
 * Browsers that fire beforeinstallprompt (Chrome, Edge, Android) install in
 * one tap. Every OTHER browser — Safari, Firefox, Samsung Internet — gets
 * the shared InstallInstructionsSheet with the exact steps for the
 * instructor's own platform, so the button never dead-ends. Hides once
 * installed; dismissal persists in localStorage.
 */
import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall.js';
import InstallInstructionsSheet from './InstallInstructionsSheet.jsx';
import { AMBER, INK, MUTED, FONT } from '../constants.js';

const DISMISS_KEY = 'akoro_instructor_install_banner_dismissed';
const BRAND = AMBER;

export default function InstallBanner() {
  const { hidden, canPrompt, platform, promptInstall } = usePwaInstall();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [sheetOpen, setSheetOpen] = useState(false);

  if (hidden || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
  };

  const onInstall = async () => {
    if (canPrompt) { const r = await promptInstall(); if (r === 'accepted') dismiss(); return; }
    setSheetOpen(true);   // no native prompt on this browser — show its exact steps
  };

  return (
    <>
      <div style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 12,
        background: `linear-gradient(135deg, ${BRAND}14, ${BRAND}0A)`,
        border: `1px solid ${BRAND}33`, borderRadius: 14, padding: '10px 12px',
        margin: '0 0 16px', fontFamily: FONT,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: `${BRAND}1A`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND,
        }}>
          <Download size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>Install the Akoro instructor app</div>
          <div style={{ fontSize: 12, color: MUTED }}>Add it to your home screen — faster, and it works offline.</div>
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
      </div>

      <InstallInstructionsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} platform={platform} />
    </>
  );
}
