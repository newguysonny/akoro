/**
 * pharmdData.js
 * ─────────────────────────────────────────────────────────────
 * The PHARM.D programme catalogue, ported verbatim from
 * reference/pharm D discovery and course page.md. The year/course
 * structure is the programme's; topic sets are the reference's
 * placeholders ("Topic 1..5" with read times and starter bodies)
 * until real syllabi land — swap topicsFor() for real content and
 * both pages follow unchanged.
 */

/* The four art gradients, cycled by course-code hash (reference ACCENTS). */
export const ACCENTS = [
  'linear-gradient(145deg, #6C3BFF, #4C2BB8)',
  'linear-gradient(145deg, #FF6B57, #C13F2E)',
  'linear-gradient(145deg, #2BB673, #167A4A)',
  'linear-gradient(145deg, #3BA7E0, #1E5FA8)',
];

/* Default creator shown on courses (reference: swap per-course when
   real authorship data exists). */
export const AUTHOR = 'Akoro';

export const PROGRAM = {
  name: 'PHARM.D',
  sub: 'Doctor of Pharmacy',
  years: [
    {
      label: 'First Year',
      courses: [
        'BIO 111', 'BIO 121', 'CSC 111', 'GST 111', 'GST 113',
        'GST 121', 'ICH 111', 'MAT 111', 'PHY 111',
      ],
    },
    {
      label: 'Second Year',
      courses: [],
    },
  ],
};

/* Shared placeholder topic set per course, since specific syllabi
   weren't provided (reference topicsFor). */
export function topicsFor(code) {
  return [1, 2, 3, 4, 5].map((n) => ({
    name: `Topic ${n}`,
    meta: `${8 + n} min read`,
    body: `<p>This is placeholder lesson content for <b>${code} — Topic ${n}</b>. Replace with the real syllabus content for this topic once it's ready.</p><h3>Key points</h3><p>Outline the two or three ideas a student should take away from this topic before moving on.</p>`,
  }));
}

/* Deterministic art gradient per course code (reference accentFor). */
export function accentFor(code) {
  let hash = 0;
  for (const ch of code) hash = (hash * 31 + ch.charCodeAt(0)) % ACCENTS.length;
  return ACCENTS[hash];
}

/* Deterministic mock read count per course, stable across re-renders —
   not real usage data (reference readsFor). */
export function readsFor(code) {
  let hash = 0;
  for (const ch of code) hash = (hash * 37 + ch.charCodeAt(0)) >>> 0;
  return (800 + (hash % 42000)).toLocaleString();
}
