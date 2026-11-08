import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ownerOf, whereTo, homeFor, APP_HOME, APP_URL, SITE_URL, TARGET } from './target.js';

test('defaults: a plain build is "full" and the two sites are the agreed hosts', () => {
  assert.equal(TARGET, 'full');
  assert.equal(SITE_URL, 'https://akoro.name.ng');
  assert.equal(APP_URL, 'https://app.akoro.name.ng');
});

test('ownerOf: marketing paths belong to the site, product paths to the app, the rest is unknown', () => {
  for (const p of ['/', '/pricing', '/about', '/contact', '/careers', '/partners', '/compare', '/apply', '/privacy', '/terms', '/instructor-info', '/student-info', '/school-info', '/for-students', '/for-teachers', '/for-schools', '/ai-protege', '/how-it-works', '/exam-prep', '/blog', '/blog/how-to-study', '/pricing/']) assert.equal(ownerOf(p), 'site', p);
  for (const p of ['/app', '/signin', '/signup', '/forgot-password', '/reset-password', '/auth/callback', '/join/abc', '/onboarding', '/settings', '/settings/agent/memory', '/activities/1', '/gradebook', '/library', '/communities/x/people', '/wallet', '/checkout', '/orders', '/upgrade', '/course/maths', '/write/blog/new', '/agent/5', '/cart', '/notifications']) assert.equal(ownerOf(p), 'app', p);
  for (const p of ['/nope', '/blogs', '/pricing-old', '/appx']) assert.equal(ownerOf(p), 'unknown', p);
});

test('whereTo: a full build answers for everything', () => {
  for (const p of ['/', '/pricing', '/signin', '/nope']) assert.equal(whereTo('full', p), p === '/nope' ? 'here' : 'here');
});

test('the learner home: "/" on the app site, "/app" on a full build; the default build keeps "/app"', () => {
  assert.equal(homeFor('app'), '/');
  assert.equal(homeFor('landing'), '/app');
  assert.equal(homeFor('full'), '/app');
  assert.equal(APP_HOME, '/app');   // the default (full) build
});

test('whereTo landing: marketing here, product paths go to the app with their query and hash, unknown is a 404', () => {
  assert.equal(whereTo('landing', '/'), 'here');
  assert.equal(whereTo('landing', '/blog/post-1'), 'here');
  assert.deepEqual(whereTo('landing', '/signin', '?next=%2Fapp', ''), { to: 'https://app.akoro.name.ng/signin?next=%2Fapp' });
  assert.deepEqual(whereTo('landing', '/join/tok123'), { to: 'https://app.akoro.name.ng/join/tok123' });
  assert.deepEqual(whereTo('landing', '/reset-password', '?token=t'), { to: 'https://app.akoro.name.ng/reset-password?token=t' });
  assert.deepEqual(whereTo('landing', '/app', '?tab=agent'), { to: 'https://app.akoro.name.ng/?tab=agent' });   // the old home address lands on the app's root
  assert.deepEqual(whereTo('landing', '/app'), { to: 'https://app.akoro.name.ng/' });
  assert.equal(whereTo('landing', '/nope'), 'unknown');
});

test('whereTo app: product here, "/" is the app entry, other marketing paths go to the landing, unknown is a 404', () => {
  assert.equal(whereTo('app', '/'), 'here');
  assert.equal(whereTo('app', '/app'), 'here');
  assert.equal(whereTo('app', '/signin'), 'here');
  assert.deepEqual(whereTo('app', '/pricing'), { to: 'https://akoro.name.ng/pricing' });
  assert.deepEqual(whereTo('app', '/blog/post-1', '?x=1'), { to: 'https://akoro.name.ng/blog/post-1?x=1' });
  assert.deepEqual(whereTo('app', '/privacy'), { to: 'https://akoro.name.ng/privacy' });
  assert.equal(whereTo('app', '/nope'), 'unknown');
});

test('wiring: App.jsx filters the routes by target and has the entry + other-site fallbacks; the landing build has no service worker; the build script skips the chat bundle', async () => {
  const app = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(app, /const SITE_BUILD    = import\.meta\.env\.VITE_TARGET !== 'app'/);
  assert.match(app, /const PRODUCT_BUILD = import\.meta\.env\.VITE_TARGET !== 'landing'/);
  assert.match(app, /const site = SITE_BUILD;/);
  assert.match(app, /const product = PRODUCT_BUILD;/);
  assert.match(app, /const AboutPage = SITE_BUILD \? lazyWithRetry/);
  assert.match(app, /const SigninPage = PRODUCT_BUILD \? lazyWithRetry/);
  assert.match(app, /<Route path="\*" element=\{<OtherSite \/>\}\/>/);
  for (const marketing of ['/pricing', '/about', '/blog', '/blog/:slug', '/privacy']) assert.match(app, new RegExp(`\\{site && <Route path="${marketing}"`), marketing);
  for (const productPath of ['/app', '/signin', '/signup', '/settings/*', '/upgrade', '/write/blog/new']) assert.match(app, new RegExp(`\\{product && <Route path="${productPath.replace(/[/*]/g, '\\$&')}"`), productPath);
  // the app site's "/" is the dashboard behind the sign-in gate; "/app" there forwards to "/" keeping the query
  assert.match(app, /<Route path="\/" element=\{TARGET === 'app' \? <ProtectedRoute><LearnerDashboard \/><\/ProtectedRoute> : <LandingPage \/>\}\/>/);
  assert.match(app, /<Route path="\/app" element=\{TARGET === 'app' \? <LegacyApp \/> : <ProtectedRoute><LearnerDashboard \/><\/ProtectedRoute>\}\/>/);
  assert.match(app, /function LegacyApp\(\) \{[\s\S]*?<Navigate to=\{`\/\$\{search\}\$\{hash\}`\} replace \/>/);
  assert.doesNotMatch(app, /function AppHome/);
  const vite = await readFile(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /disable: LANDING/);
  const sh = await readFile(new URL('../../scripts/build-with-chat.sh', import.meta.url), 'utf8');
  assert.match(sh, /landing\|app\)/);
  const main = await readFile(new URL('../main.jsx', import.meta.url), 'utf8');
  assert.match(main, /\(www\|api\|app\)\\\./);   // the tenant guard's base domain ignores a leading app.
});

test('no page spells "/app" as the learner home any more: they use APP_HOME (the deep links the API sends and the markdown whitelist keep "/app?…" on purpose)', async () => {
  const { readdir } = await import('node:fs/promises');
  const path = await import('node:path');
  const root = new URL('../', import.meta.url).pathname;
  const allowed = new Set(['App.jsx', 'config/target.js', 'components/common/richText.js', 'components/tabs/AgentChatTab.jsx']);
  const bad = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      if (!/\.(jsx?)$/.test(e.name) || /\.test\./.test(e.name)) continue;
      const rel = path.relative(root, p).replace(/\\/g, '/');
      if (allowed.has(rel)) continue;
      const src = (await readFile(p, 'utf8')).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      if (/['"`]\/app([?'"`/]|\$)/.test(src)) bad.push(rel);
    }
  }
  await walk(root);
  assert.deepEqual(bad, []);
});
