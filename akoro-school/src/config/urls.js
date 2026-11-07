/**
 * urls.js — the ONE place this app gets the addresses of the platform. Every address is a Vite env var; the fallback is
 * the CURRENT host, never a retired one. No other file should spell a domain.
 */
const E = import.meta.env || {};
const trim = (u) => String(u || '').trim().replace(/\/+$/, '');
export const API = trim(E.VITE_API_URL) || 'https://api.akoro.name.ng';                          // the API
export const WS_URL = trim(E.VITE_WS_URL) || API;                                                  // realtime (same host unless set)
export const SITE_URL = trim(E.VITE_SITE_URL) || 'https://akoro.name.ng';                          // marketing site (terms, privacy)
// Base of the admission link a school shares (…/<school slug>). NOTE: nothing in the API serves this host yet — until it does,
// the working public page is the school's own site, <school-site>/apply.
export const ADMISSION_BASE_URL = trim(E.VITE_ADMISSION_BASE_URL) || 'https://apply.akoro.name.ng';
export const LEARNER_URL = trim(E.VITE_LEARNER_URL) || 'https://app.akoro.name.ng';                // the learner app
