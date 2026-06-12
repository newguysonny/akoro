/**
 * ThemeContext — global dark/light/system mode + accent colour.
 *
 * Applies CSS custom properties to :root so every page and component
 * can use var(--ak-bg), var(--ak-surface), var(--ak-text), etc.
 *
 * The module-level call (bottom of file) applies the saved theme before
 * React's first paint, eliminating flash-of-wrong-theme on cold load.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const BRAND = '#6C3BFF';

export const LS_DISPLAY  = 'akoro_display_mode';
export const LS_ACCENT   = 'akoro_accent_color';

const LIGHT_VARS = {
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
};

const DARK_VARS = {
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
};

export function resolveIsDark(mode) {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(mode, accent) {
  const isDark = resolveIsDark(mode);
  const root = document.documentElement;
  root.setAttribute('data-theme', isDark ? 'dark' : 'light');
  const vars = isDark ? DARK_VARS : LIGHT_VARS;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  const ac = accent || BRAND;
  root.style.setProperty('--ak-accent', ac);
  // Also keep body background in sync so areas outside #root match
  document.body.style.background = isDark ? '#0D1117' : '#F9FAFB';
}

/* ── Apply immediately on module import (zero FOUC) ───────────── */
applyTheme(
  localStorage.getItem(LS_DISPLAY) || 'system',
  localStorage.getItem(LS_ACCENT)  || BRAND,
);

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [displayMode,  setDisplayMode]  = useState(() => localStorage.getItem(LS_DISPLAY) || 'system');
  const [accentColor,  setAccentColor]  = useState(() => localStorage.getItem(LS_ACCENT)  || BRAND);

  /* Re-apply whenever mode or accent changes */
  useEffect(() => {
    applyTheme(displayMode, accentColor);
  }, [displayMode, accentColor]);

  /* Track OS-level dark/light changes when mode === 'system' */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (displayMode === 'system') applyTheme('system', accentColor); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [displayMode, accentColor]);

  const setMode = useCallback((mode) => {
    localStorage.setItem(LS_DISPLAY, mode);
    setDisplayMode(mode);
  }, []);

  const setAccent = useCallback((color) => {
    localStorage.setItem(LS_ACCENT, color);
    setAccentColor(color);
  }, []);

  const isDark = resolveIsDark(displayMode);

  return (
    <ThemeContext.Provider value={{ displayMode, accentColor, isDark, setMode, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
