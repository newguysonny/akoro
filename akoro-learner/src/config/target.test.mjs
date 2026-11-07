import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ownerOf, whereTo, APP_URL, SITE_URL, TARGET } from './target.js';

test('defaults: a plain build is "full" and the two sites are the agreed hosts', () => {
  assert.equal(TARGET, 'full');
  assert.equal(SITE_URL, 'https://akoro.name.ng');
  assert.equal(APP_URL, 'https://app.akoro.name.ng');
});

test('ownerOf: marketing paths belong to the site, product paths to the app, the rest is unknown', () => {
  for (const p of ['/', '/pricing', '/about', '/contact', '/careers', '/partners', '/compare', '/apply', '/privacy', '/terms', '/instructor-info', '/student-info', '/school-info', '/blog', '/blog/how-to-study', '/pricing/']) assert.equal(ownerOf(p), 'site', p);
  for (const p of ['/app', '/signin', '/signup', '/forgot-password', '/reset-password', '/auth/callback', '/join/abc', '/onboarding', '/settings', '/settings/agent/memory', '/activities/1', '/gradebook', '/library', '/communities/x/people', '/wallet', '/checkout', '/orders', '/upgrade', '/course/maths', '/write/blog/new', '/agent/5', '/cart', '/notifications']) assert.equal(ownerOf(p), 'app', p);
  for (const p of ['/nope', '/blogs', '/pricing-old', '/appx']) assert.equal(ownerOf(p), 'unknown', p);
});

test('whereTo: a full build answers for everything', () => {
  for (const p of ['/', '/pricing', '/signin', '/nope']) assert.equal(whereTo('full', p), p === '/nope' ? 'here' : 'here');
});

test('whereTo landing: marketing here, product paths go to the app with their query and hash, unknown is a 404', () => {
  assert.equal(whereTo('landing', '/'), 'here');
  assert.equal(whereTo('landing', '/blog/post-1'), 'here');
  assert.deepEqual(whereTo('landing', '/signin', '?next=%2Fapp', ''), { to: 'https://app.akoro.name.ng/signin?next=%2Fapp' });
  assert.deepEqual(whereTo('landing', '/join/tok123'), { to: 'https://app.akoro.name.ng/join/tok123' });
  assert.deepEqual(whereTo('landing', '/reset-password', '?token=t'), { to: 'https://app.akoro.name.ng/reset-password?token=t' });
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
  assert.match(app, /const site = TARGET !== 'app'/);
  assert.match(app, /const product = TARGET !== 'landing'/);
  assert.match(app, /<Route path="\/" element=\{TARGET === 'app' \? <AppHome \/> : <LandingPage \/>\}\/>/);
  assert.match(app, /<Route path="\*" element=\{<OtherSite \/>\}\/>/);
  for (const marketing of ['/pricing', '/about', '/blog', '/blog/:slug', '/privacy']) assert.match(app, new RegExp(`\\{site && <Route path="${marketing}"`), marketing);
  for (const productPath of ['/app', '/signin', '/signup', '/settings/*', '/upgrade', '/write/blog/new']) assert.match(app, new RegExp(`\\{product && <Route path="${productPath.replace(/[/*]/g, '\\$&')}"`), productPath);
  const vite = await readFile(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /disable: LANDING/);
  const sh = await readFile(new URL('../../scripts/build-with-chat.sh', import.meta.url), 'utf8');
  assert.match(sh, /landing\|app\)/);
  const main = await readFile(new URL('../main.jsx', import.meta.url), 'utf8');
  assert.match(main, /\(www\|api\|app\)\\\./);   // the tenant guard's base domain ignores a leading app.
});
