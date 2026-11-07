import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { classifyHost, baseHostOf, siteHostConfig, PUBLIC_PORTAL_PATH, RESERVED_SUBDOMAINS } from './siteHost.js';

const cfg = { baseDomains: ['akoro.name.ng'], portalHosts: ['akoro-school.akoro.name.ng', 'school.akoro.app'] };

test('baseHostOf: drops scheme, path, port and one leading www./api./app.', () => {
  assert.equal(baseHostOf('https://app.akoro.name.ng/x'), 'akoro.name.ng');
  assert.equal(baseHostOf('https://api.akoro.name.ng'), 'akoro.name.ng');
  assert.equal(baseHostOf('WWW.Akoro.Name.NG:443'), 'akoro.name.ng');
  assert.equal(baseHostOf('https://admin.akoro.name.ng'), 'admin.akoro.name.ng');
  assert.equal(baseHostOf(''), '');
});

test('portal hosts: localhost, vercel previews, the listed portal hosts, and our own names on the base domain', () => {
  for (const h of ['', 'localhost', 'localhost:5173', '127.0.0.1', 'school.localhost', 'akoro-school-git-x.vercel.app', 'akoro-school.akoro.name.ng', 'AKORO-SCHOOL.akoro.name.ng:443', 'school.akoro.app',
    'akoro.name.ng', 'www.akoro.name.ng', 'app.akoro.name.ng', 'admin.akoro.name.ng', 'instructors.akoro.name.ng', 'api.akoro.name.ng', 'school.akoro.name.ng']) {
    assert.equal(classifyHost(h, cfg), 'portal', h);
  }
});

test('candidates: a wildcard school subdomain or a custom domain is a school site to try', () => {
  for (const h of ['greenfield.akoro.name.ng', 'st-marys-college.akoro.name.ng', 'www.stmarys.edu.ng', 'stmarys.edu.ng', 'portal.greenfield-academy.com', 'a.b.akoro.name.ng', 'notakoro.name.ng']) {
    assert.equal(classifyHost(h, cfg), 'candidate', h);
  }
});

test('the app host moving to app.<base> and reserved names are never schools', () => {
  for (const sub of RESERVED_SUBDOMAINS) assert.equal(classifyHost(`${sub}.akoro.name.ng`, cfg), 'portal', sub);
});

test('config from env: base domain from the learner URL (app. ignored), default portal hosts, explicit lists win', () => {
  const a = siteHostConfig({ VITE_LEARNER_URL: 'https://app.akoro.name.ng' });
  assert.deepEqual(a.baseDomains, ['akoro.name.ng']);
  assert.ok(a.portalHosts.includes('akoro-school.akoro.name.ng'));
  const b = siteHostConfig({ VITE_SITE_BASE_DOMAIN: 'example.ng,example.com', VITE_PORTAL_HOSTS: 'portal.example.ng' });
  assert.deepEqual(b.baseDomains, ['example.ng', 'example.com']);
  assert.deepEqual(b.portalHosts, ['portal.example.ng']);
  assert.equal(classifyHost('portal.example.ng', b), 'portal');
  assert.equal(classifyHost('school1.example.com', b), 'candidate');
  assert.deepEqual(siteHostConfig({}).baseDomains, ['akoro.name.ng']);
});

test('the portal-only page families are forwarded to the API', () => {
  for (const p of ['/apply', '/apply/x', '/pay/123', '/results', '/results/abc']) assert.ok(PUBLIC_PORTAL_PATH.test(p), p);
  for (const p of ['/', '/applying', '/payments', '/about', '/ai-chat']) assert.ok(!PUBLIC_PORTAL_PATH.test(p), p);
});

test('wiring: main.jsx classifies the host, falls back to the portal on a 404 and loads the portal lazily; the build bundles the AI chat', async () => {
  const main = await readFile(new URL('../main.jsx', import.meta.url), 'utf8');
  assert.match(main, /classifyHost\(host, cfg\) === 'portal'/);
  assert.match(main, /if \(r\.status === 404\) \{ bootPortal\(\); return; \}/);
  assert.match(main, /import\('\.\/App\.jsx'\)/);
  assert.doesNotMatch(main, /^import App from/m);
  const vercel = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
  assert.equal(vercel.buildCommand, 'bash scripts/build-with-chat.sh');
  assert.equal(vercel.rewrites[0].source, '/ai-chat/:path*');
  assert.equal(vercel.rewrites[0].destination, '/ai-chat/chat.html');
  const sh = await readFile(new URL('../../scripts/build-with-chat.sh', import.meta.url), 'utf8');
  assert.match(sh, /npm run build:chat/);
  assert.match(sh, /cp -r dist-chat dist\/ai-chat/);
});
