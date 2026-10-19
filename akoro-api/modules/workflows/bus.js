/**
 * workflows/bus.js — live push of stored workflow events (Grand Plan §7.9.6).
 * An event is written to edu.workflow_events first, then published here and
 * to the learner's Socket.IO room as `workflow_event`. The SSE stream also
 * re-reads the table, so a listener on another instance misses nothing.
 */
import { EventEmitter } from "node:events";
import { boundPayload, forLearner, toEnvelope } from "./envelope.js";

export const workflowBus = new EventEmitter();
workflowBus.setMaxListeners(500);

/**
 * A live-only event (never stored, no sequence): the planner's notes for
 * developer mode. It reaches only a stream that asked for developer detail.
 */
export function publishLiveDeveloper(workflowId, payload) {
  if (!workflowId) return;
  const env = { v: 3, live: true, workflowId, type: "agent.narration", actor: "agent", visibility: "developer",
    timestamp: new Date().toISOString(), payload: boundPayload(payload, { maxString: 1200 }) };
  try { workflowBus.emit(`wf:${workflowId}`, env); } catch { /* best effort */ }
}

export function publishWorkflowEvent(row, instance) {
  if (!row?.workflow_id) return;
  const env = toEnvelope(row, instance);
  try { workflowBus.emit(`wf:${row.workflow_id}`, env); } catch { /* a listener never breaks a write */ }
  const learner = forLearner(env);
  if (learner && instance?.learner_id) {
    try { global.io?.to(`user:${instance.learner_id}`).emit("workflow_event", learner); } catch { /* best effort */ }
  }
}
