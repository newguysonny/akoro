/**
 * Vercel Edge Middleware — pass-through. This deployment serves the school PORTAL and the schools' public websites
 * (the wildcard <slug>.akoro.name.ng and verified custom domains); which one a request gets is decided in the browser
 * entry (src/main.jsx → utils/siteHost.js), so every request reaches the SPA. A host no school owns falls back to the
 * portal there — the portal's own domain can never end up on a "no school website here" page.
 */
import { next } from '@vercel/edge';

export const config = { matcher: '/:path*' };

export default function middleware() {
  return next();
}
