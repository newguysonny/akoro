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
import { assertTransition, canTransition, defineWorkflow } from "../../workflows/definition.js";
import { registerWorkflow } from "../../workflows/registry.js";
import {
  RUN_STATES, RUN_STATE_LABELS, RUN_TRANSITIONS, SESSION_STATES, SESSION_TRANSITIONS, TOPIC_STATES, TOPIC_TRANSITIONS, isTopicInProgress,
} from "./state-machine.js";

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

/**
 * The exam-prep run (Phase 5): an attempt record with its own small machine,
 * checked by the engine's one transition rule. It used to be a separate
 * projection (workflow-state.js + adaptive-workflows.js) with its own table
 * of moves; this definition is now the only one. Not registered: no engine
 * instance is ever made for a run — inside Study Prep the topic machine is
 * the state, and the run is only the record of an attempt.
 */
export const examPrepRunWorkflow = defineWorkflow({
  type: "exam_prep", version: "1",
  states: RUN_STATES, initial: "diagnostic_ready", transitions: RUN_TRANSITIONS,
  statusOf: {
    researching: "active", planned: "active", diagnostic_ready: "waiting_learner", teach_back_required: "waiting_learner",
    retest_ready: "waiting_learner", passed: "completed", change_approach: "completed", cancelled: "cancelled",
  },
});

/** May a run's record move from → to? Staying put is allowed (a repeated write is not a move). */
export function canTransitionRun(from, to) {
  if (!RUN_STATES.includes(from) || !RUN_STATES.includes(to)) return false;
  return from === to || canTransition(examPrepRunWorkflow, from, to);
}

/** A run's step row: learner-safe, never a model trace. score: 0–1 when one was recorded. */
export function runStepEvent({ state, attempt = null, score = null }) {
  if (!RUN_STATES.includes(state)) throw new Error("Unknown workflow state");
  const cleanAttempt = Number.isInteger(Number(attempt)) && Number(attempt) > 0 ? Number(attempt) : null;
  // No score is no score: Number(null) is 0, which used to overwrite the
  // learner's earlier diagnostic score with 0 when a retest started.
  const cleanScore = score != null && score !== "" && Number.isFinite(Number(score)) ? Math.max(0, Math.min(1, Number(score))) : null;
  return { state, label: RUN_STATE_LABELS[state], ...(cleanAttempt ? { attempt: cleanAttempt } : {}), ...(cleanScore != null ? { score: cleanScore } : {}) };
}

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
      const updated = await call("updateTopicConditional", topicId, expectedStatus, patch);
      // A topic leaving work (understood, set aside, capped out…) closes its teaching session, if any —
      // not a move within it (intervention_required → awaiting_teaching → retest_ready).
      if (mirror?.topicLeft && updated && moves(expectedStatus, patch) && isTopicInProgress(expectedStatus) && !isTopicInProgress(patch.status)) await mirror.topicLeft(updated, store);
      return updated;
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
  plan_confirmed: "learner.action_received", plan_adjusted: "learner.action_received", coins_approved: "learner.action_received", teach_back_confirmed: "learner.action_received",
  topic_started: "topic.state_changed", topic_advanced: "topic.state_changed", topic_deferred: "topic.state_changed", topic_flagged: "topic.state_changed",
  practice_generated: "assessment.started", agent_check_started: "assessment.started",
  practice_scored: "assessment.completed", agent_check_scored: "assessment.completed",
  strategy_offered: "strategy.selected", strategy_declined: "strategy.selected", teaching_requested: "strategy.selected", teaching_completed: "topic.state_changed", session_concluded: "workflow.completed", session_paused: "workflow.paused",
  syllabus_resolved: "activity", syllabus_generated: "activity", agent_check_skipped: "activity",
};
/** The harness's "thought type" stamp as a controlled category (D14). */
const CATEGORY = { research: "research", draft: "draft", verification: "verification", action: "action", reflection: "reflection", synthesis: "synthesis" };

/**
 * What a planning read found, in one learner-safe line (counts, topic labels,
 * percentages — never the raw result). null when there's nothing to say.
 */
const pctOf = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100);
const many = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export function studyPrepResultLine(tool, observation) {
  if (!observation || observation.ok === false) return null;
  const r = observation.result && typeof observation.result === "object" ? observation.result : {};
  const list = (v) => (Array.isArray(v) ? v : []);
  switch (tool) {
    case "syllabus.resolve": case "syllabus.resolve_class": case "syllabus.resolve_school": case "syllabus.resolve_platform": {
      if (r.found === false || !list(r.topics).length) return "No syllabus found for this class";
      const n = list(r.topics).length;
      return `${n >= 12 ? "12+" : n} topic${n === 1 ? "" : "s"} found`;
    }
    case "syllabus.generate": return list(r.topics).length ? `An outline of ${many(list(r.topics).length, "topic")}` : null;
    case "learner.get_state": {
      const entries = Object.entries(r.topics && typeof r.topics === "object" ? r.topics : {}).filter(([, v]) => Number.isFinite(Number(v)));
      if (!entries.length) return "No recorded evidence on this subject yet";
      const weak = entries.sort((a, b) => Number(a[1]) - Number(b[1])).slice(0, 3).map(([k, v]) => `${String(k).slice(0, 40)} ${pctOf(v)}%`);
      return `Weakest: ${weak.join(", ")}`;
    }
    case "learner.get_history": return list(r.runs).length ? `${many(list(r.runs).length, "past practice run")} found` : "No past practice on this subject yet";
    case "learner.get_relevant_memory": return list(r.memories).length ? `${many(list(r.memories).length, "note")} from earlier sessions` : "Nothing noted on this subject yet";
    case "topic.related_covered": return list(r.related).length ? `${many(list(r.related).length, "related topic")} already covered` : "Nothing related covered yet";
    case "concept.get_prerequisites": return list(r.edges).length ? `${many(list(r.edges).length, "prerequisite link")} to respect` : "No prerequisite links recorded";
    case "plan.validate": return r.ok === false ? null : r.estimate?.totalCoins != null ? `The plan passes the checks · ${r.estimate.totalCoins} coins` : "The plan passes the checks";
    case "agent.get_knowledge_coverage":
    case "topic.get_notes": return r.notes == null ? null : r.notes ? many(r.notes, "note") : "No notes on it yet";
    case "session.get_state": {
      const active = list(r.topics).find((t) => t.status === "active");
      if (active?.lastCheck?.total) return `${active.label}: ${active.lastCheck.correct} of ${active.lastCheck.total} on the last check`;
      const done = list(r.topics).filter((t) => t.status === "understood").length;
      return list(r.topics).length ? `${done} of ${list(r.topics).length} topics understood` : null;
    }
    case "materials.list": return list(r.items).length ? `${many(list(r.items).length, "upload")} found` : "No uploads yet";
    case "materials.search": return list(r.passages).length ? `${many(list(r.passages).length, "passage")} in your files` : "Nothing on that in your files";
    case "syllabus.from_documents": return list(r.topics).length ? `An outline of ${many(list(r.topics).length, "topic")} from your files` : null;
    case "learner.request_materials": return r.asked ? "Asked for your syllabus or past questions" : null;
    case "practice.run_agent_check":
    case "practice.generate": return r.check ? "Agent Check started" : r.skipped ? "Nothing to check yet — teach it first" : null;
    case "advance_topic": return r.topic?.label ? `Now on: ${r.topic.label}` : null;
    case "defer_topic": return r.topic?.label ? `${r.topic.label} set aside for later` : null;
    case "request_teaching": return r.teaching ? `Teaching session on the card${r.topic?.label ? `: ${r.topic.label}` : ""}` : null;
    case "conclude_session": return r.summary ? `${r.summary.understood} of ${r.summary.topics} topics understood` : null;
    default: return null;
  }
}

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
    : kind === "agent_action" ? (action === "agent_error" || action === "malformed" || action === "model_refusal" ? "decision.fallback" : "decision.proposed")
    : kind === "engine_result" ? "assessment.completed"
    : kind === "human_gate" ? "learner.action_received"
    : "decision.accepted";
  // The learner sees the harness's narrated steps, the tools the agent ran and
  // what it said it was doing — never a provider failure or raw facts.
  // An observation with no tool (the harness noting the session's inputs) is not a step.
  // Waiting for the learner is how a wake ends — its message says so; the call itself is not a step.
  const learner = Boolean(row.narrative) || (type.startsWith("tool.") && Boolean(tool) && tool !== "wait_for_learner") || (type === "decision.proposed" && (row.agent_intent || row.agentIntent));
  const intent = row.origin === "agent_stated_intent" ? (row.agent_intent || row.agentIntent || null) : null;
  return {
    event_type: type,
    category: CATEGORY[row.thought_type || row.thoughtType] || null,
    operation: action || tool || null,
    workflow_state: null,
    actor: kind === "human_gate" ? "learner" : (ACTOR[row.origin] || "system"),
    visibility: learner ? "learner" : "developer",
    payload: {
      studyPrepSequence: row.sequence ?? null, iteration: row.iteration ?? null, topicId: row.topic_id || row.topicId || null,
      decisionNode: node, narrative: row.narrative || null, tool, action, intent,
      // 0 is the column default (no timing recorded), not a real duration.
      durationMs: Number(row.duration_ms ?? row.durationMs) > 0 ? Number(row.duration_ms ?? row.durationMs) : null,
      ...(failed ? { code: facts.code || null } : {}),
      ...(kind === "observation" && (facts?.summary || studyPrepResultLine(tool, facts)) ? { resultLine: facts?.summary || studyPrepResultLine(tool, facts) } : {}),
      ...(facts?.topicLabel || facts?.topic ? { topicLabel: facts.topicLabel || facts.topic } : {}),
      ...(facts?.score != null ? { score: facts.score, total: facts.total ?? null, percentage: facts.percentage ?? null } : {}),
      facts, origin: row.origin || null,
    },
  };
}

/** The dual-write into the engine. Every call swallows (and logs) its own failure. */
export function makeWorkflowMirror(engine, { log = console, hooks = {} } = {}) {
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
      // The plan ended (done, cancelled, abandoned): its open teaching sessions close with it.
      if (["completed", "cancelled", "abandoned"].includes(to)) if (hooks.sessionEnded) await Promise.resolve(hooks.sessionEnded(id, to)).catch(quiet("close teaching"));
    },
    /** A topic left work (settled, set aside, re-queued): its open teaching session (if any) closes. */
    async topicLeft(topic, store) {
      if (!hooks.topicLeft) return;
      const id = await workflowIdOf(topic.session_id, store).catch(() => null);
      if (id) await Promise.resolve(hooks.topicLeft(id, topic)).catch(quiet("close topic teaching"));
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
    /** The agent's own words to the learner (already fact-filtered): an `activity` in the workflow stream. */
    async agentMessage(sessionId, store, { iteration = null, text }) {
      if (!text) return;
      const id = await workflowIdOf(sessionId, store).catch(() => null);
      if (!id) return;
      await engine.appendEvent(id, { event_type: "activity", category: "synthesis", actor: "agent", visibility: "learner", payload: { message: text, iteration } }).catch(quiet("agent message"));
    },
    /**
     * A wake's bounds (the agent's run after a learner action): operation.started
     * / operation.completed with the wake's id — the chat splits the run there.
     */
    async wakeMark(sessionId, store, { wakeId, trigger, label = null, phase = "started" }) {
      const id = await workflowIdOf(sessionId, store).catch(() => null);
      if (!id) return null;
      return engine.appendEvent(id, {
        event_type: phase === "completed" ? "operation.completed" : "operation.started", category: "action", operation: "wake",
        actor: "agent", visibility: "learner", payload: { operation: "wake", wakeId, trigger, label },
      }).catch(quiet("wake mark"));
    },
    async eventsWritten(sessionId, rows, store) {
      const id = await workflowIdOf(sessionId, store).catch(() => null);
      if (!id) return;
      for (const row of rows || []) await engine.appendEvent(id, workflowEventFor(row)).catch(quiet("event"));
    },
  };
}
