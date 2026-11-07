/**
 * study-prep/goal-type.js — Grand Plan §8.8 (D33): the goal type decides
 * where a Study Prep syllabus comes from. Pure — no db, no model.
 *
 *   curricular      a school or national exam (WAEC, NECO, BECE, JAMB, a
 *                   class test): documents → class → school → platform →
 *                   syllabus.generate
 *   non_curricular  a scholarship, competition, professional or course exam,
 *                   or a self-chosen topic: documents → platform (if the exam
 *                   is on Akoro) → learner.request_materials (once) →
 *                   syllabus.generate from the goal description
 *
 * classifyGoal(goal) reads the learner's words; an explicit goalType from the
 * caller wins when it is on the list. Anything unclear stays curricular — the
 * order that was always used.
 */
export const GOAL_TYPES = Object.freeze(["curricular", "non_curricular"]);

// Words that name something outside the school syllabus.
const NON_CURRICULAR = [
  /\bscholarships?\b/i, /\bcompetitions?\b/i, /\bolympiads?\b/i, /\bcontests?\b/i, /\bquiz (?:competition|bowl|show)\b/i,
  /\bspelling bee\b/i, /\bhackathon\b/i, /\bdebate\b/i,
  /\bprofessional\b/i, /\bcertifications?\b/i, /\bcertificate exam/i, /\blicen[cs]ing\b/i,
  /\b(?:ican|acca|cfa|cima|cisco|ccna|aws|pmp|comptia)\b/i,
  /\b(?:ielts|toefl|gmat|duolingo english test)\b/i, /\b(?:SAT|ACT|GRE)\b/,
  /\baptitude test\b/i, /\brecruitment\b/i, /\bjob interview\b/i, /\binterview\b/i,
  /\b(?:online )?course(?:'s)? (?:exam|test|final)\b/i, /\bbootcamp\b/i,
  /\bteach myself\b/i, /\blearn (?:to|how to)\b/i, /\bfor fun\b/i, /\bhobby\b/i,
];

// Words that name the school system — these win over a loose match above
// ("WAEC past questions competition in my school" stays curricular).
const CURRICULAR = [
  /\b(?:waec|neco|bece|jamb|utme|wassce|ssce|gce|nabteb|common entrance|post[- ]?utme)\b/i,
  /\b(?:jss|sss|ss)\s?[1-3]\b/i, /\b(?:primary|basic)\s?[1-6]\b/i,
  /\b(?:class|school|term|mid[- ]?term|terminal|end of term|promotion) (?:test|exam|examination)s?\b/i,
];

/** → "curricular" | "non_curricular" */
export function classifyGoal(goal, { goalType = null } = {}) {
  if (GOAL_TYPES.includes(goalType)) return goalType;
  const text = String(goal || "");
  if (CURRICULAR.some((re) => re.test(text))) return "curricular";
  return NON_CURRICULAR.some((re) => re.test(text)) ? "non_curricular" : "curricular";
}

/**
 * The syllabus sources a goal type may use, in order (§8.8 table). The
 * planner is told this; the harness enforces the parts that are rules
 * (a real source wins over generate; request_materials before generate for a
 * non-curricular goal, once).
 */
export function syllabusOrderFor(goalType) {
  return goalType === "non_curricular"
    ? ["documents", "platform", "request_materials", "generate"]
    : ["documents", "class", "school", "platform", "generate"];
}

/** One line for the planner's context: what kind of goal this is and where its outline comes from. */
export function goalTypeHint(goalType) {
  return goalType === "non_curricular"
    ? "This goal is not a school exam (a scholarship, competition, professional or course exam, or their own topic). Syllabus order: first the learner's uploaded materials (materials.list, then syllabus.from_documents); then syllabus.resolve (only Akoro's platform syllabus counts); if neither has topics, ask ONCE with learner.request_materials and wait; only if they have nothing to upload, syllabus.generate from the goal."
    : "This goal is a school or national exam. Syllabus order: the learner's uploaded materials if the session has them, else syllabus.resolve (their class, their school, then Akoro's platform syllabus); syllabus.generate only when all of those are empty.";
}
