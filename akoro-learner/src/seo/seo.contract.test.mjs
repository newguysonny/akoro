import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { main } from '../../scripts/seo-pages.mjs';
import { PAGES, LEGACY } from './pages.js';
import { TITLE, DESCRIPTION, SOCIALS, LOGO_PATH } from './site.js';

const TEMPLATE = '<!DOCTYPE html><html><head><title>Akoro — Learn</title></head><body><div id="root"></div></body></html>';
async function build(target, extra = {}) {
  const dist = await mkdtemp(path.join(os.tmpdir(), 'seo-'));
  await writeFile(path.join(dist, 'index.html'), TEMPLATE);
  const res = await main({ dist, target, env: { VITE_SITE_URL: 'https://akoro.ng/', ...extra.env }, fetchImpl: extra.fetchImpl });
  return { dist, res };
}
const read = (dist, p) => readFile(path.join(dist, p), 'utf8');
const one = (html, re) => (html.match(re) || [])[1];

test('identity words are exactly the agreed ones', () => {
  assert.equal(TITLE, 'Akoro: AI proteges for education and learning');
  assert.equal(DESCRIPTION, 'Akoro helps students learn by teaching AI agents, building knowledge through conversation, interactivity, practice, and feedback.');
  assert.ok(SOCIALS.every((s) => s.href.includes('akorohq_app')));
});

test('landing: every public page is real HTML — title, description, canonical, one H1, JSON-LD, text, no JavaScript needed', async () => {
  const { dist } = await build('landing');
  const titles = new Set();
  for (const p of PAGES) {
    const html = await read(dist, p.path === '/' ? 'index.html' : `${p.path.slice(1)}/index.html`);
    assert.equal(one(html, /<title>([^<]*)<\/title>/), p.title.replace(/&/g, '&amp;'), p.path);
    titles.add(p.title);
    assert.ok(html.includes(`content="${p.description}"`), `${p.path} description`);
    assert.ok(html.includes(`<link rel="canonical" href="https://akoro.ng${p.path === '/' ? '/' : p.path}" />`), `${p.path} canonical`);
    assert.match(html, /<meta name="robots" content="index, follow" \/>/);
    assert.equal((html.match(/<h1>/g) || []).length, 1, `${p.path} has exactly one H1`);
    assert.ok(html.includes(`<h1>${p.h1.replace(/&/g, '&amp;')}</h1>`.replace(/’/g, '’')), `${p.path} H1 in the raw HTML`);
    const ld = JSON.parse(one(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/));
    assert.ok(ld['@graph'].some((n) => n['@type'] === (p.type || 'WebPage')), `${p.path} has its page node`);
  }
  assert.equal(titles.size, PAGES.length, 'no two pages share a title');
});

test('home carries Organization (logo, sameAs) and WebSite (name, alternateName); /ai-protege a DefinedTerm', async () => {
  const { dist } = await build('landing');
  const g = JSON.parse(one(await read(dist, 'index.html'), /ld\+json">([\s\S]*?)<\/script>/))['@graph'];
  const org = g.find((n) => n['@type'] === 'Organization'), site = g.find((n) => n['@type'] === 'WebSite');
  assert.equal(org.logo, `https://akoro.ng${LOGO_PATH}`);
  assert.deepEqual(org.sameAs, SOCIALS.map((s) => s.href));
  assert.equal(site.name, 'Akoro');
  assert.ok(site.alternateName.some((n) => /protégés/.test(n)));
  const t = JSON.parse(one(await read(dist, 'ai-protege/index.html'), /ld\+json">([\s\S]*?)<\/script>/))['@graph'].find((n) => n['@type'] === 'DefinedTerm');
  assert.equal(t.name, 'AI protege');
});

test('landing: robots.txt and sitemap.xml are the real files; unknown URLs fall back to a noindex shell', async () => {
  const { dist } = await build('landing');
  assert.equal(await read(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: https://akoro.ng/sitemap.xml\n');
  const sm = await read(dist, 'sitemap.xml');
  assert.match(sm, /^<\?xml/);
  for (const p of PAGES) assert.ok(sm.includes(`<loc>https://akoro.ng${p.path === '/' ? '/' : p.path}</loc>`), p.path);
  assert.match(await read(dist, 'app-shell.html'), /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.doesNotMatch(await read(dist, 'app-shell.html'), /application\/ld\+json/);
});

test('landing: blog posts from the API get their own page, Article markup and a sitemap entry; the API being down is not fatal', async () => {
  const posts = [{ slug: 'learn-by-teaching', title: 'Learn by teaching', excerpt: 'Why teaching works.', author: 'Ada', published_at: '2026-10-01T10:00:00Z', image: 'https://img.example/x.jpg' }, { slug: '../evil', title: 'x' }];
  const ok = await build('landing', { env: { VITE_API_URL: 'https://api.example' }, fetchImpl: async (u) => { assert.match(u, /\/api\/content\/blog\/posts/); return { ok: true, json: async () => ({ data: posts }) }; } });
  assert.equal(ok.res.posts, 1, 'a slug that is not a plain slug is dropped');
  const html = await read(ok.dist, 'blog/learn-by-teaching/index.html');
  assert.match(html, /<title>Learn by teaching \| Akoro<\/title>/);
  assert.match(html, /"@type":"Article"/);
  assert.match(await read(ok.dist, 'blog/index.html'), /href="\/blog\/learn-by-teaching"/);
  assert.match(await read(ok.dist, 'sitemap.xml'), /blog\/learn-by-teaching<\/loc><lastmod>2026-10-01/);
  const down = await build('landing', { env: { VITE_API_URL: 'https://api.example' }, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(down.res.posts, 0);
  assert.equal(down.res.pages, PAGES.length);
});

test('app: noindex shell, allow-all robots, no marketing pages, no sitemap', async () => {
  const { dist } = await build('app');
  assert.match(await read(dist, 'app-shell.html'), /noindex/);
  assert.equal(await read(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  assert.deepEqual((await readdir(dist)).sort(), ['app-shell.html', 'index.html', 'robots.txt']);
});

test('renames: the three old addresses 301 to the new ones in vercel.json, and the SPA fallback is the noindex shell', async () => {
  const v = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(LEGACY, [['/student-info', '/for-students'], ['/instructor-info', '/for-teachers'], ['/school-info', '/for-schools']]);
  for (const [from, to] of LEGACY) assert.ok(v.redirects.some((r) => r.source === from && r.destination === to && r.permanent === true), from);
  assert.equal(v.rewrites.at(-1).destination, '/app-shell.html');
});

test('consoles are kept out of search: instructor and admin carry noindex; admin also disallows everything', async () => {
  const root = new URL('../../../', import.meta.url);
  for (const app of ['akoro-instructor', 'akoro-admin']) assert.match(await readFile(new URL(`${app}/index.html`, root), 'utf8'), /<meta name="robots" content="noindex, nofollow" \/>/, app);
  assert.equal(await readFile(new URL('akoro-admin/public/robots.txt', root), 'utf8'), 'User-agent: *\nDisallow: /\n');
});

test('prerender: the rendered React page becomes the page body; a page that fails to render falls back to the text snapshot', async () => {
  const dist = await mkdtemp(path.join(os.tmpdir(), 'seo-'));
  await writeFile(path.join(dist, 'index.html'), TEMPLATE);
  const res = await main({ dist, target: 'landing', env: { VITE_SITE_URL: 'https://akoro.ng' },
    renderRoute: async (p) => { if (p === '/about') throw new Error('boom'); if (p === '/terms') return '<div>no heading</div>'; return `<div id="x"><h1>Rendered ${p}</h1></div>`; } });
  assert.equal(res.rendered, PAGES.length - 2);
  assert.match(await read(dist, 'ai-protege/index.html'), /<h1>Rendered \/ai-protege<\/h1>/);
  assert.match(await read(dist, 'about/index.html'), /data-prerendered/);
  assert.match(await read(dist, 'terms/index.html'), /data-prerendered/);
});

test('llms.txt describes the site in its own words and links the real pages', async () => {
  const { dist } = await build('landing');
  const t = await read(dist, 'llms.txt');
  assert.match(t, /^# Akoro\n\n> Akoro helps students learn by teaching AI agents/);
  assert.match(t, /\(https:\/\/akoro\.ng\/ai-protege\)/);
  assert.match(t, /\(https:\/\/x\.com\/akorohq_app\)/);
  for (const [, to] of LEGACY) assert.ok(t.includes(`https://akoro.ng${to})`), to);
  assert.ok(!(await readdir((await build('app')).dist)).includes('llms.txt'), 'the app host has none');
});
