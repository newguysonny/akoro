/**
 * pharmdData.js
 * ─────────────────────────────────────────────────────────────
 * Static dressing for the PHARM.D pages: the hero copy (shown
 * instantly while the programme loads, then confirmed by the API),
 * the default author, and the art-gradient helper. The course and
 * topic DATA itself is live — fetched from /api/pharmd
 * (services/pharmdApi.js), loaded into Supabase by
 * akoro-api/scripts/upload-pharmd-courses.mjs.
 */

/* The four art gradients, cycled by course-code hash. */
export const ACCENTS = [
  'linear-gradient(145deg, #6C3BFF, #4C2BB8)',
  'linear-gradient(145deg, #FF6B57, #C13F2E)',
  'linear-gradient(145deg, #2BB673, #167A4A)',
  'linear-gradient(145deg, #3BA7E0, #1E5FA8)',
];

/* Default creator shown on courses (swap per-course when real
   authorship data exists). */
export const AUTHOR = 'Akoro';

/* Hero fallback — matches the seeded programme row; the API's copy
   replaces it once the fetch lands. */
export const PROGRAM = {
  name: 'PHARM.D',
  sub: 'Doctor of Pharmacy',
};

/* Deterministic art gradient per course code. */
export function accentFor(code) {
  let hash = 0;
  for (const ch of code) hash = (hash * 31 + ch.charCodeAt(0)) % ACCENTS.length;
  return ACCENTS[hash];
}
