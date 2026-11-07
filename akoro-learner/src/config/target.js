/**
 * target.js — which site this build is. One codebase, two deployments:
 *
 *   landing  akoro.name.ng      marketing pages (home, pricing, about, blog, legal …) — no sign-in, no PWA
 *   app      app.akoro.name.ng  the learner product: sign-in/up, onboarding, the dashboard and everything signed-in
 *   full     (default)          both, as before — local dev and any deployment that hasn't been split yet
 *
 * Chosen at build time by VITE_TARGET. Each target answers for its own paths; a path that belongs to the other site
 * is sent there (old links keep working): /signin typed on the landing → the app; /pricing typed on the app → the landing.
 * Everything here is pure, so the routing decision is unit-tested.
 */
const RAW = typeof import.meta !== 'undefined' ? import.meta.env || {} : {};
export const TARGET = ['landing', 'app'].includes(RAW.VITE_TARGET) ? RAW.VITE_TARGET : 'full';
const trim = (u) => String(u || '').replace(/\/+$/, '');
export const APP_URL = trim(RAW.VITE_APP_URL) || 'https://app.akoro.name.ng';
export const SITE_URL = trim(RAW.VITE_SITE_URL) || 'https://akoro.name.ng';

/** Marketing paths — the landing's. (Learner-authored blogs, /write/blog/*, are the app's.) */
const MARKETING = [
  /^\/$/, /^\/pricing\/?$/, /^\/about\/?$/, /^\/contact\/?$/, /^\/careers\/?$/, /^\/partners\/?$/, /^\/compare\/?$/, /^\/apply\/?$/,
  /^\/privacy\/?$/, /^\/terms\/?$/, /^\/instructor-info\/?$/, /^\/student-info\/?$/, /^\/school-info\/?$/,
  /^\/blog(\/[^/]+)?\/?$/,
];
/** First path segments that belong to the app. */
const APP_SEGMENTS = new Set([
  'app', 'signin', 'signup', 'forgot-password', 'reset-password', 'auth', 'join', 'onboarding', 'settings', 'notifications', 'activities',
  'gradebook', 'library', 'communities', 'draw', 'assessment', 'course', 'agent', 'cart', 'wallet', 'checkout', 'orders', 'upgrade', 'write', 'fde-admin', 'dev',
]);

/** Which site owns this path: 'site' (landing), 'app', or 'unknown'. */
export function ownerOf(pathname) {
  const p = String(pathname || '/');
  if (MARKETING.some((re) => re.test(p))) return 'site';
  const seg = p.split('/')[1] || '';
  return APP_SEGMENTS.has(seg) ? 'app' : 'unknown';
}

/**
 * What this build does with `pathname`: 'here' (render it), 'unknown' (not found), or { to } (the other site's absolute URL).
 * A full build answers for everything. '/' on the app is the app's own entry (it forwards to the dashboard or sign-in).
 */
export function whereTo(target, pathname, search = '', hash = '') {
  if (target === 'full') return 'here';
  const owner = ownerOf(pathname);
  if (owner === 'unknown') return 'unknown';
  if (target === 'landing') return owner === 'site' ? 'here' : { to: `${APP_URL}${pathname}${search}${hash}` };
  // the app: '/' stays here (entry); every other marketing path belongs to the landing
  if (owner === 'app' || pathname === '/') return 'here';
  return { to: `${SITE_URL}${pathname}${search}${hash}` };
}
