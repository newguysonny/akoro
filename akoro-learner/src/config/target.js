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
import { APP_URL, SITE_URL } from './urls.js';
export { APP_URL, SITE_URL };
const RAW = typeof import.meta !== 'undefined' ? import.meta.env || {} : {};
export const TARGET = ['landing', 'app'].includes(RAW.VITE_TARGET) ? RAW.VITE_TARGET : 'full';

/** Where the signed-in learner's home is: the app site's own root ("/"), and "/app" on a full (unsplit) build where "/" is the landing.
 *  "/app" stays a valid address everywhere — old links, notifications and emails use it; the app forwards it to "/". */
export const homeFor = (target) => (target === 'app' ? '/' : '/app');
export const APP_HOME = homeFor(TARGET);

/** Marketing paths — the landing's. (Learner-authored blogs, /write/blog/*, are the app's.) */
const MARKETING = [
  /^\/$/, /^\/pricing\/?$/, /^\/about\/?$/, /^\/contact\/?$/, /^\/careers\/?$/, /^\/partners\/?$/, /^\/compare\/?$/, /^\/apply\/?$/,
  /^\/privacy\/?$/, /^\/terms\/?$/, /^\/instructor-info\/?$/, /^\/student-info\/?$/, /^\/school-info\/?$/,
  /^\/for-teachers\/?$/, /^\/for-students\/?$/, /^\/for-schools\/?$/, /^\/ai-protege\/?$/, /^\/how-it-works\/?$/, /^\/exam-prep\/?$/,
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
  // the landing forwards the old "/app" address to the app's root
  if (target === 'landing') {
    if (/^\/app\/?$/.test(pathname)) return { to: `${APP_URL}/${search}${hash}` };
    return owner === 'site' ? 'here' : { to: `${APP_URL}${pathname}${search}${hash}` };
  }
  // the app: '/' is the dashboard; '/app' is the old address of it (forwarded to '/'); every other marketing path belongs to the landing
  if (owner === 'app' || pathname === '/') return 'here';
  return { to: `${SITE_URL}${pathname}${search}${hash}` };
}
