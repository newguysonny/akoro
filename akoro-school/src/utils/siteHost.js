/**
 * siteHost.js — is this request for the school PORTAL (our admin app) or for a school's own PUBLIC website?
 *
 * This deployment holds the wildcard <slug>.akoro.name.ng and the schools' verified custom domains (their sites are
 * rendered by the API, by host), and it is also the portal's own host. Pure and unit-tested: main.jsx supplies the config.
 *
 *   portal      → boot the portal app: localhost, *.vercel.app, a listed portal host, or one of OUR names on the base
 *                 domain (app., admin., api., instructors., school. …) — a school can never own those.
 *   candidate   → any other host: a wildcard school subdomain or a custom domain. main.jsx asks the API; if no school
 *                 owns the host (404) it falls back to the portal, so a mis-listed portal host can never lock admins out.
 */
export const RESERVED_SUBDOMAINS = Object.freeze([
  'www', 'app', 'api', 'admin', 'instructor', 'instructors', 'school', 'schools', 'akoro-school', 'akoro-instructor', 'akoro-admin', 'learn', 'learner',
]);

/** Bare registrable host from a URL or host string (drops scheme, path, port and one leading www./api./app.). */
export function baseHostOf(url) {
  if (!url) return '';
  const h = String(url).trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0].split(':')[0];
  return h.replace(/^(www|api|app)\./, '');
}

const csv = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** → 'portal' | 'candidate' */
export function classifyHost(rawHost, { baseDomains = ['akoro.ng', 'akoro.name.ng'], portalHosts = [], reserved = RESERVED_SUBDOMAINS } = {}) {
  const host = String(rawHost || '').toLowerCase().split(':')[0].trim();
  if (!host) return 'portal';
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost') || host.endsWith('.local')) return 'portal';
  if (host.endsWith('.vercel.app')) return 'portal';
  const listed = (Array.isArray(portalHosts) ? portalHosts : csv(portalHosts)).map((h) => h.toLowerCase());
  const bare = host.replace(/^www\./, '');
  if (listed.includes(host) || listed.includes(bare)) return 'portal';
  for (const raw of baseDomains) {
    const base = String(raw).toLowerCase();
    if (bare === base) return 'portal';                              // the apex is the marketing site, never a school
    if (bare.endsWith(`.${base}`)) {
      const sub = bare.slice(0, -(base.length + 1));
      if (!sub.includes('.') && reserved.includes(sub)) return 'portal';
    }
  }
  return 'candidate';
}

/** The portal-only page families a tenant host forwards to the API (public admission / payment / results pages). */
export const PUBLIC_PORTAL_PATH = /^\/(apply|pay|results)(\/|$)/;

/** Config from Vite env → classifyHost options. */
export function siteHostConfig(env = {}) {
  const rawBase = baseHostOf(env.VITE_SITE_BASE_DOMAIN || env.VITE_LEARNER_URL || env.VITE_API_URL) || 'akoro.ng';
  const base = rawBase.replace(/akoro\.name\.ng$/i, 'akoro.ng');
  const portal = csv(env.VITE_PORTAL_HOSTS || `schools.${base},akoro-school.${base},school.${base},akoro-school.akoro.name.ng,school.akoro.name.ng`);
  // Both brand domains classify as school hosts: old links keep working while
  // every tenant is migrated to <slug>.akoro.ng. A custom base keeps only its own.
  const explicit = csv(env.VITE_SITE_BASE_DOMAIN);
  const baseDomains = explicit.length ? explicit
    : (/akoro\.(ng|name\.ng)$/i.test(base) ? [base, base.endsWith('akoro.name.ng') ? 'akoro.ng' : 'akoro.name.ng'] : [base]);
  return { baseDomains, portalHosts: portal };
}
