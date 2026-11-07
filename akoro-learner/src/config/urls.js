/**
 * urls.js — the ONE place this app gets the addresses of the platform. Every address is a Vite env var; the fallback is
 * the CURRENT host, never a retired one. No other file should spell a domain.
 */
const E = import.meta.env || {};
const trim = (u) => String(u || '').trim().replace(/\/+$/, '');
export const API = trim(E.VITE_API_URL) || 'https://api.akoro.name.ng';                          // the API
export const SITE_URL = trim(E.VITE_SITE_URL) || 'https://akoro.name.ng';                          // marketing site (terms, privacy, blog)
export const APP_URL = trim(E.VITE_APP_URL) || 'https://app.akoro.name.ng';                        // the learner app
export const INSTRUCTOR_URL = trim(E.VITE_INSTRUCTOR_URL) || 'https://instructors.akoro.name.ng';  // the instructor app
