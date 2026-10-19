/**
 * workflows/narrator.js — the ActivityNarrator (Grand Plan §7.9.3, Phase 3).
 *
 *   narrate(envelope) → { headline, description, result, narration }
 *
 * Deterministic templates for every event type (TEMPLATES covers EVENT_TYPES;
 * the contract test fails on a type without one). Facts come from the
 * payload; a harness narrative (Study Prep's deliberate()) is already
 * deterministic and is used as the narration when present. The agent's
 * stated intent only ever fills the "why" — sanitised, capped, never a fact.
 */
const clip = (s, n = 160) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const pct = (p) => (p.percentage != null ? ` (${p.percentage}%)` : "");
const topic = (p) => p.topicLabel || p.topic || "the topic";
const stateWord = (s) => String(s || "").replace(/_/g, " ");

/** Learner-language rows for the workflows' own tools (Study Prep today). */
export const TOOL_HEADLINES = Object.freeze({
  "syllabus.resolve": ["Checking the syllabus", "Looking for your class's topics"],
  "syllabus.resolve_class": ["Checking your class syllabus", "Your school's topics for your class"],
  "syllabus.resolve_school": ["Checking your school's syllabus", "Topics your school teaches"],
  "syllabus.resolve_platform": ["Checking Akoro's syllabus", "Akoro's topics for your class"],
  "syllabus.generate": ["Drafting an outline", "From the national curriculum, when no syllabus exists"],
  "learner.get_state": ["Reviewing what you know", "Your strong and weak topics"],
  "learner.get_history": ["Reviewing your learning history", "Looking for repeated mistakes"],
  "learner.get_relevant_memory": ["Remembering what helps you", "Notes from earlier sessions"],
  "concept.get_prerequisites": ["Ordering the topics", "What has to come before what"],
  "content.search": ["Finding study material", "Material on these topics"],
  "plan.validate": ["Checking the plan", "Syllabus, order and coins"],
  "practice.generate": ["Preparing practice", "Questions for this topic"],
  "practice.submit": ["Marking the answers", "Scoring this attempt"],
  "session.get_state": ["Checking where we are", "The plan and its topics"],
  "session.replan": ["Re-planning", "Adjusting the plan"],
  "topic.flag": ["Flagging a gap", "A topic that needs more work"],
  propose_plan: ["Proposing a plan", "The topics, in order"],
  advance_topic: ["Moving on", "To the next topic"],
  defer_topic: ["Setting a topic aside", "To come back to later"],
  conclude_session: ["Wrapping up", "Ending the session"],
  offer_strategy: ["Suggesting a way to learn it", "A strategy for this topic"],
});
const toolRow = (p) => TOOL_HEADLINES[p.tool] || TOOL_HEADLINES[p.action] || null;

/** Study Prep's decision nodes → a short headline (its narrative is the detail). */
export const NODE_HEADLINES = Object.freeze({
  harness_rejection: "Not allowed", plan_validated: "Plan checked", plan_confirmed: "You approved the plan",
  plan_adjusted: "Plan adjusted", topic_started: "Starting a topic", practice_generated: "Practice ready",
  practice_scored: "Practice marked", strategy_offered: "A strategy to try", teach_back_confirmed: "Teach-back confirmed",
  topic_advanced: "Topic settled", topic_deferred: "Topic set aside", topic_flagged: "Gap flagged",
  session_concluded: "Session complete", session_paused: "Session paused", syllabus_generated: "Outline drafted",
  syllabus_resolved: "Syllabus found", agent_check_started: "Agent Check started", agent_check_skipped: "Agent Check skipped",
  agent_check_scored: "Agent Check marked",
});

const T = (headline, description = "", result = "") => ({ headline, description, result });

export const TEMPLATES = Object.freeze({
  "workflow.created": (p) => T(`Started ${p.label || "a session"}`, p.subject ? clip(p.subject, 60) : ""),
  "workflow.started": () => T("Getting started"),
  "workflow.state_changed": (p) => T("Moved on", p.from && p.to ? `${stateWord(p.from)} → ${stateWord(p.to)}` : ""),
  "workflow.paused": (p) => T("Paused", clip(p.reason ? stateWord(p.reason) : "Resume when you're ready")),
  "workflow.resumed": () => T("Picked up again"),
  "workflow.completed": () => T("Finished"),
  "workflow.abandoned": () => T("Stopped", "Left unfinished"),
  "workflow.cancelled": () => T("Cancelled"),
  "workflow.handoff_created": (p) => T("Handing over", p.to ? `To ${stateWord(p.to)}` : ""),
  "workflow.handoff_completed": () => T("Back from the handover"),
  "workflow.outcome_emitted": () => T("Result recorded"),
  "operation.started": (p) => T(p.label ? clip(p.label, 80) : "Working on it"),
  "operation.completed": (p) => T(p.label ? clip(p.label, 80) : "Done"),
  "context.loaded": () => T("Getting ready", "Reading what matters for this step"),
  "agent.narration": () => T("Thinking"),
  "activity": (p) => T(p.message ? clip(p.message, 120) : "Update"),
  "decision.proposed": () => T("Deciding the next step"),
  "decision.accepted": () => T("Checked"),
  "decision.rejected": (p) => T("Not allowed", p.code ? stateWord(p.code) : ""),
  "decision.fallback": () => T("Taking the safe next step", "The agent didn't decide in time"),
  "tool.started": () => T("Working on your study plan", "A step in your study session"),
  "tool.completed": (p) => T("Working on your study plan", "A step in your study session", p.resultLine ? clip(p.resultLine, 200) : "Done"),
  "tool.failed": (p) => T("Working on your study plan", "A step in your study session", p.code ? `Couldn't finish (${stateWord(p.code)})` : "Couldn't finish"),
  "learner.action_required": (p) => T("Waiting for you", p.label ? clip(p.label, 80) : ""),
  "learner.action_received": () => T("Got it"),
  "assessment.started": (p) => T("Practice started", topic(p)),
  "assessment.completed": (p) => T("Marked", topic(p), p.score != null && p.total != null ? `${p.score} of ${p.total}${pct(p)}` : ""),
  "strategy.selected": (p) => T("A way to learn it", p.strategy ? stateWord(p.strategy) : ""),
  "evidence.recorded": () => T("Noted what you showed"),
  "topic.state_changed": (p) => T(topic(p), p.to ? stateWord(p.to) : ""),
  "teaching.phase_changed": (p) => T("Next teaching step", p.to ? stateWord(p.to) : ""),
  "wallet.updated": (p) => T("Coins updated", p.coins != null ? `${p.coins} coins` : ""),
});

/** One event in the learner's words. */
export function narrate(env) {
  const p = env?.payload || {};
  const base = (TEMPLATES[env?.type] || TEMPLATES.activity)(p);
  const tool = (env?.type || "").startsWith("tool.") || env?.type === "decision.proposed" ? toolRow(p) : null;
  const node = p.decisionNode && NODE_HEADLINES[p.decisionNode];
  const headline = node || (tool ? tool[0] : base.headline);
  const description = tool && !node ? tool[1] : base.description;
  const narrative = clip(p.narrative, 500);
  const why = p.intent ? clip(p.intent, 240) : "";
  return {
    headline: clip(headline, 120),
    description: clip(narrative && node ? narrative : description, 500),
    result: clip(base.result || (narrative && !node ? narrative : ""), 240),
    narration: narrative || (why ? `${headline} — ${why}` : headline),
  };
}
