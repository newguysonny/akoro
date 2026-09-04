/**
 * studyLevel.js — which UI tier does this learner get?
 *
 * The core Akoro audience is school students (Primary → Senior Secondary,
 * WAEC/JAMB shaped). Higher-ed learners — sixth form, university, college,
 * professional/adult, or anything "Other" — get the advanced dashboard UI
 * (e.g. the add-record action above Start Session). This is the one gate the
 * level-aware UI reads, so the rules live in exactly one place.
 *
 * Matching is deliberately fuzzy: the levels were typed by hand across
 * onboarding ('University', 'Adult learner') and settings ('Sixth Form /
 * A-Level', 'Professional'), and schoolType has its own list ('Sixth Form',
 * 'College', 'University', 'Other'). Unknown → school UI (the default
 * audience), never the other way round.
 */

const HIGHER_ED_RE  = /sixth|a[\s-]?level|university|college|polytechnic|professional|adult|other/i;
const SCHOOL_LEVEL_RE = /primary|junior\s*secondary|senior\s*secondary|\bjss\b|\bsss\b/i;

export function isHigherEdUI(profile = {}) {
  const level = String(profile.studyLevel || '').trim();
  const type  = String(profile.schoolType || '').trim();
  if (!level && !type) return false;   // nothing on file → school UI
  if (SCHOOL_LEVEL_RE.test(level) || SCHOOL_LEVEL_RE.test(type)) return false;
  return HIGHER_ED_RE.test(level) || HIGHER_ED_RE.test(type);
}
