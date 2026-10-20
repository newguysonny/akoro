/**
 * uiMode.js — which look this browser sees: "legacy" (today's instructor app)
 * or "next" (the learner app's, from the shared UI kit). See
 * reference/Akoro Console Rebuild — Plan.md, "Old and new look side by side".
 *
 *   ?ui=next | ?ui=legacy   switch this browser (any case: ?UI=next works)
 *   ?ui=reset               back to the default
 *   default                 VITE_CONSOLE_UI, else "legacy"
 *
 * The choice is kept in localStorage, so it sticks while moving around the
 * app. Read once at start-up; switching is a page load with ?ui=.
 */
export const UI_KEY = 'akoro_console_ui';
const MODES = ['legacy', 'next'];

/** PURE: the mode for a query string, the stored choice and the build default. → { mode, store } */
export function pickUiMode(search, stored, fallback) {
  const def = MODES.includes(fallback) ? fallback : 'legacy';
  const asked = [...new URLSearchParams(search || '')].find(([k]) => k.toLowerCase() === 'ui')?.[1]?.trim().toLowerCase();
  if (MODES.includes(asked)) return { mode: asked, store: asked };
  if (asked === 'reset') return { mode: def, store: null };
  return { mode: MODES.includes(stored) ? stored : def, store: undefined };
}

function resolve() {
  if (typeof window === 'undefined') return 'legacy';
  let stored = null;
  try { stored = localStorage.getItem(UI_KEY); } catch { /* private mode */ }
  const { mode, store } = pickUiMode(window.location.search, stored, import.meta.env?.VITE_CONSOLE_UI);
  try {
    if (store === null) localStorage.removeItem(UI_KEY);
    else if (store) localStorage.setItem(UI_KEY, store);
  } catch { /* private mode: this page only */ }
  document.documentElement.setAttribute('data-ui', mode);
  return mode;
}

export const UI_MODE = resolve();
export const isNextUi = () => UI_MODE === 'next';
