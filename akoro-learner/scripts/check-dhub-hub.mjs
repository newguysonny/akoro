/**
 * check-dhub-hub.mjs — SSR render check for the Discover hub.
 * ─────────────────────────────────────────────────────────────
 * Renders DiscoverHub on the server (no browser) and asserts the
 * structure that matters: header, search, all five type cards,
 * Soon badges ×4, the Courses Browse pill, query filtering, and
 * the no-match empty state. Run from akoro-learner:
 *
 *   node scripts/check-dhub-hub.mjs
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
  addEventListener() {},
};
try { globalThis.navigator = { userAgent: 'node' }; } catch { /* Node ≥21 has a read-only navigator — already fine */ }

const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const { default: DiscoverHub } = await vite.ssrLoadModule('/src/components/tabs/DiscoverHub.jsx');
  const { LanguageProvider } = await vite.ssrLoadModule('/src/contexts/LanguageContext.jsx');

  const clean = (html) => html.replaceAll('<!-- -->', '');
  const render = (props = {}) => clean(renderToString(
    React.createElement(LanguageProvider, null,
      React.createElement(DiscoverHub, { onOpenCourses: () => {}, ...props }))));

  const html = render();
  const has = (s) => html.includes(s);
  const checks = [
    ['title + sub',          has('Discover') && has('Everything you can explore, in one place.')],
    ['search box',           has('Search topics or jump to a section')],
    ['card Notes/Materials', has('Notes/Materials')],
    ['card Courses',         has('>Courses<')],
    ['card Pharm D',         has('Pharm D')],
    ['card Teaching guide',  has('Teaching guide')],
    ['card Live classes',    has('Live classes')],
    ['Soon badges ×4',       html.split('>Soon<').length - 1 === 4],
    ['Browse CTA',           has('Browse')],
    ['escapes & in desc',    has('&amp;')],
    ['gradient tiles',       has('linear-gradient(140deg,#F28C52,#DE5F26)')],
    ['glass corner tile',    has('rotate(-14deg)')],
  ];
  let ok = true;
  for (const [name, pass] of checks) { console.log(`  ${name.padEnd(22)} ${pass}`); ok &&= pass; }

  // Filtering: "pharm" keeps only the Pharm D card.
  const pharm = render({ initialQuery: 'pharm' });
  const pharmOk = pharm.includes('Pharm D') && !pharm.includes('>Courses<');
  console.log(`  filtered (pharm)       ${pharmOk}`);
  ok &&= pharmOk;

  // Empty state: gibberish query → no-match message + clear button.
  const none = render({ initialQuery: 'zzzz-nope' });
  const noneOk = none.includes('Nothing matches that search.') && none.includes('Clear search');
  console.log(`  no-match empty state   ${noneOk}`);
  ok &&= noneOk;

  console.log(ok ? 'HUB RENDER OK' : 'HUB RENDER FAILED');
  process.exitCode = ok ? 0 : 1;
} finally {
  await vite.close();
}
