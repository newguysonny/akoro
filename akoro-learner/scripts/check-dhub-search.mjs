/**
 * check-dhub-search.mjs — SSR render check for the Discover
 * full-screen search page.
 * ─────────────────────────────────────────────────────────────
 * Renders DiscoverSearchPage on the server (no browser) and asserts
 * the structure that matters: dialog shell, back button, autofocused
 * input, SCOPE-TAGGED recent searches (section chip/label vs 🔍
 * Search, incl. legacy string-array migration), the friendly
 * no-recents state with Try chips, LIVE course results (seeded via
 * initialCourses), type filtering, the no-match empty state, and the
 * pushRecent/matchCourse logic. Run from akoro-learner:
 *
 *   node scripts/check-dhub-search.mjs
 */
import { createServer } from 'vite';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToString } = require('react-dom/server');

/* Browser globals the component tree touches during import/render. */
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
globalThis.matchMedia = () => ({
  matches: false, media: '', onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
});
globalThis.window = {
  matchMedia: globalThis.matchMedia, localStorage: globalThis.localStorage,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, location: { href: '', pathname: '/' }, navigator: {},
};
globalThis.document = {
  documentElement: { style: { setProperty() {} } },
  body: { style: {}, appendChild() {} },
  head: { appendChild() {} },
  getElementById: () => null,
  querySelector: () => null,
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {}, addEventListener() {} }),
  addEventListener() {}, removeEventListener() {},
};
try { globalThis.navigator = { userAgent: 'node' }; } catch { /* Node ≥21 has a read-only navigator — already fine */ }

const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const mod = await vite.ssrLoadModule('/src/components/tabs/DiscoverSearchPage.jsx');
  const DiscoverSearchPage = mod.default;
  const { pushRecent, matchCourse, RECENTS_KEY } = mod;
  const { LanguageProvider } = await vite.ssrLoadModule('/src/contexts/LanguageContext.jsx');

  const clean = (html) => html.replaceAll('<!-- -->', '');
  const render = (props = {}) => clean(renderToString(
    React.createElement(LanguageProvider, null,
      React.createElement(DiscoverSearchPage, { onClose: () => {}, onPick: () => {}, ...props }))));

  let ok = true;
  const report = (name, pass) => { console.log(`  ${name.padEnd(28)} ${pass}`); ok &&= pass; };

  /* Seed two SCOPE-TAGGED recents, then render the blank-query state. */
  globalThis.localStorage.setItem(RECENTS_KEY, JSON.stringify([
    { q: 'pharmacy materials', scope: 'courses' },
    { q: 'clinical rotations', scope: 'search' },
  ]));
  const html = render();
  const has = (s) => html.includes(s);

  const checks = [
    ['dialog shell',          has('role="dialog"') && has('aria-modal="true"')],
    ['back button',           has('aria-label="Close search"')],
    ['search input',          has('Search topics or jump to a section') && has('aria-label="Search Discover"')],
    ['full-screen fixed',     has('position:fixed') && has('inset:0')],
    ['recent header',         has('Recent searches')],
    ['recent items ×2',       has('pharmacy materials') && has('clinical rotations')],
    ['scope tags + chips',    has('>Courses<') && has('>Search<') && has('linear-gradient(140deg,#F28C52,#DE5F26)')],
    ['clear-all button',      has('Clear all')],
    ['remove buttons ×2',     (html.match(/aria-label="Remove /g) || []).length === 2],
  ];
  for (const [name, pass] of checks) report(name, pass);

  /* Legacy recents (bare strings) still load, tagged 🔍 Search. */
  globalThis.localStorage.setItem(RECENTS_KEY, JSON.stringify(['old school strings']));
  const legacy = render();
  report('legacy recents migrate', legacy.includes('old school strings') && legacy.includes('>Search<'));

  /* No recents at all → friendly state + Try chips, section hidden. */
  globalThis.localStorage.removeItem(RECENTS_KEY);
  const fresh = render();
  report('no-recents friendly state',
    fresh.includes('No recent searches yet.') && fresh.includes('Try:')
      && fresh.includes('>Courses<') && !fresh.includes('Recent searches'));

  /* Typed query → live course rows first, matching types after. */
  const seededCourses = [
    { id: 1, slug: 'clinical-pharmacy-basics', title: 'Clinical Pharmacy Basics', subject: 'Pharmacy', _kind: 'video', price: 'Free' },
    { id: 2, slug: 'roman-history', title: 'Roman History 101', subject: 'History', _kind: 'live' },
  ];
  const pharm = render({ initialQuery: 'pharm', initialCourses: seededCourses });
  report('live course results',
    pharm.includes('Course results') && pharm.includes('Clinical Pharmacy Basics') && !pharm.includes('Roman History 101'));
  report('type results below', pharm.includes('Pharm D') && pharm.includes('Results') && !pharm.includes('Recent searches'));

  /* Gibberish query (and no matching courses) → no-match empty state. */
  const none = render({ initialQuery: 'zzzz-nope', initialCourses: seededCourses });
  report('no-match empty state', none.includes('Nothing matches that search.') && none.includes('Clear search'));

  /* Recent-history logic: scope tags, dedupe keeps newest scope, legacy
     inputs, cap, blank rejection. */
  const pushOk =
    JSON.stringify(pushRecent([{ q: 'a', scope: 'search' }], 'b', 'pharmd'))
      === JSON.stringify([{ q: 'b', scope: 'pharmd' }, { q: 'a', scope: 'search' }])
    && JSON.stringify(pushRecent([{ q: 'x', scope: 'search' }], 'x', 'courses'))
      === JSON.stringify([{ q: 'x', scope: 'courses' }])
    && JSON.stringify(pushRecent(['a'], ' a ', 'search'))
      === JSON.stringify([{ q: 'a', scope: 'search' }])
    && pushRecent(['1', '2', '3', '4', '5', '6', '7', '8'], '9', 'live').map((r) => r.q).join(',') === '9,1,2,3,4,5,6,7'
    && pushRecent(['a'], '   ').length === 1;
  report('pushRecent logic', pushOk);

  /* Live course matcher: title/subject, case-insensitive, blank-safe. */
  const mcOk =
    matchCourse({ title: 'Clinical Pharmacy Basics', subject: 'Pharmacy' }, 'PHARM')
    && matchCourse({ title: 'X', subject: 'Pharmacology' }, 'pharm')
    && !matchCourse({ title: 'Roman History 101' }, 'pharm')
    && !matchCourse({ title: 'Anything' }, '   ');
  report('matchCourse logic', mcOk);

  console.log(ok ? 'SEARCH RENDER OK' : 'SEARCH RENDER FAILED');
  process.exitCode = ok ? 0 : 1;
} finally {
  await vite.close();
}
