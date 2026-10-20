/**
 * tokens.js — the Akoro look, as data: the brand colours and the learner
 * app's light and dark theme variables (copied from
 * akoro-learner/src/contexts/ThemeContext.jsx; a contract test keeps them
 * identical). Shared by every console through the UI kit
 * (reference/Akoro Console Rebuild — Plan.md).
 */
export const BRAND = '#6C3BFF';
export const RED   = '#EF4444';
export const GREEN = '#10B981';
export const GOLD  = '#F59E0B';
export const FONT  = "'Nunito', sans-serif";

export const LIGHT_VARS = {
  '--ak-bg':            '#F9FAFB',
  '--ak-surface':       '#ffffff',
  '--ak-surface-hover': '#F9FAFB',
  '--ak-border':        '#F3F4F6',
  '--ak-border2':       '#E5E7EB',
  '--ak-border3':       '#D1D5DB',
  '--ak-text':          '#111827',
  '--ak-text-sec':      '#374151',
  '--ak-text-sub':      '#6B7280',
  '--ak-text-muted':    '#9CA3AF',
  '--ak-toggle-off':    '#E5E7EB',
  '--ak-tag-bg':        '#F3F4F6',
  '--ak-tag-text':      '#374151',
  '--ak-select-bg':     '#F9FAFB',
  '--ak-input-bg':      '#ffffff',
  '--ak-overlay':       'rgba(0,0,0,0.45)',
  // Status TEXT — dark enough for light surfaces (bars use --ak-success etc.
  // from index.css for fills; these are for writing on them).
  '--ak-success-text':  '#047857',
  '--ak-warn-text':     '#B45309',
  '--ak-danger-text':   '#B91C1C',
};

export const DARK_VARS = {
  '--ak-bg':            '#0D1117',
  '--ak-surface':       '#161B22',
  '--ak-surface-hover': '#1C2128',
  '--ak-border':        '#21262D',
  '--ak-border2':       '#30363D',
  '--ak-border3':       '#484F58',
  '--ak-text':          '#E6EDF3',
  '--ak-text-sec':      '#C9D1D9',
  '--ak-text-sub':      '#8B949E',
  '--ak-text-muted':    '#6E7681',
  '--ak-toggle-off':    '#30363D',
  '--ak-tag-bg':        '#21262D',
  '--ak-tag-text':      '#C9D1D9',
  '--ak-select-bg':     '#0D1117',
  '--ak-input-bg':      '#0D1117',
  '--ak-overlay':       'rgba(0,0,0,0.65)',
  // Status TEXT — light enough for dark surfaces.
  '--ak-success-text':  '#34D399',
  '--ak-warn-text':     '#FBBF24',
  '--ak-danger-text':   '#F87171',
};

/** The variables every theme sets beyond the learner's: the brand, its tints and the font. */
export const BRAND_VARS = {
  '--ak-brand': BRAND,
  // A soft brand wash for chips and selected rows: on the surface, so it follows the theme.
  '--ak-brand-soft': 'color-mix(in srgb, var(--ak-brand) 10%, var(--ak-surface))',
  // The deeper end of a brand gradient (the learner's FAB: BRAND → #4C1DCC).
  '--ak-brand-deep': '#4C1DCC',
  // A dark feature card that stays dark in both themes.
  '--ak-hero': '#1E1550',
  '--ak-font': FONT,
};

/**
 * A see-through brand colour for backgrounds and borders:
 * tint(8) ≈ the learner's `${BRAND}14`. Works whatever --ak-brand is, so a
 * page looks right in every theme (hex-alpha strings can't follow a variable).
 */
export const tint = (percent, color = 'var(--ak-brand)') => `color-mix(in srgb, ${color} ${percent}%, transparent)`;
