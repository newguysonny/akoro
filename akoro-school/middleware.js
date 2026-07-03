/**
 * Vercel Edge Middleware — server-side multi-tenant routing.
 *
 * Runs at the edge before the static SPA is served:
 *   • Portal hosts (PORTAL_HOSTS / VITE_PORTAL_HOSTS, localhost, *.vercel.app)
 *     → fall through to the admin React app.
 *   • Any other hostname (wildcard <slug>.akoro.app subdomains or verified
 *     custom domains) → REWRITE to the API's by-host renderer, so the tenant's
 *     public site is served as real server-rendered HTML on the school's own
 *     domain — crawlers and social previews see the full page, no client JS
 *     needed. (main.jsx keeps a client-side fallback for non-Vercel hosting.)
 *
 * Env (Vercel project settings): PORTAL_HOSTS, API_URL — falls back to the
 * VITE_-prefixed equivalents already set for the build.
 */
import { next, rewrite } from '@vercel/edge';

export const config = { matcher: '/:path*' };

export default function middleware(request) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();

  const portalHosts = (process.env.PORTAL_HOSTS || process.env.VITE_PORTAL_HOSTS || 'school.akoro.app')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

  const isPortal =
    portalHosts.includes(host) ||
    host === 'localhost' || host === '127.0.0.1' ||
    host.endsWith('.vercel.app');

  if (isPortal) return next();

  // Tenant site: send /login (and /signin) to the real portal sign-in.
  if (url.pathname === '/login' || url.pathname === '/signin') {
    return Response.redirect(`https://${portalHosts[0]}/signin`, 307);
  }

  const api = (process.env.API_URL || process.env.VITE_API_URL || 'https://akoro.app').replace(/\/$/, '');

  // Public portal pages live on the tenant domain: /apply, /pay (+ /pay/init,
  // /pay/verify), /results. Forward path + query (Paystack's ?reference=…)
  // to the API's public portal, keeping the method (form POSTs included).
  if (/^\/(apply|pay|results)(\/|$)/.test(url.pathname)) {
    const qs = url.searchParams;
    qs.set('host', host);
    return rewrite(`${api}/api/school/public${url.pathname}?${qs.toString()}`);
  }

  // Everything else on a tenant host renders through the site: "/" is the
  // landing page, "/<slug>" resolves to a published Website Builder page.
  return rewrite(`${api}/api/school/site/by-host?host=${encodeURIComponent(host)}&path=${encodeURIComponent(url.pathname)}`);
}
