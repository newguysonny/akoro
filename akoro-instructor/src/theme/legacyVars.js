/**
 * legacyVars.js — the shared theme variables set to today's instructor look,
 * so a page migrated to var(--ak-*) looks exactly as before while the switch
 * is on "legacy". Values from constants.js (light only; legacy has no dark).
 */
import { AMBER, BORDER, INK, LIGHT, MUTED, MUTED2, WHITE } from '../constants.js';

export const LEGACY_VARS = {
  '--ak-bg': LIGHT,
  '--ak-surface': WHITE,
  '--ak-surface-hover': LIGHT,
  '--ak-border': BORDER,
  '--ak-border2': BORDER,
  '--ak-border3': '#D9D2C7',
  '--ak-text': INK,
  '--ak-text-sec': INK,
  '--ak-text-sub': MUTED,
  '--ak-text-muted': MUTED2,
  '--ak-toggle-off': BORDER,
  '--ak-tag-bg': '#F3F4F6',
  '--ak-tag-text': INK,
  '--ak-select-bg': WHITE,
  '--ak-input-bg': WHITE,
  '--ak-overlay': 'rgba(26,26,46,0.45)',
  '--ak-success-text': '#047857',
  '--ak-warn-text': '#B45309',
  '--ak-danger-text': '#B91C1C',
  '--ak-brand': AMBER,
  '--ak-brand-soft': '#FFF7ED',
  '--ak-brand-deep': '#D4651E',
  '--ak-hero': INK,
  '--ak-font': "'DM Sans', sans-serif",
};

/*
 * The older "Bachs" palette a few screens still use (Layout.jsx, the Home
 * page): blue primary, Inter. Its own variables, so those screens stay exact
 * on legacy and take the learner look on next.
 */
export const BX_LEGACY = {
  '--ak-bx-primary': '#4A5CD5',
  '--ak-bx-ink': '#1A1B25',
  '--ak-bx-muted': '#6B7280',
  '--ak-bx-border': '#E8E8EE',
  '--ak-bx-bg': '#F7F7F9',
  '--ak-bx-font': 'Inter, system-ui, sans-serif',
  '--ak-bx-track': '#F1F1F4',
};
export const BX_NEXT = {
  '--ak-bx-primary': 'var(--ak-brand)',
  '--ak-bx-ink': 'var(--ak-text)',
  '--ak-bx-muted': 'var(--ak-text-sub)',
  '--ak-bx-border': 'var(--ak-border2)',
  '--ak-bx-bg': 'var(--ak-bg)',
  '--ak-bx-font': 'var(--ak-font)',
  '--ak-bx-track': 'var(--ak-border2)',
  // Loading placeholders (GlobalStyles .skeleton): unset on legacy, so its own colours stay.
  '--ak-skel-1': 'var(--ak-border)',
  '--ak-skel-2': 'var(--ak-surface-hover)',
};

export const legacyVars = () => ({ ...LEGACY_VARS, ...BX_LEGACY });
