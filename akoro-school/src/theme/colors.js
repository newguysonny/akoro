/**
 * colors.js — the app's colour names. Each is a theme variable from the
 * learner app's set (light + dark). Use these instead of constants.js's AMBER, INK…
 * (reference/Akoro Console Rebuild — Plan.md, Phase 3 mapping):
 *
 *   AMBER → C.brand     INK → C.ink        MUTED → C.muted    MUTED2 → C.muted2
 *   BORDER → C.border   LIGHT → C.bg       WHITE (a surface) → C.surface
 *   FONT → C.font       `${AMBER}18` → tint(9)   `${X}44` → tint(27, X)
 *
 * White TEXT on a coloured button stays '#fff'. Status hues (GREEN, RED,
 * BLUE, PURPLE, GOLD) stay as they are — they read on light and dark.
 */
export { tint } from '../ui/tokens.js';

export const C = {
  brand: 'var(--ak-brand)',
  brandSoft: 'var(--ak-brand-soft)',
  brandDeep: 'var(--ak-brand-deep)',
  hero: 'var(--ak-hero)',
  ink: 'var(--ak-text)',
  ink2: 'var(--ak-text-sec)',
  muted: 'var(--ak-text-sub)',
  muted2: 'var(--ak-text-muted)',
  border: 'var(--ak-border2)',
  borderSoft: 'var(--ak-border)',
  bg: 'var(--ak-bg)',
  surface: 'var(--ak-surface)',
  hover: 'var(--ak-surface-hover)',
  overlay: 'var(--ak-overlay)',
  inputBg: 'var(--ak-input-bg)',
  tagBg: 'var(--ak-tag-bg)',
  font: 'var(--ak-font)',
  // The older "Bachs" palette names (a few screens): the learner tokens (instructorVars.js).
  bxPrimary: 'var(--ak-bx-primary)',
  bxInk: 'var(--ak-bx-ink)',
  bxMuted: 'var(--ak-bx-muted)',
  bxBorder: 'var(--ak-bx-border)',
  bxBg: 'var(--ak-bx-bg)',
  bxFont: 'var(--ak-bx-font)',
  bxTrack: 'var(--ak-bx-track)',
};

/** Hex alpha (the "44" in `${AMBER}44`) → the percent tint() takes. */
export const alphaPct = (hex2) => Math.round((parseInt(hex2, 16) / 255) * 100);
