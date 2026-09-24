/**
 * InstallBanner — a slim, dismissible "install the app" banner for returning
 * (logged-in) learners, so they can install the PWA without hunting the
 * browser menu.
 *
 * Browsers that fire beforeinstallprompt (Chrome, Edge, Android) install in
 * one tap. Every OTHER browser — Safari, Firefox, Samsung Internet — gets a
 * bottom sheet with the exact steps for the learner's own platform, so the
 * button never dead-ends. Hides once installed, and stays dismissed for the
 * session/device.
 */
import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePwaInstall } from '../../hooks/usePwaInstall.js';

const DISMISS_KEY = 'akoro_install_banner_dismissed';
const BRAND = '#6C3BFF';

/* Manual install steps per platform — for the browsers that never fire
   beforeinstallprompt. Copy follows each browser's actual menu labels. */
const INSTALL_INSTRUCTIONS = {
  ios: {
    steps: [
      'Tap the Share button at the bottom of the screen',
      'Scroll down and tap "Add to Home Screen"',
      'Tap "Add" to confirm',
    ],
    note: 'Works in Safari only — Chrome and Firefox on iOS cannot install PWAs.',
  },
  'android-chrome': {
    steps: [
      'Tap the menu (⋮) in the top-right corner of Chrome',
      'Tap "Install app" (or "Add to Home screen")',
      'Tap "Install" to confirm',
    ],
  },
  'android-firefox': {
    steps: [
      'Tap the menu in the top- or bottom-right corner',
      'Tap "Install", or "More" → "Add app to Home Screen"',
    ],
  },
  'android-samsung': {
    steps: [
      'Tap the menu (☰) in Samsung Internet',
      'Tap "Add page to" → "Home screen"',
      'Tap "Add" to confirm',
    ],
    note: 'You may see a Google Play Protect warning — tap "Install anyway" to proceed.',
  },
  desktop: {
    steps: [
      'Click the install icon (⊕) in your browser\'s address bar',
      'Click "Install" in the dialog that appears',
    ],
    note: 'Available in Chrome, Edge and Opera — not in Firefox or Safari on macOS.',
  },
  unknown: {
    steps: [
      'Open your browser menu',
      'Look for "Install app" or "Add to Home Screen"',
      'Follow the on-screen prompts',
    ],
  },
};

const PLATFORM_LABELS = {
  ios: 'iPhone / iPad',
  'android-chrome': 'Android (Chrome)',
  'android-firefox': 'Android (Firefox)',
  'android-samsung': 'Android (Samsung Internet)',
  desktop: 'Desktop',
  unknown: 'your device',
};

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

  const instructions = INSTALL_INSTRUCTIONS[platform] || INSTALL_INSTRUCTIONS.unknown;

  return (
    <>
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
      </div>

      {/* ── Manual install steps — bottom sheet for prompt-less browsers ── */}
      {sheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install instructions"
          onClick={(e) => { if (e.target === e.currentTarget) setSheetOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1200,
            background: 'rgba(0,0,0,.5)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            fontFamily: "'Nunito', system-ui, sans-serif",
          }}
        >
          <div
            style={{
              width: '100%', maxWidth: 480, maxHeight: '82vh', overflowY: 'auto',
              background: 'var(--ak-surface, #fff)', color: 'var(--ak-text, #1A1A2E)',
              borderRadius: '18px 18px 0 0', padding: '20px 22px 26px',
              borderTop: '1px solid var(--ak-border2, #E5E7EB)',
              boxShadow: '0 -12px 40px rgba(0,0,0,.25)',
              animation: 'sheet-up .25s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 15.5, fontWeight: 800 }}>
                Install on {PLATFORM_LABELS[platform] || PLATFORM_LABELS.unknown}
              </div>
              <button
                onClick={() => setSheetOpen(false)}
                aria-label="Close install instructions"
                style={{
                  width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 9, border: 'none', background: 'transparent',
                  color: 'var(--ak-text-sub, #6B7280)', cursor: 'pointer',
                }}
              >
                <X size={17} />
              </button>
            </div>

            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {instructions.steps.map((step, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5, lineHeight: 1.5 }}>
                  <span style={{
                    flexShrink: 0, width: 22, height: 22, borderRadius: 999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: `${BRAND}1A`, color: BRAND, fontSize: 11.5, fontWeight: 800, marginTop: 1,
                  }}>{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            {instructions.note && (
              <p style={{
                marginTop: 16, fontSize: 12, lineHeight: 1.55,
                color: 'var(--ak-text-sub, #6B7280)', fontStyle: 'italic',
              }}>
                {instructions.note}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
