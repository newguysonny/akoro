/**
 * check-dhub-search.mjs — SSR render check for the Discover full-screen search.
 *
 * Checks the source-inspired layout and the product boundaries behind it:
 * recent searches, Continue learning and real-classmate loading surfaces when
 * blank; grouped topic/material/course results when typed; no fake folder
 * group; and a genuine no-match state once the async sources have settled.
 * Run from akoro-learner: node scripts/check-dhub-search.mjs
 */
import { createServer } from 'vite';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToString } = require('react-dom/server');

const store = {};
globalThis.localStorage = {
  getItem: (key) => (key in store ? store[key] : null),
  setItem: (key, value) => { store[key] = String(value); },
  removeItem: (key) => { delete store[key]; },
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
try { globalThis.navigator = { userAgent: 'node' }; } catch { /* Node ≥21 already has one */ }

const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const mod = await vite.ssrLoadModule('/src/components/tabs/DiscoverSearchPage.jsx');
  const DiscoverSearchPage = mod.default;
  const { pushRecent, matchCourse, matchRecord, matchClassmate, RECENTS_KEY } = mod;
  const { LanguageProvider } = await vite.ssrLoadModule('/src/contexts/LanguageContext.jsx');

  const clean = (html) => html.replaceAll('<!-- -->', '');
  const render = (props = {}) => clean(renderToString(
    React.createElement(LanguageProvider, null,
      React.createElement(DiscoverSearchPage, { onClose: () => {}, onPick: () => {}, ...props }))));
  const has = (html, value) => html.includes(value);
  let ok = true;
  const report = (name, pass) => { console.log(`  ${name.padEnd(32)} ${pass}`); ok &&= pass; };

  globalThis.localStorage.setItem(RECENTS_KEY, JSON.stringify([
    { q: 'pharmacy materials', scope: 'courses' },
    { q: 'clinical rotations', scope: 'search' },
  ]));
  const blank = render();
  const recentChecks = [
    ['dialog shell', has(blank, 'role="dialog"') && has(blank, 'aria-modal="true"')],
    ['source-inspired search shell', has(blank, 'dhub-search-shell') && has(blank, 'border-radius:50px')],
    ['back button', has(blank, 'aria-label="Close search"')],
    ['autofocus input', has(blank, 'autofocus=""') && has(blank, 'Search topics or jump to a section')],
    ['recent search rows', has(blank, 'Recent searches') && has(blank, 'pharmacy materials') && has(blank, 'clinical rotations')],
    ['recent source labels', has(blank, '>Courses<') && has(blank, '>Search<')],
    ['clear and dismiss controls', has(blank, 'Clear all') && (blank.match(/aria-label="Remove /g) || []).length === 2],
    ['continue loading surface', has(blank, 'Continue learning') && has(blank, 'dhub-search-skeleton')],
    ['classmate loading surface', has(blank, 'Your classmates') && has(blank, 'dhub-search-skeleton-wide')],
  ];
  for (const [name, pass] of recentChecks) report(name, pass);

  /* Legacy recents still become generic Search entries. */
  globalThis.localStorage.setItem(RECENTS_KEY, JSON.stringify(['old school strings']));
  const legacy = render({ initialLoading: false });
  report('legacy recents migrate', has(legacy, 'old school strings') && has(legacy, '>Search<'));

  /* Saved Higher Ed records are searched from the existing per-user local
     storage seam, not invented catalogue data. */
  globalThis.localStorage.setItem('akoro_records_learner-1', JSON.stringify([
    { id: 'notes-1', kind: 'paste', name: 'Pharmacology revision notes' },
  ]));
  const seededCourses = [
    { id: 1, slug: 'clinical-pharmacy-basics', title: 'Clinical Pharmacy Basics', subject: 'Pharmacy', _kind: 'video' },
    { id: 2, slug: 'roman-history', title: 'Roman History 101', subject: 'History', _kind: 'live' },
  ];
  const pharm = render({ initialQuery: 'pharm', userId: 'learner-1', initialCourses: seededCourses, initialLoading: false });
  report('grouped typed results',
    has(pharm, '>Topics<') && has(pharm, '>Your materials<') && has(pharm, '>Courses<')
      && has(pharm, 'Pharmacology revision notes') && has(pharm, 'Clinical Pharmacy Basics')
      && !has(pharm, 'Roman History 101'));
  report('no fake folder group', !has(pharm, '>Folders<'));

  const none = render({ initialQuery: 'zzzz-nope', initialCourses: seededCourses, initialLoading: false });
  report('settled no-match state', has(none, 'Nothing matches that search.') && has(none, 'Clear search'));

  const pushOk =
    JSON.stringify(pushRecent([{ q: 'a', scope: 'search' }], 'b', 'pharmd'))
      === JSON.stringify([{ q: 'b', scope: 'pharmd' }, { q: 'a', scope: 'search' }])
    && JSON.stringify(pushRecent([{ q: 'x', scope: 'search' }], 'x', 'courses'))
      === JSON.stringify([{ q: 'x', scope: 'courses' }])
    && JSON.stringify(pushRecent(['a'], ' a ', 'search'))
      === JSON.stringify([{ q: 'a', scope: 'search' }])
    && pushRecent(['1', '2', '3', '4', '5', '6', '7', '8'], '9', 'live').map((row) => row.q).join(',') === '9,1,2,3,4,5,6,7'
    && pushRecent(['a'], '   ').length === 1;
  report('pushRecent logic', pushOk);

  const matcherOk =
    matchCourse({ title: 'Clinical Pharmacy Basics', subject: 'Pharmacy' }, 'PHARM')
    && !matchCourse({ title: 'Roman History 101' }, 'pharm')
    && matchRecord({ name: 'Pharmacology revision notes', kind: 'paste' }, 'notes')
    && !matchRecord({ name: 'Calculus notes', kind: 'paste' }, 'pharm')
    && matchClassmate({ full_name: 'Ada Okafor', username: 'ada', className: 'Year 2' }, 'okafor')
    && !matchClassmate({ full_name: 'Ada Okafor' }, 'tunde');
  report('course, material, classmate matchers', matcherOk);

  console.log(ok ? 'SEARCH RENDER OK' : 'SEARCH RENDER FAILED');
  process.exitCode = ok ? 0 : 1;
} finally {
  await vite.close();
}
