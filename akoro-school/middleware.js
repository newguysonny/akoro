/**
 * Vercel Edge Middleware — serve a tenant's school website AS HTML from the
 * edge, instead of booting the React shell and fetching it in the browser.
 *
 * Before: every school page downloaded the app bundle, then fetched the
 * rendered 80 KB document and `document.write`-ed it → a long blank screen.
 * Now: a candidate tenant host is proxied straight to the API renderer, so the
 * browser's first paint is the school page. Portal hosts, assets, the AI chat
 * build and the public apply/pay/results pages are untouched.
 */
import { next } from '@vercel/edge';
import { classifyHost, siteHostConfig } from './src/utils/siteHost.js';

export const config = { matcher: '/:path*' };

const API = String(process.env.VITE_API_URL || 'https://api.akoro.ng').replace(/akoro\.name\.ng/gi, 'akoro.ng').replace(/\/+$/, '');
const PASSTHROUGH = /^\/(?:assets|logo|ai-chat|_vercel|favicon\.ico|apple-touch-icon|manifest\.webmanifest|robots\.txt|sitemap[^/]*\.xml|sw\.js|workbox[^/]*\.js)(?:\/|$)/i;
const PUBLIC_PORTAL = /^\/(?:apply|pay|results)(?:\/|$)/i;

const hasFileExtension = (pathname) => /\.[a-z0-9]{2,6}$/i.test(pathname);

export default async function middleware(req) {
  const url = new URL(req.url);
  const host = url.hostname.toLowerCase();
  const cfg = siteHostConfig(process.env);
  const candidate = classifyHost(host, cfg) === 'candidate';

  if (!candidate) return next();
  if (PASSTHROUGH.test(url.pathname) || PUBLIC_PORTAL.test(url.pathname) || hasFileExtension(url.pathname)) return next();

  try {
    const target = `${API}/api/school/site/by-host?host=${encodeURIComponent(host)}&path=${encodeURIComponent(url.pathname + url.search)}`;
    const res = await fetch(target, { headers: { "x-forwarded-host": host } });
    if (res.status === 404) return next();   // not a school host after all → portal
    const headers = new Headers();
    for (const name of ["content-type", "cache-control", "cdn-cache-control", "etag", "vary"]) {
      const value = res.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has("content-type")) headers.set("content-type", "text/html; charset=utf-8");
    return new Response(res.body, { status: res.status, headers });
  } catch {
    return next();   // API blip: fall back to the SPA's own retry path
  }
}
