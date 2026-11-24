/**
 * urls.js — the ONE place this app gets the addresses of the platform. Every address is a Vite env var; the fallback is
 * the CURRENT host, never a retired one. No other file should spell a domain.
 */
const E = import.meta.env || {};
const trim = (u) => String(u || '').trim().replace(/\/+$/, '');
// The platform moved from akoro.name.ng to akoro.ng. Normalise any value left
// in a Vercel env var so an old build setting cannot point the browser at the
// legacy API (whose 301 has no CORS headers — every fetch would fail).
const modern = (u) => trim(u).replace(/akoro\.name\.ng/gi, 'akoro.ng');
export const API = modern(E.VITE_API_URL) || 'https://api.akoro.ng';                          // the API
export const WS_URL = modern(E.VITE_WS_URL) || API;                                                  // realtime (same host unless set)
export const SITE_URL = modern(E.VITE_SITE_URL) || 'https://akoro.ng';                          // marketing site (terms, privacy)
// Base of the admission link a school shares (…/<school slug>). NOTE: nothing in the API serves this host yet — until it does,
// the working public page is the school's own site, <school-site>/apply.
export const ADMISSION_BASE_URL = modern(E.VITE_ADMISSION_BASE_URL) || 'https://apply.akoro.ng';
export const LEARNER_URL = modern(E.VITE_LEARNER_URL) || 'https://app.akoro.ng';                // the learner app
