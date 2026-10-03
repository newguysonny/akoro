/**
 * Icons.jsx — the Kpemu icon set: hand-drawn stroke SVGs on a 24×24 grid
 * (the learner app's NavIcons pattern), inheriting `currentColor` so they
 * sit in buttons, chips and statuses without per-site colours.
 *
 *   <Icon name="wallet" size={16} />
 *
 * Replaces every emoji that used to act as an icon in the Agent Demo and
 * Business apps — nav items, category chips, statuses, auth screens — so a
 * control reads identically on every platform instead of rendering whatever
 * emoji font the device happens to have.
 */

export function Icon({ name, size = 16, style, ...props }) {
  const glyph = ICONS[name];
  if (!glyph) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: '-0.16em', ...style }}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {glyph}
    </svg>
  );
}

const ICONS = {
  /* ── Entities + navigation ──────────────────────────────────── */
  store: (<><path d="M4 5h16l1.5 5H2.5Z" /><path d="M5 10v11M19 10v11M3 21h18" /><path d="M10 21v-5h4v5" /></>),
  wallet: (<><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18" /><circle cx="16.5" cy="14.5" r="0.7" fill="currentColor" stroke="none" /></>),
  ticket: (<><path d="M3 9a3 3 0 0 1 0 6v2a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-2a3 3 0 0 1 0-6V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" /><path d="M14 8v8" strokeDasharray="2 2.5" /></>),
  building: (<><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M8.8 7h1.6M13.6 7h1.6M8.8 11h1.6M13.6 11h1.6M8.8 15h1.6M13.6 15h1.6" /><path d="M10.4 21v-3h3.2v3" /></>),
  "graduation-cap": (<><path d="M2 9.5 12 4.5l10 5-10 5z" /><path d="M6.2 11.8V16c0 1.4 11.6 1.4 11.6 0v-4.2" /><path d="M22 9.5V15" /></>),
  "credit-card": (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M7 15h4" /></>),
  gamepad: (<><rect x="2.5" y="7.5" width="19" height="10" rx="5" /><path d="M7 10.5v4M5 12.5h4" /><circle cx="15.3" cy="11.3" r="0.7" fill="currentColor" stroke="none" /><circle cx="17.8" cy="13.6" r="0.7" fill="currentColor" stroke="none" /></>),
  bolt: (<path d="M13 3 5.5 13H11l-1 8 7.5-10H12z" />),
  heart: (<><path d="M12 20s-7-4.3-9-8.7C1.5 7.3 4.5 4.5 7.3 4.5c1.9 0 3.4 1 4.7 2.8 1.3-1.8 2.8-2.8 4.7-2.8 2.8 0 5.8 2.8 4.3 6.8C19 15.7 12 20 12 20z" /><path d="M7.3 12.4h2l1.3-2 2.2 3.8 1.3-2h2.6" /></>),
  "shopping-bag": (<><path d="M6 8h12l1 13H5z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></>),
  "shopping-cart": (<><circle cx="9.2" cy="20" r="1.4" /><circle cx="17" cy="20" r="1.4" /><path d="M3 4h2.4l2.2 11h10.7L21 8H6" /></>),
  compass: (<><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-1.9 5.1-5.1 1.9 1.9-5.1z" /></>),
  search: (<><circle cx="11" cy="11" r="7" /><path d="m20.5 20.5-4.2-4.2" /></>),
  logout: (<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>),

  /* ── Status + actions ───────────────────────────────────────── */
  check: <path d="m5 13 4.5 4.5L19.5 6.5" />,
  "check-circle": (<><circle cx="12" cy="12" r="9" /><path d="m8.3 12.4 2.6 2.6 5-5.4" /></>),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  "arrow-left": <path d="M20 12H5m6 7-7-7 7-7" />,
  "alert-triangle": (<><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.4v.2" /></>),
  "circle-alert": (<><circle cx="12" cy="12" r="9" /><path d="M12 7.8v5.4M12 16.6v.2" /></>),
  mail: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7.5 8.5 6 8.5-6" /></>),
  "help-circle": (<><circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.75.35-1 .85-1 1.7M12 16.8v.2" /></>),
  "cloud-off": (<><path d="M3 3l18 18" /><path d="M6.7 17.3A4.1 4.1 0 1 1 7.4 9a5.5 5.5 0 0 1 10.6 1.2 3.6 3.6 0 0 1 1.3 6.9" /></>),
};
