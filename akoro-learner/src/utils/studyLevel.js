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

/* ── Tier cache — no more school-UI flash on every mount ────────────────
 *
 * The tier is decided by /api/profiles/me, which is async — but pages must
 * not render the school layout first and flip to higher-ed a beat later on
 * every navigation (the flicker this cache kills). The LAST resolved tier
 * is kept in localStorage, which reads SYNCHRONOUSLY, so the very first
 * render of any page is already on the right tier (after the first-ever
 * resolve). A module-level memo serves repeat reads in the same tab, and a
 * CustomEvent tells every mounted useHigherEd() consumer when the tier
 * resolves or changes, so all surfaces flip in the same tick. Cleared on
 * logout so the next account starts clean; seeded at onboarding so even
 * the first post-onboarding load is flick-free.
 *
 * Nothing here is authoritative — it is a RENDER HINT that lets the first
 * paint match the eventual answer. The API revalidation (via the hook in
 * hooks/useStudyTier.js) remains the source of truth and silently corrects
 * the cache if the study level changed elsewhere. */

export const TIER_EVENT = 'akoro_study_tier_changed';
const TIER_KEY = 'akoro_study_tier';

let tierMemo = null;   // { tier } — survives navigation within this tab

/** Last known tier: 'higher' | 'school' | null (never resolved). Sync. */
export function getCachedTier() {
  if (tierMemo) return tierMemo.tier;
  try {
    const v = localStorage.getItem(TIER_KEY);
    if (v === 'higher' || v === 'school') { tierMemo = { tier: v }; return v; }
  } catch { /* ssr / private mode */ }
  return null;   // unknown → callers fall back to the school UI
}

/** Record + broadcast a resolved tier (idempotent per value). */
export function setCachedTier(tier) {
  const t = tier === 'higher' ? 'higher' : 'school';
  tierMemo = { tier: t };
  try { localStorage.setItem(TIER_KEY, t); } catch { /* private mode */ }
  try { window.dispatchEvent(new CustomEvent(TIER_EVENT, { detail: { tier: t } })); } catch { /* ssr */ }
}

/** Forget the tier (logout) so the next account re-resolves cleanly. */
export function clearCachedTier() {
  tierMemo = null;
  try { localStorage.removeItem(TIER_KEY); } catch { /* ssr */ }
}

export function isHigherEdUI(profile = {}) {
  const level = String(profile.studyLevel || '').trim();
  const type  = String(profile.schoolType || '').trim();
  if (!level && !type) return false;   // nothing on file → school UI
  if (SCHOOL_LEVEL_RE.test(level) || SCHOOL_LEVEL_RE.test(type)) return false;
  return HIGHER_ED_RE.test(level) || HIGHER_ED_RE.test(type);
}
