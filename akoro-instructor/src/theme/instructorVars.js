/**
 * instructorVars.js — the few theme variables only the instructor app needs,
 * on top of the learner's set (src/ui/tokens.js): the older "Bachs" palette
 * names a few screens still use, and the loading placeholders. All point at
 * the learner tokens, so they follow light and dark.
 */
export const INSTRUCTOR_VARS = {
  '--ak-bx-primary': 'var(--ak-brand)',
  '--ak-bx-ink': 'var(--ak-text)',
  '--ak-bx-muted': 'var(--ak-text-sub)',
  '--ak-bx-border': 'var(--ak-border2)',
  '--ak-bx-bg': 'var(--ak-bg)',
  '--ak-bx-font': 'var(--ak-font)',
  '--ak-bx-track': 'var(--ak-border2)',
  // Loading placeholders (GlobalStyles .skeleton).
  '--ak-skel-1': 'var(--ak-border)',
  '--ak-skel-2': 'var(--ak-surface-hover)',
};
