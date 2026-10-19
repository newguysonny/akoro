/**
 * workflows/envelope.js — the v3 event envelope (Grand Plan §7.9.1–7.9.2,
 * Phase 3). One shape for every workflow event, stored in
 * edu.workflow_events and pushed live; Agent Chat's live events carry the
 * same fields (chatEnvelope).
 *
 *   EVENT_TYPES       the stored types (§7.9.2) — each has a narrator template
 *   LIVE_TYPES        streamed-only deltas (§7.9.7), never stored
 *   CATEGORIES        the controlled categories (D14) and CATEGORY_TO_PILL
 *   boundPayload(p)   bounded, JSON-safe, no answer keys / raw prompts
 *   toEnvelope(row, instance)   a workflow_events row → the public envelope
 *   forLearner(env)   null unless learner-visible; drops developer-only payload
 *
 * Never in a payload: answer keys, raw tool output, raw model reasoning,
 * unbounded learner data, passwords.
 */
import { narrate } from "./narrator.js";

export const EVENT_TYPES = Object.freeze([
  "workflow.created", "workflow.started", "workflow.state_changed", "workflow.paused",
  "workflow.resumed", "workflow.completed", "workflow.abandoned", "workflow.cancelled",
  "workflow.handoff_created", "workflow.handoff_completed", "workflow.outcome_emitted",
  "operation.started", "operation.completed", "context.loaded",
  "agent.narration", "activity",
  "decision.proposed", "decision.accepted", "decision.rejected", "decision.fallback",
  "tool.started", "tool.completed", "tool.failed",
  "learner.action_required", "learner.action_received",
  "assessment.started", "assessment.completed",
  "strategy.selected", "evidence.recorded",
  "topic.state_changed", "teaching.phase_changed",
  "wallet.updated",
]);

/** Streamed only (§7.9.7): the closing event is what is stored. */
export const LIVE_TYPES = Object.freeze([
  "agent.narration.start", "agent.narration.delta", "activity.start", "activity.delta",
  "activity.promote", "activity.drop", "reply.delta", "reply",
]);

export const CATEGORIES = Object.freeze([
  "research", "inspection", "planning", "draft", "verification", "assessment",
  "strategy_selection", "teaching", "action", "reflection", "synthesis",
]);

export const CATEGORY_TO_PILL = Object.freeze({
  research: "research", inspection: "research",
  planning: "draft", draft: "draft",
  verification: "verification",
  assessment: "reflection", reflection: "reflection",
  strategy_selection: "action", teaching: "action", action: "action",
  synthesis: "synthesis",
});

export const ACTORS = Object.freeze(["agent", "system", "learner"]);
export const VISIBILITY = Object.freeze(["learner", "developer", "audit"]);

/** Types written before Phase 3 (Phase 1's mirror): read as their v3 type. */
const LEGACY_TYPES = {
  agent_tool_call: "tool.started", observation: "tool.completed", agent_action: "decision.proposed",
  harness_decision: "decision.accepted", human_gate: "learner.action_received", engine_result: "assessment.completed",
  outcome: "workflow.outcome_emitted",
};
export const v3Type = (type) => (EVENT_TYPES.includes(type) ? type : LEGACY_TYPES[type] || "activity");

const FORBIDDEN_KEYS = /answer_?key|answerIndex|^answers$|submitted_answers|correct_?answer|^system$|prompt|transcript|password|secret|token/i;
const clip = (s, n) => String(s ?? "").replace(/[\r\n\u0000]+/g, " ").trim().slice(0, n);

export function boundPayload(value, { maxEntries = 24, maxString = 500, maxDepth = 3 } = {}) {
  const clean = (v, depth) => {
    if (v == null) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return clip(v, maxString);
    if (depth <= 0) return null;
    if (Array.isArray(v)) return v.slice(0, 12).map((x) => clean(x, depth - 1));
    if (typeof v === "object") {
      const out = {};
      let n = 0;
      for (const [k, x] of Object.entries(v)) {
        if (FORBIDDEN_KEYS.test(k)) continue;
        if (n++ >= maxEntries) break;
        out[k] = clean(x, depth - 1);
      }
      return out;
    }
    return null;
  };
  const out = clean(value ?? {}, maxDepth);
  return out && typeof out === "object" && !Array.isArray(out) ? out : {};
}

/** A workflow_events row (+ its instance, when known) → the public v3 envelope. */
export function toEnvelope(row, instance = null) {
  const type = v3Type(row.event_type);
  const payload = boundPayload(row.payload);
  const env = {
    v: 3,
    id: row.id ? `evt_${row.id}` : null,
    workflowId: row.workflow_id,
    workflowType: instance?.workflow_type || null,
    parentWorkflowId: instance?.parent_workflow_id || null,
    sequence: Number(row.sequence),
    timestamp: row.created_at || null,
    type,
    category: CATEGORIES.includes(row.category) ? row.category : null,
    operation: row.operation || null,
    workflowState: row.workflow_state || null,
    subState: row.sub_state || null,
    contextSet: row.context_set || null,
    actor: ACTORS.includes(row.actor) ? row.actor : "system",
    visibility: VISIBILITY.includes(row.visibility) ? row.visibility : "learner",
    turnId: row.turn_id || null,
    payload,
  };
  env.pill = env.category ? CATEGORY_TO_PILL[env.category] : null;
  env.narration = narrate(env);
  return env;
}

/** What a learner may see: learner-visible events, without developer-only payload. */
export function forLearner(env) {
  if (!env || env.visibility !== "learner") return null;
  const { facts, args, raw, ...payload } = env.payload || {};
  return { ...env, payload };
}

/**
 * Agent Chat's live events carry the envelope too (§7.9.7), under `envelope`
 * so the old event names and fields stay exactly as they were.
 */
const CHAT_TYPES = {
  think_start: "agent.narration.start", think_delta: "agent.narration.delta", think_end: "agent.narration",
  tool_start: "tool.started", tool_end: "tool.completed",
  activity: "activity", activity_start: "activity.start", activity_delta: "activity.delta", activity_end: "activity",
  activity_promote: "activity.promote", activity_drop: "activity.drop",
  delta: "reply.delta", done: "reply", status: "operation.started", thinking: "agent.narration.delta",
};
export function chatEnvelope(event, data, { turnId = null, sequence = 0 } = {}) {
  let type = CHAT_TYPES[event];
  if (!type) return null;
  if (event === "tool_end" && data?.ok === false) type = "tool.failed";
  return {
    v: 3, type, sequence, turnId, workflowType: "agent_chat",
    actor: event.startsWith("think") || event === "tool_start" || event === "tool_end" ? "agent" : "system",
    visibility: "learner", ...(data?.category && CATEGORIES.includes(data.category) ? { category: data.category } : {}),
  };
}
export const CHAT_EVENT_NAMES = Object.freeze(Object.keys(CHAT_TYPES));
