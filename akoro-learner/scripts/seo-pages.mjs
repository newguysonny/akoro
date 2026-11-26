#!/usr/bin/env node
/**
 * seo-pages.mjs — runs after `vite build`. Makes the built site readable by crawlers that don't run JavaScript
 * (Google's first pass, AI crawlers, WhatsApp/LinkedIn/X link previews):
 *
 *   landing / full   dist/<route>/index.html for every public page (own title, description, canonical, Open Graph,
 *                    JSON-LD and a text snapshot in #root, replaced when the app mounts), blog posts fetched from the
 *                    API, robots.txt, sitemap.xml, and dist/app-shell.html — the noindex fallback the SPA rewrite serves
 *                    for every other URL (vercel.json).
 *   app              the shell and robots.txt only; the whole app host is noindex.
 *
 * Offline-safe: if the API can't be reached the posts are skipped and the rest still builds.
 * Env: VITE_TARGET, VITE_SITE_URL, VITE_API_URL.  Usage: node scripts/seo-pages.mjs [distDir]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PAGES, pageFor } from '../src/seo/pages.js';
import { BRAND, TITLE, DESCRIPTION, ENTITY, CONCEPT, DIFFERENCE, LOGO_PATH, SOCIALS, ALTERNATE_NAMES, siteUrl } from '../src/seo/site.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

/** The structured data for one page. Home carries the Organization and WebSite; every page refers to them by @id. */
export function graphFor({ page, base, url, post }) {
  const org = `${base}/#organization`, site = `${base}/#website`;
  const g = [];
  if (page.path === '/') {
    g.push({ '@type': 'Organization', '@id': org, name: BRAND, url: `${base}/`, logo: `${base}${LOGO_PATH}`, description: DESCRIPTION, sameAs: SOCIALS.map((s) => s.href) });
    g.push({ '@type': 'WebSite', '@id': site, name: BRAND, alternateName: ALTERNATE_NAMES, url: `${base}/`, publisher: { '@id': org } });
  }
  if (post) {
    g.push({
      '@type': 'Article', '@id': `${url}#article`, headline: post.title, description: post.excerpt || undefined,
      image: post.image ? [post.image] : undefined, datePublished: post.published_at || undefined,
      author: post.author ? { '@type': 'Person', name: post.author } : { '@id': org }, publisher: { '@id': org },
      mainEntityOfPage: { '@id': url }, isPartOf: { '@id': site },
    });
  } else {
    g.push({ '@type': page.type || 'WebPage', '@id': `${url}#webpage`, url, name: page.title, description: page.description, isPartOf: { '@id': site }, about: { '@id': org } });
  }
  if (page.term) {
    g.push({ '@type': 'DefinedTerm', '@id': `${url}#term`, name: page.term, alternateName: 'AI protégé', description: page.lead[0], inDefinedTermSet: `${base}/` , url });
  }
  // Breadcrumbs: Home › [parent] › page
  const trail = [];
  if (page.path !== '/') {
    trail.push(['Home', '/']);
    const parent = page.parent && page.parent !== '/' ? pageFor(page.parent) : null;
    if (parent) trail.push([parent.h1, parent.path]);
    if (post) trail.push(['Blog', '/blog']);
    trail.push([post ? post.title : page.h1, page.path]);
    g.push({ '@type': 'BreadcrumbList', itemListElement: trail.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${base}${p === '/' ? '/' : p}` })) });
  }
  return { '@context': 'https://schema.org', '@graph': g };
}

/** The text a crawler reads when it doesn't run JavaScript. The app replaces it as soon as it mounts. */
function snapshot(page, extra = []) {
  const parts = [`<h1>${esc(page.h1)}</h1>`];
  for (const p of page.lead || []) parts.push(`<p>${esc(p)}</p>`);
  for (const s of page.sections || []) {
    parts.push(`<h2>${esc(s.h2)}</h2>`);
    for (const p of s.p || []) parts.push(`<p>${esc(p)}</p>`);
    if (s.list?.length) parts.push(`<ul>${s.list.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`);
  }
  const links = [...(page.links || []), ...extra];
  if (links.length) parts.push(`<nav aria-label="Akoro pages"><ul>${links.map(([t, h]) => `<li><a href="${esc(h)}">${esc(t)}</a></li>`).join('')}</ul></nav>`);
  return `<main data-prerendered style="font-family:'Nunito',system-ui,sans-serif;max-width:720px;margin:0 auto;padding:72px 24px;line-height:1.6">${parts.join('')}</main>`;
}

function headTags({ title, description, url, robots, image, type = 'website', graph }) {
  return [
    `<meta name="description" content="${esc(description)}" />`,
    robots && `<meta name="robots" content="${robots}" />`,
    url && `<link rel="canonical" href="${esc(url)}" />`,
    url && `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:site_name" content="${BRAND}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    image && `<meta property="og:image" content="${esc(image)}" />`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    image && `<meta name="twitter:image" content="${esc(image)}" />`,
    graph && `<script type="application/ld+json">${jsonLd(graph)}</script>`,
  ].filter(Boolean).join('\n    ');
}

/** Template (the built index.html) → one page. */
export function render(template, { title, description, url, robots, image, type, graph, body }) {
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="(?:description|robots)"[^>]*>\s*/g, '')
    .replace(/<link rel="canonical"[^>]*>\s*/g, '')
    .replace('</head>', `    ${headTags({ title, description, url, robots, image, type, graph })}\n  </head>`);
  if (body) html = html.replace(/<div id="root"><\/div>/, `<div id="root">${body}</div>`);
  return html;
}

async function fetchPosts(api, fetchImpl = globalThis.fetch) {
  if (!api) return [];
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetchImpl(`${api}/api/content/blog/posts?limit=100`, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return (Array.isArray(j?.data) ? j.data : []).filter((p) => p && /^[a-z0-9][a-z0-9-]*$/i.test(p.slug || '') && p.title);
  } catch (e) {
    console.warn(`seo: blog posts skipped (${e.message}) — the blog page and pages already built are unaffected`);
    return [];
  } finally { clearTimeout(t); }
}

/** Builds src/seo/ssr-entry.jsx (the real React pages) and returns renderRoute(url) → HTML. Browser globals the app reads at import time are stubbed. */
export async function loadRenderer() {
  const { build } = await import('vite');
  await build({ logLevel: 'warn', build: { ssr: 'src/seo/ssr-entry.jsx', outDir: '.ssr', emptyOutDir: true, copyPublicDir: false } });
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } }; };
  const noop = () => {};
  const el = () => new Proxy(function () {}, { get: (_t, k) => (k === 'style' ? { setProperty: noop, removeProperty: noop } : k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false } : k === 'dataset' ? {} : k === 'children' || k === 'childNodes' ? [] : noop), set: () => true, apply: () => el() });
  Object.assign(globalThis, {
    localStorage: mem(), sessionStorage: mem(), window: globalThis, addEventListener: noop, removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    document: { documentElement: el(), body: el(), head: el(), createElement: el, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener: noop, removeEventListener: noop, cookie: '', readyState: 'complete' },
    location: { pathname: '/', search: '', hash: '', href: 'https://www.akoro.ng/', origin: 'https://www.akoro.ng', hostname: 'www.akoro.ng', protocol: 'https:' },
  });
  return (await import(pathToFileURL(path.resolve('.ssr/ssr-entry.js')).href)).renderRoute;
}

/** llms.txt: a plain-text description of the site for AI tools that read it. Same words as the site; no ranking promise. */
export function llmsTxt(base, posts = []) {
  const link = (p) => `- [${p.h1}](${base}${p.path}): ${p.description}`;
  const byPath = (...ps) => ps.map((x) => PAGES.find((p) => p.path === x)).filter(Boolean);
  return [
    `# ${BRAND}`, '', `> ${DESCRIPTION}`, '',
    `${ENTITY} ${CONCEPT} ${DIFFERENCE}`, '',
    '## Learn about Akoro', ...byPath('/ai-protege', '/how-it-works', '/about').map(link), '',
    '## For', ...byPath('/for-students', '/for-teachers', '/for-schools', '/exam-prep').map(link), '',
    '## More', ...byPath('/pricing', '/compare', '/partners', '/contact', '/privacy', '/terms').map(link), '',
    ...(posts.length ? ['## Blog', ...posts.slice(0, 20).map((p) => `- [${p.title}](${base}/blog/${p.slug})${p.excerpt ? `: ${p.excerpt}` : ''}`), ''] : []),
    '## Profiles', ...SOCIALS.map((c) => `- [${c.label}](${c.href})`), '',
  ].join('\n');
}

const writePage = async (dist, route, html) => {
  const dir = route === '/' ? dist : path.join(dist, route);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), html);
};

export async function main({ dist = 'dist', target = 'full', env = {}, fetchImpl, renderRoute } = {}) {
  const base = siteUrl(env);
  const template = await readFile(path.join(dist, 'index.html'), 'utf8');
  const noindex = (t) => render(t, { title: TITLE, description: DESCRIPTION, robots: 'noindex, nofollow' });

  // The fallback every non-generated URL gets: the app, not indexable.
  const shell = noindex(template);
  await writeFile(path.join(dist, 'app-shell.html'), shell);

  if (target === 'app') {
    // index.html itself already carries noindex (vite.config.js adds it before the service worker precaches it)
    await writeFile(path.join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n');   // allowed on purpose: a crawler must fetch a page to see its noindex
    return { pages: 0, posts: 0 };
  }

  const posts = await fetchPosts(String(env.VITE_API_URL || '').replace(/\/+$/, ''), fetchImpl);
  const urls = [];
  let rendered = 0;
  for (const page of PAGES) {
    const url = `${base}${page.path === '/' ? '/' : page.path}`;
    const extra = page.path === '/blog' ? posts.map((p) => [p.title, `/blog/${p.slug}`]) : [];
    // The real page, rendered by React; the text snapshot only if that page can't be rendered (the build never fails over it).
    let body;
    if (renderRoute) {
      try {
        body = await renderRoute(page.path);
        if (!/<h1[\s>]/.test(body)) throw new Error('no <h1> in the rendered page');
        if (extra.length) body += `<nav aria-label="Articles"><ul>${extra.map(([t, h]) => `<li><a href="${esc(h)}">${esc(t)}</a></li>`).join('')}</ul></nav>`;
        rendered++;
      } catch (e) { console.warn(`seo: ${page.path} not prerendered (${e.message}) — using the text snapshot`); body = undefined; }
    }
    await writePage(dist, page.path, render(template, {
      title: page.title, description: page.description, url, robots: 'index, follow', image: `${base}${LOGO_PATH}`,
      graph: graphFor({ page, base, url }), body: body ?? snapshot(page, extra),
    }));
    urls.push({ loc: url });
  }
  for (const p of posts) {
    const route = `/blog/${p.slug}`, url = `${base}${route}`;
    const page = { path: route, title: `${p.title} | Akoro`, h1: p.title, description: p.excerpt || DESCRIPTION, type: 'Article', parent: '/blog', lead: p.excerpt ? [p.excerpt] : [], links: [['All articles', '/blog'], ['What is an AI protege?', '/ai-protege']] };
    await writePage(dist, route, render(template, {
      title: page.title, description: page.description, url, robots: 'index, follow', image: p.image || `${base}${LOGO_PATH}`, type: 'article',
      graph: graphFor({ page, base, url, post: p }), body: snapshot(page),
    }));
    urls.push({ loc: url, lastmod: p.published_at ? new Date(p.published_at).toISOString().slice(0, 10) : undefined });
  }

  await writeFile(path.join(dist, 'llms.txt'), llmsTxt(base, posts));
  await writeFile(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);
  await writeFile(path.join(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n') + `\n</urlset>\n`);
  console.log(`seo: ${PAGES.length} pages (${rendered} prerendered by React) + ${posts.length} posts, robots.txt, sitemap.xml (${base})`);
  return { pages: PAGES.length, posts: posts.length, rendered };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = { ...process.env };
  const target = ['landing', 'app'].includes(env.VITE_TARGET) ? env.VITE_TARGET : 'full';
  (async () => main({ dist: process.argv[2] || 'dist', target, env, renderRoute: target === 'app' ? undefined : await loadRenderer().catch((e) => { console.warn(`seo: React prerender unavailable (${e.message}) — using text snapshots`); return undefined; }) }))()
    .catch((e) => { console.error('seo-pages failed:', e); process.exit(1); });
}
