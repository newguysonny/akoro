/**
 * modules/self-study/plan-scaffold.js — Lever 4/3 for the activities workbench.
 *
 * The study plan has a FIXED shape — { subtopics: string[], objectives: { [subtopic]: string[] } }
 * — but the workbench used to make one objectives call PER subtopic and trust
 * the model to return that shape exactly. This assembles the shape in code:
 * dedupe/trim/cap subtopics, key objectives to exactly those subtopics, and fall
 * back to a per-subtopic placeholder when the model returns nothing for one.
 *
 * PURE: no db, no clock, no randomness — so the plan shape is identical every run.
 */
const CAP_SUBTOPICS = 12;
const CAP_OBJECTIVES = 8;

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const dedupe = (items) => {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const v = clean(item);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
};

/**
 * assemblePlan(subtopics, objectives) → { subtopics, objectives } in the fixed shape.
 * `objectives` may be an object keyed by subtopic OR an array aligned by index
 * (both shapes a model might return). Keys never drift from `subtopics`.
 */
export function assemblePlan(subtopicsRaw, objectivesRaw = {}) {
  const subtopics = dedupe(subtopicsRaw).slice(0, CAP_SUBTOPICS);
  const byKey = objectivesRaw && typeof objectivesRaw === "object" && !Array.isArray(objectivesRaw) ? objectivesRaw : {};
  const byIndex = Array.isArray(objectivesRaw) ? objectivesRaw : null;

  const objectives = {};
  subtopics.forEach((st, i) => {
    const raw = Array.isArray(byKey[st]) ? byKey[st] : byIndex && Array.isArray(byIndex[i]) ? byIndex[i] : [];
    const list = dedupe(raw).slice(0, CAP_OBJECTIVES);
    objectives[st] = list.length ? list : [`Study and complete the activities on ${st}`];
  });
  return { subtopics, objectives };
}
