/**
 * workflows/engine.js — the generic workflow engine (Grand Plan §7.1).
 * Lifecycle, identity, relationships and outcomes; NO domain logic. Every
 * state change goes through the workflow's definition (definition.js) and is
 * a compare-and-swap on the current state, so an illegal or stale move is
 * refused, never applied.
 *
 *   const engine = createWorkflowEngine({ store, definitionOf });
 *   engine.create({ workflowType, learnerId, entryMode, parent, source, metadata, idempotencyKey })
 *   engine.get(id, learnerId) · engine.resume(id, learnerId)   // resume never creates
 *   engine.transition(id, { from, to, reason })
 *   engine.pause(id, reason) · complete(id, outcome) · abandon(id, reason) · cancel(id, reason)
 *   engine.emitOutcome(id, outcome) · engine.listForLearner(learnerId, { active })
 *   engine.appendEvent(id, event) · engine.events(id)
 */
import { assertTransition, isTerminalStatus, statusFor, TransitionError, WORKFLOW_TYPES } from "./definition.js";
import { workflowController, workflowDefinition } from "./registry.js";

export class WorkflowError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = "WorkflowError"; this.code = code; this.status = status; }
}

const STAMP = { completed: "completed_at", abandoned: "abandoned_at", cancelled: "cancelled_at" };

export function createWorkflowEngine({ store, definitionOf = workflowDefinition, controllerOf = workflowController, now = () => new Date().toISOString() }) {
  const defFor = (type) => {
    const def = definitionOf(type);
    if (!def) throw new WorkflowError("unknown_workflow_type", `No workflow is registered as "${type}"`);
    return def;
  };

  /** Create one run — or, with the same idempotency key, return the first. */
  async function create({ workflowType, learnerId, entryMode = null, parent = null, source = null, metadata = {}, idempotencyKey = null, state = null, policyVersion = null }) {
    if (!WORKFLOW_TYPES.includes(workflowType)) throw new WorkflowError("unknown_workflow_type", `Unknown workflow type "${workflowType}"`);
    if (!learnerId) throw new WorkflowError("learner_required", "A workflow belongs to a learner");
    const def = defFor(workflowType);
    if (idempotencyKey) {
      const existing = await store.findByKey(learnerId, workflowType, idempotencyKey);
      if (existing) return { instance: existing, created: false };
    }
    const initial = state || def.initial;
    if (!def.states.includes(initial)) throw new WorkflowError("unknown_state", `"${initial}" is not a ${workflowType} state`);
    const row = {
      learner_id: learnerId, workflow_type: workflowType, state: initial, status: statusFor(def, initial),
      entry_mode: entryMode, parent_workflow_id: parent || null,
      source_workflow_id: source?.workflowId || null, source_topic_id: source?.topicId || null, source_reason: source?.reason || null,
      idempotency_key: idempotencyKey, workflow_version: def.version, policy_version: policyVersion,
      metadata: metadata || {}, created_at: now(), updated_at: now(),
    };
    const inserted = await store.insertInstance(row);
    if (inserted?.conflict) {
      // Raced with another create of the same key: that one wins.
      const winner = idempotencyKey ? await store.findByKey(learnerId, workflowType, idempotencyKey) : null;
      if (winner) return { instance: winner, created: false };
      throw new WorkflowError("workflow_conflict", "A matching workflow is already open", 409);
    }
    return { instance: inserted, created: true };
  }

  async function get(id, learnerId) {
    const instance = await store.getInstance(id);
    if (!instance || (learnerId && instance.learner_id !== learnerId)) return null;
    return instance;
  }

  /** The learner's own open run. Never creates; a finished one can't be resumed. */
  async function resume(id, learnerId) {
    const instance = await get(id, learnerId);
    if (!instance) throw new WorkflowError("workflow_not_found", "That workflow was not found", 404);
    if (isTerminalStatus(instance.status)) throw new WorkflowError("workflow_ended", `That workflow is ${instance.status}`, 409);
    return instance;
  }

  /**
   * Move from `from` to `to`: refused unless the definition lists it
   * (TransitionError), and only if the run is still in `from` (CAS) —
   * otherwise null (someone else moved it first).
   */
  async function transition(id, { from, to, reason = null, patch = {} }) {
    const instance = await store.getInstance(id);
    if (!instance) throw new WorkflowError("workflow_not_found", "That workflow was not found", 404);
    const def = defFor(instance.workflow_type);
    assertTransition(def, from, to);
    const status = statusFor(def, to);
    const at = now();
    const update = {
      ...patch, state: to, status, updated_at: at,
      ...(patch.metadata ? { metadata: { ...(instance.metadata || {}), ...patch.metadata } } : {}),
      paused_reason: status === "paused" ? (reason || instance.paused_reason || null) : null,
      ...(STAMP[status] ? { [STAMP[status]]: at } : {}),
    };
    return store.updateInstanceConditional(id, from, update);
  }

  /** To the state (reachable from here) whose lifecycle status is `status`. */
  async function toStatus(id, status, { reason = null, patch = {} } = {}) {
    const instance = await store.getInstance(id);
    if (!instance) throw new WorkflowError("workflow_not_found", "That workflow was not found", 404);
    const def = defFor(instance.workflow_type);
    const target = (def.transitions[instance.state] || []).find((s) => statusFor(def, s) === status);
    if (!target) throw new TransitionError(`A ${def.type} in ${instance.state} can't become ${status}`, { from: instance.state, to: status, kind: "status" });
    return transition(id, { from: instance.state, to: target, reason, patch });
  }

  const pause = (id, reason) => toStatus(id, "paused", { reason });
  const complete = (id, outcome = null) => toStatus(id, "completed", { patch: outcome ? { metadata: { outcome } } : {} });
  const abandon = (id, reason = null) => toStatus(id, "abandoned", { reason });
  const cancel = (id, reason = null) => toStatus(id, "cancelled", { reason });

  /** Record the outcome and hand it to the parent's controller (Phase 7 handoffs). */
  async function emitOutcome(id, outcome) {
    const instance = await store.getInstance(id);
    if (!instance) throw new WorkflowError("workflow_not_found", "That workflow was not found", 404);
    await appendEvent(id, { event_type: "outcome", category: "lifecycle", actor: "system", visibility: "audit", payload: { outcome } });
    if (!instance.parent_workflow_id) return { delivered: false };
    const parent = await store.getInstance(instance.parent_workflow_id);
    const controller = parent ? controllerOf(parent.workflow_type) : null;
    if (!controller?.onChildOutcome) return { delivered: false };
    await controller.onChildOutcome(parent, { child: instance, outcome });
    return { delivered: true };
  }

  const listForLearner = (learnerId, { active = false } = {}) => store.listInstances(learnerId, { active });

  async function appendEvent(id, event) {
    const instance = await store.getInstance(id);
    if (!instance) throw new WorkflowError("workflow_not_found", "That workflow was not found", 404);
    return store.appendEvent(id, { workflow_state: instance.state, ...event });
  }

  const events = (id, opts) => store.listEvents(id, opts);

  return { create, get, resume, transition, pause, complete, abandon, cancel, emitOutcome, listForLearner, appendEvent, events };
}
