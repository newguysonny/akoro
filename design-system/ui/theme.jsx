/**
 * theme.jsx — the kit's theme provider: light / dark / system, applied as
 * CSS variables on <html> before the first paint (no flash). The same
 * storage key and values as the learner app's ThemeContext.
 *
 *   applyTheme(mode, { vars })     set the variables now
 *   <ThemeProvider vars={…}>       keeps them in step with the mode and the OS
 *   useTheme()                     { displayMode, isDark, setMode }
 *
 * `vars(isDark)` lets an app supply its own set (a console's legacy look);
 * the default is the learner's.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BRAND_VARS, DARK_VARS, LIGHT_VARS } from './tokens.js';

export const LS_DISPLAY = 'akoro_display_mode';
export const readMode = () => { try { return localStorage.getItem(LS_DISPLAY) || 'system'; } catch { return 'system'; } };

export const learnerVars = (isDark) => ({ ...(isDark ? DARK_VARS : LIGHT_VARS), ...BRAND_VARS });

export function resolveIsDark(mode) {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(mode, { vars = learnerVars, dark = true } = {}) {
  const isDark = dark && resolveIsDark(mode);
  const root = document.documentElement;
  root.setAttribute('data-theme', isDark ? 'dark' : 'light');
  for (const [k, v] of Object.entries(vars(isDark))) root.style.setProperty(k, v);
  document.body.style.background = 'var(--ak-bg)';
  return isDark;
}

const ThemeContext = createContext({ displayMode: 'light', isDark: false, setMode: () => {} });

/** dark: false keeps a theme light whatever the setting (a legacy look with no dark set). */
export function ThemeProvider({ children, vars = learnerVars, dark = true }) {
  const [displayMode, setDisplayMode] = useState(readMode);
  useEffect(() => { applyTheme(displayMode, { vars, dark }); }, [displayMode, vars, dark]);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const onChange = () => { if (displayMode === 'system') applyTheme('system', { vars, dark }); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [displayMode, vars, dark]);
  const setMode = useCallback((mode) => {
    try { localStorage.setItem(LS_DISPLAY, mode); } catch { /* private mode: this tab only */ }
    setDisplayMode(mode);
  }, []);
  return <ThemeContext.Provider value={{ displayMode, isDark: dark && resolveIsDark(displayMode), setMode }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
