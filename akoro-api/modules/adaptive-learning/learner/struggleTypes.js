/**
 * struggleTypes.js — the closed list of learning struggle types (Grand Plan
 * §7.15, D38): 41 types in 8 categories, versioned like the Strategy Library.
 * A struggle may only be recorded (or shown) with a type from this list;
 * adding one is a deliberate change with a contract test.
 *
 *   STRUGGLE_TYPES_VERSION   bump when the list changes
 *   STRUGGLE_CATEGORIES      id → label, in the plan's order
 *   STRUGGLE_TYPES           id → { category, label, concept, story, sensitive }
 *   SENSITIVE_TYPES          the six type-and-date-only types (§7.15.2)
 *   struggleType(id)         the entry, or null for anything off the list
 *
 * Labels are what a school sees on its dashboard (D39), in plain words.
 */

export const STRUGGLE_TYPES_VERSION = 1;

export const STRUGGLE_CATEGORIES = Object.freeze({
  concept: "Concept & understanding",
  recall: "Recall & memory",
  strategy: "Strategy & approach",
  motivation: "Motivation & affect",
  habit: "Process & habit",
  environment: "Environment & circumstance",
  assessment: "Assessment & performance",
  meta: "Learning to learn",
});

// [id, category, label, conceptTied, story]; story false = sensitive (never a peer story).
const ROWS = [
  ["misconception", "concept", "Misconception", true, true],
  ["partial_understanding", "concept", "Partial understanding", true, true],
  ["fragile_knowledge", "concept", "Recalls but can't apply", true, true],
  ["vocabulary_language", "concept", "Key terms / language", true, true],
  ["prior_knowledge_conflict", "concept", "Clash with earlier teaching", true, true],
  ["overgeneralization", "concept", "Over-applies a rule", true, true],
  ["prerequisite_gap", "concept", "Missing prerequisite", true, true],
  ["decay", "recall", "Forgot over time", true, true],
  ["encoding_failure", "recall", "Never stored it", true, true],
  ["retrieval_failure", "recall", "Can't recall under pressure", true, true],
  ["interference", "recall", "Mixes up similar ideas", true, true],
  ["context_dependence", "recall", "Knows it in one format only", true, true],
  ["wrong_strategy", "strategy", "Studying the wrong way", true, true],
  ["strategy_plateau", "strategy", "Strategy stopped working", true, true],
  ["no_strategy", "strategy", "Doesn't know where to start", true, true],
  ["inefficient_strategy", "strategy", "Slow, effortful approach", true, true],
  ["streak_break", "motivation", "Lost momentum", false, true],
  ["confidence_collapse", "motivation", "Confidence collapse", true, false],
  ["frustration_giving_up", "motivation", "Frustration / giving up", true, false],
  ["anxiety", "motivation", "Anxiety", false, false],
  ["boredom_disengagement", "motivation", "Disengaged", true, true],
  ["overload", "motivation", "Overloaded", false, true],
  ["procrastination", "habit", "Keeps putting it off", true, true],
  ["poor_planning", "habit", "No study plan", false, true],
  ["time_management", "habit", "Runs out of time mid-topic", false, true],
  ["inconsistent_practice", "habit", "Irregular practice", false, true],
  ["no_self_monitoring", "habit", "Doesn't notice being stuck", true, true],
  ["time_pressure", "environment", "Deadline pressure", false, true],
  ["distraction_context", "environment", "Distractions", false, true],
  ["resource_gap", "environment", "Missing materials", false, true],
  ["device_access", "environment", "Device / connection", false, true],
  ["health_energy", "environment", "Health / energy", false, false],
  ["test_anxiety", "assessment", "Test anxiety", true, false],
  ["format_mismatch", "assessment", "Question-type mismatch", true, true],
  ["careless_error", "assessment", "Careless errors", true, true],
  ["speed", "assessment", "Too slow", true, true],
  ["retest_failure", "assessment", "Passed once, failed the retest", true, true],
  ["help_seeking_failure", "meta", "Doesn't ask for help", true, true],
  ["feedback_misuse", "meta", "Doesn't act on feedback", true, true],
  ["fixed_mindset", "meta", "Fixed mindset", false, false],
  ["goal_confusion", "meta", "Unclear what 'done' means", false, true],
];

export const STRUGGLE_TYPES = Object.freeze(Object.fromEntries(ROWS.map(([id, category, label, concept, story]) => [
  id, Object.freeze({ id, category, label, concept, story, sensitive: !story }),
])));

/** Type and date only, never a story, learner-deletable; `health_energy` expires in 30 days (§7.15.2). */
export const SENSITIVE_TYPES = Object.freeze(ROWS.filter((r) => !r[4]).map((r) => r[0]));

export const HEALTH_EXPIRY_DAYS = 30;

export const struggleType = (id) => (Object.prototype.hasOwnProperty.call(STRUGGLE_TYPES, id) ? STRUGGLE_TYPES[id] : null);

/**
 * Who may record each type (§7.15 "Detected by"): `rule` = computed by code,
 * `agent` = observed by the controller / Sergeant (needs a cited observation),
 * `learner` = the learner said it. recordStruggle refuses any other detector —
 * e.g. `health_energy` is never inferred, only the learner's own words.
 */
export const DETECTED_BY = Object.freeze({
  misconception: ["rule"], partial_understanding: ["rule", "agent"], fragile_knowledge: ["rule"],
  vocabulary_language: ["agent"], prior_knowledge_conflict: ["agent"], overgeneralization: ["agent"], prerequisite_gap: ["rule"],
  decay: ["rule"], encoding_failure: ["rule"], retrieval_failure: ["rule"], interference: ["rule"], context_dependence: ["rule"],
  wrong_strategy: ["rule"], strategy_plateau: ["rule"], no_strategy: ["learner", "agent"], inefficient_strategy: ["rule"],
  streak_break: ["rule"], confidence_collapse: ["rule", "agent"], frustration_giving_up: ["rule", "agent"],
  anxiety: ["learner", "rule"], boredom_disengagement: ["agent"], overload: ["learner", "rule"],
  procrastination: ["rule"], poor_planning: ["rule"], time_management: ["rule"], inconsistent_practice: ["rule"], no_self_monitoring: ["rule"],
  time_pressure: ["rule"], distraction_context: ["learner", "rule"], resource_gap: ["rule"], device_access: ["rule"], health_energy: ["learner"],
  test_anxiety: ["rule", "learner"], format_mismatch: ["rule"], careless_error: ["agent"], speed: ["rule"], retest_failure: ["rule"],
  help_seeking_failure: ["rule", "agent"], feedback_misuse: ["rule"], fixed_mindset: ["agent"], goal_confusion: ["agent", "learner"],
});
