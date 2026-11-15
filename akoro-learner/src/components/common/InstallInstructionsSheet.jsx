/**
 * InstallInstructionsSheet — the manual "how to install on YOUR browser"
 * bottom sheet, shared by every install surface (the in-app InstallBanner
 * and the landing-page header button).
 *
 * Browsers that never fire beforeinstallprompt (Safari, Firefox, Samsung
 * Internet's first run) still get a working path: exact per-platform menu
 * steps, so an install button never dead-ends.
 */
import { X } from 'lucide-react';

const BRAND = '#6C3BFF';

/* Manual install steps per platform — copy follows each browser's actual
   menu labels. */
export const INSTALL_INSTRUCTIONS = {
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

export const PLATFORM_LABELS = {
  ios: 'iPhone / iPad',
  'android-chrome': 'Android (Chrome)',
  'android-firefox': 'Android (Firefox)',
  'android-samsung': 'Android (Samsung Internet)',
  desktop: 'Desktop',
  unknown: 'your device',
};

export default function InstallInstructionsSheet({ open, onClose, platform }) {
  if (!open) return null;

  const instructions = INSTALL_INSTRUCTIONS[platform] || INSTALL_INSTRUCTIONS.unknown;

  return (
    <div className="ak-sheet-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Install instructions"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(0,0,0,.5)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        fontFamily: "'Nunito', system-ui, sans-serif",
      }}
    >
      <div className="ak-sheet-panel"
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
            onClick={onClose}
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
  );
}
