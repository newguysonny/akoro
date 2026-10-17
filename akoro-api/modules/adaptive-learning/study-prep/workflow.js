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

export const workflowEngineEnabled = () => String(process.env.WORKFLOW_ENGINE_ENABLED ?? "false").toLowerCase() === "true";

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

/** A study_prep_events row as a workflow_events row. */
export function workflowEventFor(row) {
  const type = row.event_type || row.eventType;
  return {
    event_type: type,
    category: type === "harness_decision" || type === "engine_result" ? "decision" : type === "human_gate" ? "gate" : "step",
    operation: row.action || row.tool || null,
    workflow_state: null,
    actor: type === "human_gate" ? "learner" : (ACTOR[row.origin] || "system"),
    visibility: row.narrative ? "learner" : "developer",
    payload: {
      studyPrepSequence: row.sequence ?? null, topicId: row.topic_id || row.topicId || null,
      decisionNode: row.decision_node || row.decisionNode || null, narrative: row.narrative || null,
      facts: row.facts || null, origin: row.origin || null,
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
      // Point the session at it (no status change, so no guard needed).
      await store.updateSessionConditional(session.id, session.status, { workflow_id: id }).catch(quiet("link session"));
    },
    async sessionMoved(session, from, to) {
      const id = session.workflow_id || bySession.get(session.id);
      if (!id) return;
      bySession.set(session.id, id);
      const moved = await engine.transition(id, { from, to, reason: session.paused_reason || null }).catch(quiet(`move ${from} → ${to}`));
      if (moved === null) log.warn?.(`[study-prep] workflow mirror: ${id} was not in ${from} (out of step)`);
    },
    async eventsWritten(sessionId, rows, store) {
      const id = await workflowIdOf(sessionId, store).catch(() => null);
      if (!id) return;
      for (const row of rows || []) await engine.appendEvent(id, workflowEventFor(row)).catch(quiet("event"));
    },
  };
}
