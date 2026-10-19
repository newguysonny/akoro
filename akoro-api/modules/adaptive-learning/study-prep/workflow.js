/**
 * study-prep/workflow.js — Study Prep as a workflow of the generic engine
 * (Grand Plan Phase 1).
 *
 *   studyPrepWorkflow     its definition: the session machine (the
 *                         workflow's states) and the topic machine
 *   guardStudyPrepStore   every session and topic status write goes through
 *                         the definition — an unlisted move is refused with
 *                         invalid_state_transition, never written (F7)
 *   makeWorkflowMirror    the dual-write: the session's workflow instance and
 *                         its events, behind WORKFLOW_ENGINE_ENABLED. Best
 *                         effort — Study Prep's own tables stay the source of
 *                         truth, and a mirror failure never fails the learner.
 */
import { assertTransition, defineWorkflow } from "../../workflows/definition.js";
import { registerWorkflow } from "../../workflows/registry.js";
import { SESSION_STATES, SESSION_TRANSITIONS, TOPIC_STATES, TOPIC_TRANSITIONS } from "./state-machine.js";

export const studyPrepWorkflow = registerWorkflow(defineWorkflow({
  type: "study_prep", version: "1",
  states: SESSION_STATES, initial: "planning", transitions: SESSION_TRANSITIONS,
  statusOf: {
    planning: "active", replanning: "active", topic_active: "active",
    awaiting_confirmation: "waiting_learner", paused: "paused",
    completed: "completed", abandoned: "abandoned", cancelled: "cancelled",
  },
  machines: { topic: { states: TOPIC_STATES, transitions: TOPIC_TRANSITIONS } },
}));

// On by default since Phase 3: the live step stream reads the engine's events.
// WORKFLOW_ENGINE_ENABLED=false turns the dual-write off.
export const workflowEngineEnabled = () => String(process.env.WORKFLOW_ENGINE_ENABLED ?? "true").toLowerCase() !== "false";

/**
 * Wrap a Study Prep store so a status change is checked before it is written.
 * The conditional updates already pin the current status (CAS); this adds
 * the rule. With a mirror, the session's moves and events are dual-written.
 */
export function guardStudyPrepStore(store, { mirror = null } = {}) {
  if (store.__guarded) return store;
  const moves = (from, patch) => patch && patch.status && patch.status !== from;
  const call = (name, ...args) => store[name](...args);
  const overrides = {
    __guarded: true,
    async createSession(row) {
      const session = await call("createSession", row);
      if (mirror && session) await mirror.sessionCreated(session, store);
      return session;
    },
    async updateSessionConditional(sessionId, expectedStatus, patch) {
      if (moves(expectedStatus, patch)) assertTransition(studyPrepWorkflow, expectedStatus, patch.status);
      const updated = await call("updateSessionConditional", sessionId, expectedStatus, patch);
      if (mirror && updated && moves(expectedStatus, patch)) await mirror.sessionMoved(updated, expectedStatus, patch.status);
      return updated;
    },
    async updateTopicConditional(topicId, expectedStatus, patch) {
      if (moves(expectedStatus, patch)) assertTransition(studyPrepWorkflow, expectedStatus, patch.status, "topic");
      return call("updateTopicConditional", topicId, expectedStatus, patch);
    },
    async appendEvents(sessionId, rows) {
      const written = await call("appendEvents", sessionId, rows);
      if (mirror) await mirror.eventsWritten(sessionId, written || rows, store);
      return written;
    },
  };
  // A proxy, not a copy: the store may be a class instance (methods on its
  // prototype, state on itself) — everything else reaches it untouched.
  return new Proxy(store, {
    get(target, prop) {
      if (Object.prototype.hasOwnProperty.call(overrides, prop) && (prop === "__guarded" || typeof target[prop] === "function")) return overrides[prop];
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const ACTOR = { agent_stated_intent: "agent", agent: "agent", harness: "system", engine: "system" };

/** Study Prep's decision nodes as v3 event types (§7.9.2). */
const NODE_TYPE = {
  harness_rejection: "decision.rejected", plan_validated: "decision.accepted",
  plan_confirmed: "learner.action_received", plan_adjusted: "learner.action_received", teach_back_confirmed: "learner.action_received",
  topic_started: "topic.state_changed", topic_advanced: "topic.state_changed", topic_deferred: "topic.state_changed", topic_flagged: "topic.state_changed",
  practice_generated: "assessment.started", agent_check_started: "assessment.started",
  practice_scored: "assessment.completed", agent_check_scored: "assessment.completed",
  strategy_offered: "strategy.selected", session_concluded: "workflow.completed", session_paused: "workflow.paused",
  syllabus_resolved: "activity", syllabus_generated: "activity", agent_check_skipped: "activity",
};
/** The harness's "thought type" stamp as a controlled category (D14). */
const CATEGORY = { research: "research", draft: "draft", verification: "verification", action: "action", reflection: "reflection", synthesis: "synthesis" };

/** A study_prep_events row as a v3 workflow_events row (Phase 3). */
export function workflowEventFor(row) {
  const kind = row.event_type || row.eventType;
  const node = row.decision_node || row.decisionNode || null;
  const facts = row.facts || null;
  const tool = row.tool || null;
  const action = row.action || null;
  const failed = kind === "observation" && facts && facts.ok === false;
  const type = node && NODE_TYPE[node] ? NODE_TYPE[node]
    : kind === "agent_tool_call" ? "tool.started"
    : kind === "observation" ? (failed ? "tool.failed" : "tool.completed")
    : kind === "agent_action" ? (action === "agent_error" || action === "malformed" ? "decision.fallback" : "decision.proposed")
    : kind === "engine_result" ? "assessment.completed"
    : kind === "human_gate" ? "learner.action_received"
    : "decision.accepted";
  // The learner sees the harness's narrated steps, the tools the agent ran and
  // what it said it was doing — never a provider failure or raw facts.
  const learner = Boolean(row.narrative) || type.startsWith("tool.") || (type === "decision.proposed" && (row.agent_intent || row.agentIntent));
  const intent = row.origin === "agent_stated_intent" ? (row.agent_intent || row.agentIntent || null) : null;
  return {
    event_type: type,
    category: CATEGORY[row.thought_type || row.thoughtType] || null,
    operation: action || tool || null,
    workflow_state: null,
    actor: kind === "human_gate" ? "learner" : (ACTOR[row.origin] || "system"),
    visibility: learner ? "learner" : "developer",
    payload: {
      studyPrepSequence: row.sequence ?? null, topicId: row.topic_id || row.topicId || null,
      decisionNode: node, narrative: row.narrative || null, tool, action, intent,
      durationMs: row.duration_ms ?? row.durationMs ?? null,
      ...(failed ? { code: facts.code || null } : {}),
      ...(facts?.topicLabel || facts?.topic ? { topicLabel: facts.topicLabel || facts.topic } : {}),
      ...(facts?.score != null ? { score: facts.score, total: facts.total ?? null, percentage: facts.percentage ?? null } : {}),
      facts, origin: row.origin || null,
    },
  };
}

/** The dual-write into the engine. Every call swallows (and logs) its own failure. */
export function makeWorkflowMirror(engine, { log = console } = {}) {
  const bySession = new Map();   // session id → workflow id
  const quiet = (what) => (error) => { log.warn?.(`[study-prep] workflow mirror: ${what} failed: ${error?.message || error}`); return null; };

  async function workflowIdOf(sessionId, store) {
    if (bySession.has(sessionId)) return bySession.get(sessionId);
    const session = await store.getSession(sessionId).catch(() => null);
    if (session?.workflow_id) bySession.set(sessionId, session.workflow_id);
    return session?.workflow_id || null;
  }

  return {
    async sessionCreated(session, store) {
      const made = await engine.create({
        workflowType: "study_prep", learnerId: session.learner_id, entryMode: session.entry_mode || null,
        state: session.status || "planning", idempotencyKey: `study_prep:${session.id}`,
        policyVersion: session.policy_version || null, metadata: { studyPrepSessionId: session.id, subject: session.subject },
      }).catch(quiet("create"));
      const id = made?.instance?.id;
      if (!id) return;
      bySession.set(session.id, id);
      session.workflow_id = id;
      if (made.created) {
        await engine.appendEvent(id, {
          event_type: "workflow.created", actor: "learner", visibility: "learner",
          payload: { label: "Study Prep", subject: session.subject || null },
        }).catch(quiet("created event"));
      }
      // Point the session at it (no status change, so no guard needed).
      await store.updateSessionConditional(session.id, session.status, { workflow_id: id }).catch(quiet("link session"));
    },
    async sessionMoved(session, from, to) {
      const id = session.workflow_id || bySession.get(session.id);
      if (!id) return;
      bySession.set(session.id, id);
      const moved = await engine.transition(id, { from, to, reason: session.paused_reason || null }).catch(quiet(`move ${from} → ${to}`));
      if (moved === null) log.warn?.(`[study-prep] workflow mirror: ${id} was not in ${from} (out of step)`);
      if (moved) {
        await engine.appendEvent(id, {
          event_type: "workflow.state_changed", actor: "system", visibility: "developer",
          payload: { from, to, reason: session.paused_reason || null },
        }).catch(quiet("state event"));
      }
    },
    /**
     * Backfill (Phase 3): a session from before the engine gets its workflow,
     * and its Study Prep events are copied over once, in order. Idempotent —
     * the create is keyed, and events already copied are recognised.
     */
    async ensure(session, store) {
      if (!session) return null;
      if (!session.workflow_id) await this.sessionCreated(session, store);
      const id = session.workflow_id || bySession.get(session.id);
      if (!id) return null;
      const have = await engine.events(id, { limit: 500 }).catch(() => null);
      if (have && !have.some((e) => e.payload?.studyPrepSequence != null)) {
        const rows = await store.listEvents(session.id, { limit: 500 }).catch(() => []);
        for (const row of rows) await engine.appendEvent(id, workflowEventFor(row)).catch(quiet("backfill event"));
      }
      return id;
    },
    async eventsWritten(sessionId, rows, store) {
      const id = await workflowIdOf(sessionId, store).catch(() => null);
      if (!id) return;
      for (const row of rows || []) await engine.appendEvent(id, workflowEventFor(row)).catch(quiet("event"));
    },
  };
}
