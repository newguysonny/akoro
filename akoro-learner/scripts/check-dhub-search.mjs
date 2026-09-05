/**
 * check-dhub-search.mjs — SSR render check for the Discover
 * full-screen search page.
 * ─────────────────────────────────────────────────────────────
 * Renders DiscoverSearchPage on the server (no browser) and asserts
 * the structure that matters: dialog shell, back button, autofocused
 * input, recent searches (seeded + empty-hint variants), live
 * filtered results with tile gradients, the no-match empty state,
 * and the pushRecent history logic. Run from akoro-learner:
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
  const { pushRecent } = mod;
  const { LanguageProvider } = await vite.ssrLoadModule('/src/contexts/LanguageContext.jsx');

  const clean = (html) => html.replaceAll('<!-- -->', '');
  const render = (props = {}) => clean(renderToString(
    React.createElement(LanguageProvider, null,
      React.createElement(DiscoverSearchPage, { onClose: () => {}, onPick: () => {}, ...props }))));

  let ok = true;
  const report = (name, pass) => { console.log(`  ${name.padEnd(26)} ${pass}`); ok &&= pass; };

  /* Seed two recent searches, then render the blank-query state. */
  globalThis.localStorage.setItem('akoro.dhubRecents', JSON.stringify(['pharmacy materials', 'clinical rotations']));
  const html = render();
  const has = (s) => html.includes(s);

  const checks = [
    ['dialog shell',        has('role="dialog"') && has('aria-modal="true"')],
    ['back button',         has('aria-label="Close search"')],
    ['search input',        has('Search topics or jump to a section') && has('aria-label="Search Discover"')],
    ['full-screen fixed',   has('position:fixed') && has('inset:0')],
    ['recent header',       has('Recent searches')],
    ['recent items ×2',     has('pharmacy materials') && has('clinical rotations')],
    ['clear-all button',    has('Clear all')],
    ['remove buttons ×2',   (html.match(/aria-label="Remove /g) || []).length === 2],
  ];
  for (const [name, pass] of checks) report(name, pass);

  /* No recents at all → start-typing hint, section header hidden. */
  globalThis.localStorage.removeItem('akoro.dhubRecents');
  const fresh = render();
  const hintOk = fresh.includes('Start typing to search topics and sections') && !fresh.includes('Recent searches');
  report('no-recents hint', hintOk);

  /* Typed query → results over the types, recents out of the way. */
  const pharm = render({ initialQuery: 'pharm' });
  const resultsOk = pharm.includes('Pharm D') && pharm.includes('Results')
    && pharm.includes('linear-gradient(140deg,#14B8A6,#0C7E72)') && !pharm.includes('Recent searches');
  report('filtered results (pharm)', resultsOk);

  /* Gibberish query → no-match empty state + clear action. */
  const none = render({ initialQuery: 'zzzz-nope' });
  const noneOk = none.includes('Nothing matches that search.') && none.includes('Clear search');
  report('no-match empty state', noneOk);

  /* Recent-history logic: dedupe + trim + most-recent-first + cap. */
  const dedupeOk = JSON.stringify(pushRecent(['a', 'b'], ' b ')) === JSON.stringify(['b', 'a']);
  const capOk = pushRecent(['1', '2', '3', '4', '5', '6', '7', '8'], '9').join(',') === '9,1,2,3,4,5,6,7';
  const blankOk = JSON.stringify(pushRecent(['a'], '   ')) === JSON.stringify(['a']);
  report('pushRecent logic', dedupeOk && capOk && blankOk);

  console.log(ok ? 'SEARCH RENDER OK' : 'SEARCH RENDER FAILED');
  process.exitCode = ok ? 0 : 1;
} finally {
  await vite.close();
}
