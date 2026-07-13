/**
 * Vercel Edge Middleware — this deployment is the school ADMIN portal ONLY.
 *
 * Public school websites (the wildcard <slug>.akoro.name.ng subdomains and
 * verified custom domains) are served by the LEARNER deployment, which holds
 * the wildcard and renders tenant sites. So this app never tenant-routes:
 * every request passes through to the SPA, which renders the portal.
 *
 * This is what prevents the school's own domain (e.g.
 * akoro-school.akoro.name.ng) from being rewritten to the API's by-host
 * renderer and returning "No school website here". Previously the middleware
 * only treated *.vercel.app and a hardcoded PORTAL_HOSTS as portal, so the
 * real custom domain fell through to the tenant rewrite and 404'd.
 */
import { next } from '@vercel/edge';

export const config = { matcher: '/:path*' };

export default function middleware() {
  return next();
}
