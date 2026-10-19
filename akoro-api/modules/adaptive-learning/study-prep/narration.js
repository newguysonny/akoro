/**
 * deliberate() — RESCOPED (Master Plan §4.7; S5 newest beats S4's retirement).
 *
 * v2's deliberate() pretended to be the agent's thinking. It never was: the
 * code had already decided. This module keeps the name and changes the job —
 * it is the HARNESS's narration generator over a closed decision-node enum
 * with typed facts and a policy_version. It never decides anything, never
 * sees the LLM's private reasoning, and its output is a CACHE (the facts in
 * the event row are the truth; this text is what the learner reads).
 *
 * PURE + snapshot-tested over harness decisions only.
 */

import { DECISION_NODES } from "./state-machine.js";

export const NARRATION_POLICY_VERSION = "study-prep-deliberate-v1";

const label = (facts) => facts?.topicLabel || facts?.topic || "the topic";

/**
 * Templates by decision node. Facts arrive typed from the harness — bounded
 * strings and numbers only; nothing from the model except explicit labels the
 * harness chose to include.
 */
const TEMPLATES = {
  plan_validated: (f) => `Checked the plan against the syllabus, prerequisite order and your coin balance — everything lines up.`,
  plan_confirmed: (f) => `You approved the plan${f.topicCount ? ` (${f.topicCount} topics)` : ""}. Nothing was charged until now.`,
  coins_approved: (f) => `You approved ${f.coins || "more"} more coins for this plan${f.approved ? ` (${f.approved} in all)` : ""}. I'll carry on, and ask again before going past them.`,
  plan_adjusted: (f) => `Plan adjusted${f.dropped ? ` — removed ${f.dropped}` : ""}. The cost estimate was updated to match.`,
  topic_started: (f) => `Starting ${label(f)}. A short diagnostic comes first — it shows what you already know.`,
  practice_generated: (f) => `Fresh practice generated for ${label(f)}${f.attemptNumber ? ` (attempt ${f.attemptNumber})` : ""}. ${f.coins ? `${f.coins} coins charged.` : ""}`.trim(),
  // The Agent Check (D45, §7.12): the learner's agent answered, never the learner —
  // so it is "your agent answered 4 of 5", never "you mastered".
  agent_check_started: (f) => `Agent Check on ${label(f)}${f.mode === "retest" ? " (retest)" : ""}: your agent answers from what you taught it, and Sergeant judges. ${f.coins ? `${f.coins} coins charged.` : ""}`.trim(),
  agent_check_skipped: (f) => `Your agent has no notes on ${label(f)} yet, so there is nothing to check — teach it first. Nothing was charged.`,
  agent_check_scored: (f) => `Your agent answered ${f.correct} of ${f.total} from your notes (${f.percentage}%)${f.guessed ? `, and had to guess on ${f.guessed}` : ""}. ${f.passed ? "Above the pass mark — topic understood." : `Below the ${f.thresholdPercentage}% pass mark.`}`,
  practice_scored: (f) => `Scored ${f.score} of ${f.total} (${f.percentage}%). ${f.passed ? "Above the pass mark — topic understood." : `Below the ${f.thresholdPercentage}% pass mark.`}`,
  strategy_offered: (f) => `Offered the ${String(f.strategy || "").replace(/_/g, " ")} strategy for ${label(f)} — you choose whether to use it.`,
  teach_back_confirmed: (f) => `You confirmed the teach-back for ${label(f)}. A fresh retest is unlocked — same standard, new questions.`,
  topic_advanced: (f) => `${label(f)} settled. Moving on${f.nextTopicLabel ? ` to ${f.nextTopicLabel}` : ""}.`,
  topic_deferred: (f) => `${label(f)} deferred${f.reason ? ` (${f.reason})` : ""}. It can be retried once this session with attempts reset.`,
  topic_flagged: (f) => `${label(f)} flagged as a knowledge gap${f.reason ? ` — ${f.reason}` : ""}.`,
  session_concluded: (f) => `Session complete${f.understood ? ` — ${f.understood} topic${f.understood === 1 ? "" : "s"} understood` : ""}.`,
  session_paused: (f) => PAUSE_COPY[f.reason] || "Session paused. Tap resume when you are ready.",
  harness_rejection: (f) => REJECTION_COPY[f.code] || `That action was not allowed (${f.code}).`,
  // Which syllabus the plan comes from (§8.7): the learner's own class or school first.
  syllabus_resolved: (f) => f.source === "documents"
    ? `Planning from your own materials${f.folder ? ` in “${f.folder}”` : ""} — the topics your past papers test most come first.`
    : f.source === "class"
    ? `Planning from your school's ${f.className || "class"} ${f.subject || ""} syllabus${f.term ? ` for the ${f.term} term` : ""}.`.replace(/\s+/g, " ")
    : f.source === "school"
      ? `Your class has no ${f.subject || "subject"} syllabus at your school yet, so I'm planning from your school's ${f.subject || "subject"} topics for other classes.`
      : `Planning from Akoro's ${f.classLevel || ""} ${f.subject || ""} syllabus.`.replace(/\s+/g, " "),
  syllabus_generated: (f) => f.reused
    ? `There's no syllabus for ${f.classLevel || "this class"} ${f.subject || "this subject"} on Akoro yet, so I'm using an outline drafted earlier from the national curriculum. It's an AI-drafted outline, not your school's official syllabus.`
    : `I couldn't find a syllabus for ${f.classLevel || "this class"} ${f.subject || "this subject"} on Akoro, so I drafted an outline from the national curriculum. It's an AI-drafted outline, not your school's official syllabus.`,
};

const PAUSE_COPY = {
  agent_loop_cap: "I got stuck — tap to retry or adjust.",
  insufficient_balance: "Not enough coins to continue. Top up and tap resume — your progress is kept.",
  learner_requested: "Paused. Tap resume when you are ready to continue.",
};

const REJECTION_COPY = {
  insufficient_balance: "Not enough coins for another practice — the session pauses instead of guessing.",
  attempt_cap_exceeded: "The attempt cap for this topic was reached — no more practice is generated.",
  prerequisite_violation: "That order breaks a prerequisite — the earlier topic has to come first.",
  tool_not_permitted: "That tool is not available to the agent right now.",
  strategy_not_permitted: "That strategy is not in the approved list — the agent picks from teach-back, a different analogy, interleaving, spacing, or escalating to a human.",
  plan_too_large: "That plan covers too many topics — the cap keeps sessions focused.",
  topic_not_in_syllabus: "That topic is not in the approved syllabus for this subject.",
  duplicate_topic: "That topic is already in the plan once.",
  teach_back_gate: "A retest unlocks only after you confirm the teach-back — no guessing.",
  agent_loop_cap: "Too many steps without a decision — the session pauses safely.",
  session_tool_call_cap: "The session tool budget is exhausted — pausing safely.",
  deferred_retry_used: "The one deferred retry for this session is already used.",
  invalid_state_transition: "That step does not follow from where the session is right now.",
  tool_schema_invalid: "That request was malformed — nothing happened.",
  syllabus_exists: "A real syllabus exists for this subject — the plan is made from it, not from a drafted outline.",
  outline_invalid: "The drafted outline didn't pass its checks — nothing was saved.",
};

/**
 * deliberate(decisionNode, facts) → { narrative, policyVersion } | null.
 * Unknown nodes return null (silence over invention) — the enum is closed.
 */
export function deliberate(decisionNode, facts = {}) {
  if (!DECISION_NODES.includes(decisionNode)) return null;
  const template = TEMPLATES[decisionNode];
  if (!template) return null;
  const narrative = String(template(facts || {})).replace(/\s+/g, " ").trim().slice(0, 500);
  return { narrative, policyVersion: NARRATION_POLICY_VERSION };
}

/** Pause copy for the UI banners (same source as the narration). */
export function pauseCopy(reason) {
  return PAUSE_COPY[reason] || "Session paused. Tap resume when you are ready.";
}
