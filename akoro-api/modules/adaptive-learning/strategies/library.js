/**
 * adaptive-learning/strategies/library.js — the Strategy Library, v3
 * (Grand Plan §7.7.1, §7.7.2, D40). The ONE source of truth: every workflow,
 * tool schema and harness check reads its strategies from here.
 *
 * Each entry is a definition, not just a name: what it targets (§7.15 struggle
 * types), where it may be chosen, what runs it — a Teaching session
 * (`executor: "teaching"`) or a workflow harness (`executor: "harness"`:
 * replan, schedule, offline export, recall rounds, …) — its guide file for the
 * agent (akoro-agent/strategies/<id>.md), how success is judged, its limits.
 *
 * Adding or changing a strategy = one entry here + its guide file. The
 * contract test (library.contract.test.mjs) checks every entry has a guide,
 * valid targets and workflows. Versions are persisted with every use
 * (learning_strategy_outcomes.strategy_version), so old outcomes stay readable.
 *
 * Disabling: AKORO_STRATEGIES_DISABLED=id,id takes effect on the next check —
 * the harness rejects it and nothing recommends it.
 *
 * Pure data + pure functions; no database, no model.
 */
import { STRUGGLE_TYPES } from "../../../lib/struggleTypes.js";

export const LIBRARY_VERSION = 3;

/** Where a strategy may be chosen (§7.7.2 columns, plus Agent Chat for goal_clarify). */
export const STRATEGY_WORKFLOWS = Object.freeze(["study_prep", "teaching", "decay_review", "practice", "agent_chat"]);
/** What runs a strategy: a Teaching session, or the choosing workflow's harness. */
export const STRATEGY_EXECUTORS = Object.freeze(["teaching", "harness"]);
/** How a strategy turned out (recordStrategyOutcome). */
export const STRATEGY_OUTCOMES = Object.freeze(["worked", "partial", "did_not_work", "abandoned"]);

const SP = "study_prep", T = "teaching", D = "decay_review", P = "practice", CHAT = "agent_chat";
const teaching = (mode = "any") => ({ executor: "teaching", workflow: "teaching", mode, operation: "teach" });
const harness = (operation) => ({ executor: "harness", operation });
// peer_help targets any type that may become a peer story (never a sensitive one, §7.15.2).
const SHAREABLE = Object.values(STRUGGLE_TYPES).filter((t) => t.story).map((t) => t.id);

// [id, version, name, summary, targets, workflows, runsAs, success, extra]
const ROWS = [
  ["teach_back", 1, "Teach back", "The learner explains the idea in their own words while the agent listens, probes and asks to be corrected.",
    ["misconception", "partial_understanding", "encoding_failure"], [SP, T, D], teaching("teach_agent"),
    "the learner explains it unprompted and the next Agent Check passes", { limits: { maxUsesPerTopic: 3 } }],
  ["different_analogy", 1, "A different analogy", "Re-explain through a different everyday example when one wrong mental model keeps coming back.",
    ["misconception", "prior_knowledge_conflict", "partial_understanding"], [SP, T, D], teaching("learn_with_guide"),
    "the learner maps the new example back to the idea correctly", {}],
  ["interleave", 1, "Interleave", "Mix this topic's practice with a related topic so neighbouring ideas are told apart.",
    ["interference", "context_dependence"], [SP, P], harness("replan"),
    "both topics pass on a mixed Agent Check", {}],
  ["space_out", 1, "Space it out", "Schedule a later pass instead of pushing on now.",
    ["decay", "inconsistent_practice", "overload"], [SP, D, P], harness("schedule"),
    "the later pass is taken and the topic holds", {}],
  ["escalate_human", 1, "Ask a human", "Hand the gap to the learner's instructor or a person who can help.",
    ["frustration_giving_up", "help_seeking_failure"], [SP, T, D], harness("notify_human"),
    "a person picks it up", { targetsAny: "after_repeated_failure", limits: { maxUsesPerTopic: 1 } }],
  ["retrieval_practice", 2, "Retrieval practice", "The learner recalls from memory with a hint ladder before any re-explanation.",
    ["decay", "retrieval_failure"], [D, P], harness("recall_rounds"),
    "the learner recalls it with no hint or a cue", { humanAnswers: true }],
  ["peer_help", 2, "Peer help", "Bring in how other learners got past the same struggle.",
    SHAREABLE, [SP, T, D], harness("peer_stories"),
    "the learner tries the peer's way and the next check improves", { targetsAny: "shareable" }],
  ["contrast_pairs", 3, "Contrast pairs", "Put two easily-confused ideas side by side and have the learner teach the difference.",
    ["interference", "overgeneralization", "misconception"], [SP, T, D], teaching("teach_agent"),
    "both ideas distinguished on a mixed Agent Check", { limits: { maxUsesPerTopic: 2 } }],
  ["prerequisite_review", 3, "Prerequisite first", "Insert the missing prerequisite topic before this one, then teach it.",
    ["prerequisite_gap"], [SP, T], harness("replan"),
    "the prerequisite passes, then this topic's check improves", { limits: { maxUsesPerTopic: 1 } }],
  ["vocabulary_focus", 3, "Key words first", "Teach the key terms with plain-language and local-language bridges.",
    ["vocabulary_language"], [SP, T, D], teaching(),
    "the learner uses the key terms correctly in their own explanation", {}],
  ["worked_examples", 3, "Worked examples", "Walk through examples step by step, then the learner teaches the agent to apply them.",
    ["fragile_knowledge", "partial_understanding", "no_strategy"], [SP, T], teaching(),
    "the learner applies it to a new example unaided", {}],
  ["varied_formats", 3, "Varied formats", "Teach and check the same idea as text, diagram and word problem.",
    ["context_dependence", "format_mismatch"], [SP, T, D], teaching(),
    "the idea is answered correctly in at least two formats", {}],
  ["easy_wins_first", 3, "Easy wins first", "Start with achievable items, then build up.",
    ["confidence_collapse", "frustration_giving_up", "fixed_mindset"], [SP, T, D], teaching(),
    "the learner keeps going past the first harder item", {}],
  ["chunk_plan", 3, "Smaller parts", "Split the topic or the plan into smaller parts.",
    ["overload", "time_management", "time_pressure"], [SP], harness("replan"),
    "the smaller parts are finished on time", {}],
  ["make_concrete", 3, "Make it real", "Real-life examples, or a harder challenge, for a learner who has switched off.",
    ["boredom_disengagement"], [SP, T], teaching(),
    "the learner engages again (longer, on-topic replies)", {}],
  ["schedule_plan", 3, "A dated schedule", "A dated schedule to the exam, with reminders.",
    ["poor_planning", "inconsistent_practice", "procrastination"], [SP], harness("schedule"),
    "the scheduled sessions are kept", {}],
  ["offline_pack", 3, "Offline pack", "A downloadable summary and practice for studying without a connection.",
    ["device_access", "resource_gap"], [SP, D], harness("offline_export"),
    "the pack is downloaded and the next check improves", {}],
  ["timed_practice", 3, "Timed practice", "Short, low-stakes timed rounds the learner answers themselves (unproctored).",
    ["speed", "anxiety", "test_anxiety", "retrieval_failure"], [D, P], harness("timed_rounds"),
    "answers stay correct inside the time budget", { humanAnswers: true }],
  ["format_practice", 3, "Format practice", "Practise in the question format that keeps failing.",
    ["format_mismatch"], [SP, P], harness("agent_check_format"),
    "that format passes on the next check", {}],
  ["check_your_work", 3, "Check your work", "Coach a checking habit; the learner reviews their own answers.",
    ["careless_error"], [T, P], teaching(),
    "fewer careless errors on the next check", { humanAnswers: true }],
  ["self_check", 3, "How sure are you?", "Ask for a confidence rating before a check, then compare with the result.",
    ["no_self_monitoring", "feedback_misuse", "help_seeking_failure"], [SP, T], teaching(),
    "the learner's confidence matches their results more closely", {}],
  ["goal_clarify", 3, "Clarify the goal", "Restate what 'understood' means here and set a measurable goal.",
    ["goal_confusion", "no_strategy"], [SP, CHAT], harness("goal_set"),
    "a measurable goal is set and the learner works toward it", {}],
];

export const STRATEGIES = Object.freeze(ROWS.map(([id, version, name, summary, targets, workflows, runsAs, success, extra]) => Object.freeze({
  id, version, status: "enabled", name, summary,
  targets: Object.freeze([...targets]), targetsAny: extra.targetsAny || null,
  workflows: Object.freeze([...workflows]), runsAs: Object.freeze({ ...runsAs }),
  guide: `strategies/${id}.md`, success,
  limits: Object.freeze({ maxUsesPerTopic: 2, ...(extra.limits || {}) }),
  humanAnswers: extra.humanAnswers === true,
  cost: runsAs.executor === "teaching" ? "normal_teaching_turns" : "harness_operation",
})));

export const STRATEGY_IDS = Object.freeze(STRATEGIES.map((s) => s.id));
const BY_ID = new Map(STRATEGIES.map((s) => [s.id, s]));

/** Names used before v3 that mean a library strategy (old sessions, old prompts). */
export const LEGACY_ALIASES = Object.freeze({ worked_example: "worked_examples" });

export function normaliseStrategyId(id) {
  const raw = String(id ?? "").trim();
  return LEGACY_ALIASES[raw] || raw;
}

/** The entry, or null for anything off the list. */
export function getStrategy(id) {
  return BY_ID.get(normaliseStrategyId(id)) || null;
}

/** Ids switched off by admin/env (AKORO_STRATEGIES_DISABLED=a,b). */
export function disabledStrategyIds(env = process.env) {
  return new Set(String(env?.AKORO_STRATEGIES_DISABLED || "").split(",").map((s) => s.trim()).filter(Boolean));
}

export function isEnabled(id, env = process.env) {
  const s = getStrategy(id);
  return !!s && s.status === "enabled" && !disabledStrategyIds(env).has(s.id);
}

/**
 * PURE: why this strategy may not be used here → null when it may.
 * unknown_strategy · strategy_disabled · strategy_not_permitted (not in this workflow).
 */
export function strategyRefusal(id, workflow = null, env = process.env) {
  const s = getStrategy(id);
  if (!s) return "unknown_strategy";
  if (!isEnabled(s.id, env)) return "strategy_disabled";
  if (workflow && !s.workflows.includes(workflow)) return "strategy_not_permitted";
  return null;
}

export function isPermittedStrategy(id, workflow = null, env = process.env) {
  return strategyRefusal(id, workflow, env) === null;
}

/** The library's ids allowed in a workflow (optionally only one executor), in library order. */
export function strategiesFor(workflow, { executor = null, includeDisabled = false, env = process.env } = {}) {
  return STRATEGIES
    .filter((s) => s.workflows.includes(workflow) && (!executor || s.runsAs.executor === executor))
    .filter((s) => includeDisabled || isEnabled(s.id, env))
    .map((s) => s.id);
}

/** Candidates for a struggle type in a workflow (§7.15.3), before ranking. */
export function strategiesForStruggle(type, workflow = null, env = process.env) {
  return STRATEGIES
    .filter((s) => s.targets.includes(type) && (!workflow || s.workflows.includes(workflow)) && isEnabled(s.id, env))
    .map((s) => s.id);
}

/** The guides by executor — the context manifest registers them as two sets. */
export const GUIDE_FILES = Object.freeze({
  teaching: Object.freeze(STRATEGIES.filter((s) => s.runsAs.executor === "teaching").map((s) => s.guide)),
  harness: Object.freeze(STRATEGIES.filter((s) => s.runsAs.executor === "harness").map((s) => s.guide)),
});

/** Plain words for a strategy id (narration, what_worked). */
export const strategyLabel = (id) => getStrategy(id)?.name || String(id || "").replace(/_/g, " ");
