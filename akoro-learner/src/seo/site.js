/**
 * site.js — who Akoro is, in the exact words used everywhere (page titles, meta, structured data, footer, profiles).
 * Pure data: read by the build script (Node) and the app (browser). Change a word here, it changes everywhere.
 *
 * One spelling: "protege". "protégé" appears once, as alternateName / in the body of /ai-protege, so both spellings map here.
 */
export const BRAND = 'Akoro';
export const TITLE = 'Akoro: AI proteges for education and learning';
export const DESCRIPTION = 'Akoro helps students learn by teaching AI agents, building knowledge through conversation, interactivity, practice, and feedback.';
export const ENTITY = 'Akoro is an education and learning platform built around AI proteges.';
export const CONCEPT = 'An AI protege is a personal AI learner that a student teaches, practises with and develops over time. Teaching it is how the student learns.';
export const DIFFERENCE = "You don't just ask your AI to teach you. You teach your AI.";
export const ALTERNATE_NAMES = ['Akoro AI proteges', 'Akoro AI protégés'];

/** Logo for structured data: square, crawlable, ≥112×112 (this one is 512×512). */
export const LOGO_PATH = '/logo/akoro-light-512.png';

/** Real profiles, all under one handle. Each goes into Organization.sameAs and the footer icons. */
export const SOCIAL_HANDLE = 'akorohq_app';
export const SOCIALS = [
  { label: 'X',         href: `https://x.com/${SOCIAL_HANDLE}` },
  { label: 'LinkedIn',  href: `https://www.linkedin.com/company/${SOCIAL_HANDLE}` },
  { label: 'YouTube',   href: `https://www.youtube.com/@${SOCIAL_HANDLE}` },
  { label: 'Instagram', href: `https://www.instagram.com/${SOCIAL_HANDLE}` },
  { label: 'Facebook',  href: `https://www.facebook.com/${SOCIAL_HANDLE}` },
];

/** The marketing site's own address (no trailing slash). Build time reads VITE_SITE_URL; the fallback is the current domain. */
export const siteUrl = (env = {}) => String(env.VITE_SITE_URL || 'https://akoro.ng').trim().replace(/\/+$/, '');
