/**
 * study-prep agent loop (Master Plan §4.3, S5 §8.8).
 *
 *   context → LLM → ONE structured action (+ bounded intent) → harness
 *   validate → execute or reject → event → observation → LLM → …
 *
 * Bounded: maxIterations per step is a HARNESS CONSTANT (6), not a model
 * choice. Terminal actions end the step. A loop that never terminates pauses
 * the session with agent_loop_cap and the learner sees "I got stuck — tap to
 * retry or adjust." Never a silent continuation, never partial state.
 *
 * The `agent` is injected ({ next(step) → {tool|action, args, intent} }) so
 * contract tests run a stub agent — no LLM in the test path. The production
 * LLM adapter lives in llm-agent.js.
 */

import { POLICY } from "./state-machine.js";
import { makeEvent, publicEvent } from "./events.js";

export const TERMINAL_ACTIONS = Object.freeze([
  "propose_plan", "advance_topic", "defer_topic", "conclude_session",
]);

/** Build the observation the agent sees after a tool execution or rejection. */
export function observationFor({ ok, result, error }) {
  if (ok) {
    return { ok: true, result: boundedResult(result) };
  }
  return {
    ok: false,
    code: error?.code || "unknown_action",
    message: String(error?.message || "The action was not allowed").slice(0, 300),
  };
}

/** Observations are bounded — no nested run rows, no answer-shaped payloads. */
function boundedResult(result) {
  if (result == null || typeof result !== "object") return result;
  const out = {};
  for (const [key, value] of Object.entries(result).slice(0, 24)) {
    if (value == null) continue;
    if (typeof value === "string") out[key] = value.slice(0, 300);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.slice(0, 12);
    else if (typeof value === "object") out[key] = JSON.parse(JSON.stringify(value).slice(0, 2000));
  }
  return out;
}

/**
 * runAgentStep — drive one session step. The store's appendEvents allocates
 * sequences; the loop only records what happened, never decides state.
 */
export async function runAgentStep({
  sessionId, topicId = null, goal, agent, registry, store, harness,
  contextSetName = "planning", maxIterations = POLICY.MAX_ITERATIONS_PER_STEP,
}) {
  const observations = [];
  // Planning ends only by proposing a plan — never by concluding the session.
  const finalActions = contextSetName === "planning" ? ["propose_plan"] : TERMINAL_ACTIONS;
  let terminal = null;
  let toolCallsUsed = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    let step;
    try {
      // The agent knows its budget; the last iteration may only end the step.
      step = await agent.next({ iteration, maxIterations, goal, observations, tools: registry.catalogue, finalOnly: iteration === maxIterations ? finalActions : null });
    } catch (error) {
      // The provider call itself failed (rejected request, timeout). Record it
      // in the session's log — it used to vanish, leaving a plan-less session
      // with no trace of why — then fail the step as before.
      await store.appendEvents(sessionId, [makeEvent({
        sequence: 0, iteration, eventType: "agent_action", origin: "harness",
        action: "agent_error", facts: { reason: String(error?.message || error).slice(0, 240) },
      })]).catch(() => {});
      throw error;
    }

    const requested = step?.tool || step?.action;
    if (!requested) {
      // The agent returned nothing — treat as a malformed iteration.
      await store.appendEvents(sessionId, [makeEvent({
        sequence: 0, iteration, eventType: "agent_action", origin: "harness",
        action: "malformed", facts: { reason: "no tool or action in agent response" },
      })]);
      continue;
    }

    // Session-level tool-call guard (S4 max-turns, ~40 calls).
    toolCallsUsed += 1;
    if (toolCallsUsed > POLICY.SESSION_TOOL_CALL_CAP) {
      // Paused from the state it is really in — the conditional write pins it,
      // and a guessed status would silently miss (F7).
      const current = await store.getSession(sessionId);
      if (current) await harness.pause(current, "agent_loop_cap", { reason: "session_tool_call_cap" });
      return { ended: "session_tool_call_cap", iterations: iteration - 1, terminal: null, observations };
    }

    await store.appendEvents(sessionId, [makeEvent({
      sequence: 0, iteration,
      eventType: step.tool ? "agent_tool_call" : "agent_action",
      origin: "agent_stated_intent",
      topicId: topicId || null,
      tool: step.tool || null,
      action: step.action || null,
      agentIntent: step.intent || null,
      facts: { args: step.args || {} },
    })]);

    let observation;
    let insufficientBalance = false;
    try {
      const result = await registry.execute(step.tool || step.action, step.args || {}, step.intent || null);
      observation = observationFor({ ok: true, result });
      terminal = TERMINAL_ACTIONS.includes(step.action) || TERMINAL_ACTIONS.includes(step.tool)
        ? (step.action || step.tool)
        : null;
    } catch (error) {
      observation = observationFor({ ok: false, error });
      // A 402 ends the step — the harness already paused the session
      // resumable inside the practice op. The agent still SEES the code.
      insufficientBalance = error?.code === "insufficient_balance";
    }
    // The agent's transcript names the tool each observation answers.
    observations.push({ tool: requested, ...observation });
    await store.appendEvents(sessionId, [makeEvent({
      sequence: 0, iteration, eventType: "observation", origin: "harness",
      topicId: topicId || null, facts: observation,
    })]);
    if (insufficientBalance) return { ended: "insufficient_balance", iterations: iteration, terminal: null, observations };
    if (terminal) return { ended: "terminal", iterations: iteration, terminal, observations };
  }

  // Loop cap reached without a terminal action — pause, honestly.
  const session = await store.getSession(sessionId);
  if (session) await harness.pause(session, "agent_loop_cap", { iterations: maxIterations });
  return { ended: "agent_loop_cap", iterations: maxIterations, terminal: null, observations };
}

/** The replayable activity log for a session, public-shaped (§4.10.4). */
export function replayableEvents(rows) {
  return (rows || []).map(publicEvent);
}
