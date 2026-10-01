/**
 * study-prep event shaping (Master Plan §4.1, §4.13). PURE.
 *
 * The append-only activity log is the session's source of truth and its
 * replay medium. Three invariants enforced here:
 *   1. origin is always one of agent_stated_intent | harness | engine.
 *   2. The ONLY LLM-origin string allowed in events is agent_intent —
 *      length-capped, whitespace-collapsed, profanity-masked, schema-checked.
 *      A schema test fails if any other LLM string lands in an event.
 *   3. facts are bounded and can never carry raw chat or answer keys.
 */

import { POLICY } from "./state-machine.js";

const COLLAPSE = /[\r\n\x00]+/g;

export function collapseText(value, maximum) {
  return String(value == null ? "" : value).replace(COLLAPSE, " ").trim().slice(0, maximum);
}

const PROFANITY = ["fuck", "shit", "bitch", "asshole", "bastard", "damn", "crap"];
export function maskProfanity(value) {
  let out = String(value || "");
  for (const word of PROFANITY) {
    out = out.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (match) => match[0] + "*".repeat(Math.max(1, match.length - 1)));
  }
  return out;
}

/**
 * The agent's stated intent for one action: a ONE-SENTENCE purpose, never
 * step-by-step reasoning (S5 still-open, adopted). Origin-tagged
 * agent_stated_intent, ≤ 240 chars, profanity-masked.
 */
export function shapeAgentIntent(rawIntent) {
  const intent = maskProfanity(collapseText(rawIntent, POLICY.INTENT_MAX_CHARS));
  if (!intent) return null;
  return intent;
}

const FORBIDDEN_FACT_KEYS = /answer_key|answerIndex|answers|submitted_answers|system|prompt|transcript/i;

/** Bounded, JSON-safe facts: no answer keys, no raw chat, no nesting bombs. */
export function shapeFacts(facts, { maxEntries = 24, maxValueLength = 240, maxDepth = 2 } = {}) {
  const clean = (value, depth) => {
    if (value == null) return null;
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return collapseText(value, maxValueLength);
    if (Array.isArray(value)) return depth <= 0 ? null : value.slice(0, 12).map((item) => clean(item, depth - 1));
    if (typeof value === "object") {
      if (depth <= 0) return null;
      const out = {};
      let count = 0;
      for (const [key, item] of Object.entries(value)) {
        if (FORBIDDEN_FACT_KEYS.test(key)) continue;
        if (count >= maxEntries) break;
        out[key] = clean(item, depth - 1);
        count += 1;
      }
      return out;
    }
    return null;
  };
  if (facts == null || typeof facts !== "object") return null;
  return clean(facts, maxDepth);
}

export const EVENT_TYPES = Object.freeze([
  "agent_tool_call", "agent_action", "harness_decision", "observation", "human_gate", "engine_result",
]);

export const ORIGINS = Object.freeze(["agent_stated_intent", "harness", "engine"]);

/**
 * Build one event row. `thought_type` is stamped by the HARNESS from the tool
 * or action (never by the model — S4 decision), and `narrative` is a cache of
 * deliberate() output; the facts are the truth.
 */
export function makeEvent({
  sequence, iteration = null, eventType, topicId = null, tool = null, action = null,
  agentIntent = null, origin, decisionNode = null, narrative = null, facts = null,
  thoughtType = null, durationMs = null, policyVersion = "study-prep-v1",
}) {
  if (!EVENT_TYPES.includes(eventType)) throw new Error(`invalid event_type: ${eventType}`);
  if (!ORIGINS.includes(origin)) throw new Error(`invalid origin: ${origin}`);
  if (!Number.isInteger(sequence) || sequence < 0) throw new Error("sequence must be a non-negative integer");
  // The intent may ONLY appear on agent-authored events, and always origin-tagged.
  const intent = eventType === "agent_tool_call" || eventType === "agent_action"
    ? shapeAgentIntent(agentIntent)
    : (agentIntent != null ? null : null);
  return {
    sequence,
    iteration: Number.isInteger(iteration) ? iteration : null,
    event_type: eventType,
    topic_id: topicId || null,
    tool: collapseText(tool, 80) || null,
    action: collapseText(action, 80) || null,
    agent_intent: intent,
    origin,
    decision_node: collapseText(decisionNode, 80) || null,
    narrative: collapseText(narrative, 500) || null,
    facts: shapeFacts(facts),
    thought_type: thoughtType || null,
    duration_ms: Number.isFinite(Number(durationMs)) && Number(durationMs) >= 0 ? Math.round(Number(durationMs)) : null,
    policy_version: collapseText(policyVersion, 80) || "study-prep-v1",
  };
}

/**
 * Thought-type stamps (S4): the harness labels what KIND of activity each
 * event was. Read tools are research; proposals are drafts; harness checks
 * are verification; executed state changes are action; score observations are
 * reflection; plan/summary events are synthesis.
 */
export function stampThoughtType({ eventType, tool = null, action = null }) {
  if (action === "propose_plan" || action === "session_replan") return "draft";
  if (eventType === "engine_result") return "reflection";
  if (eventType === "harness_decision") return "verification";
  if (eventType === "human_gate") return "synthesis";
  if (eventType === "observation") return "research";
  if (eventType === "agent_tool_call" || eventType === "agent_action") {
    if (action) return "action";
    if (tool && tool.startsWith("syllabus.") || tool === "learner.get_state" || tool === "learner.get_history"
      || tool === "concept.get_prerequisites" || tool === "content.search" || tool === "learner.get_relevant_memory") return "research";
    return "action";
  }
  return null;
}

/** Public event shape for REST/chat replay — never leaks internal columns. */
export function publicEvent(row) {
  return {
    sequence: Number(row.sequence), iteration: row.iteration == null ? null : Number(row.iteration),
    eventType: row.event_type, topicId: row.topic_id || null, tool: row.tool || null, action: row.action || null,
    agentIntent: row.origin === "agent_stated_intent" ? (row.agent_intent || null) : null,
    origin: row.origin, decisionNode: row.decision_node || null, narrative: row.narrative || null,
    facts: row.facts || null, thoughtType: row.thought_type || null,
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms), at: row.created_at || null,
  };
}
