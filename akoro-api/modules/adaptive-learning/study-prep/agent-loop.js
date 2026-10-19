/**
 * study-prep agent loop (Master Plan §4.3, S5 §8.8).
 *
 *   context → LLM → ONE structured action (+ bounded intent) → harness
 *   validate → execute or reject → event → observation → LLM → …
 *
 * Bounded: maxIterations per step is a HARNESS CONSTANT (10), not a model
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
import { runAgentLoop, observationFor as runtimeObservationFor } from "../../agent-runtime/loop.js";
import { capsFor } from "../../agent-runtime/caps.js";
import { studyPrepResultLine } from "./workflow.js";

export const TERMINAL_ACTIONS = Object.freeze([
  "propose_plan", "advance_topic", "defer_topic", "conclude_session",
]);

/** Build the observation the agent sees after a tool execution or rejection. */
export const observationFor = runtimeObservationFor;

/**
 * runAgentStep — drive one session step on the shared agent runtime
 * (agent-runtime/loop.js) with Study Prep's caps, terminal actions and cap
 * policy. The store's appendEvents allocates sequences; the loop only
 * records what happened, never decides state.
 */
export async function runAgentStep({
  sessionId, topicId = null, goal, agent, registry, store, harness,
  contextSetName = "planning", maxIterations = POLICY.MAX_ITERATIONS_PER_STEP, requireReads = null,
  onThought = null,
}) {
  // onThought({ iteration, ms, thinking, intent, tool }): the decision's notes, live only (developer view).
  let lastAt = Date.now();
  // Deep research: propose_plan is refused (as an observation the agent reads)
  // until each required read has run this step — except on the last decision.
  const read = new Set();
  let decisions = 0;
  if (requireReads?.length) {
    const inner = registry;
    registry = {
      ...inner,
      validate(name, args) {
        const missing = requireReads.filter((r) => !read.has(r));
        if (name === "propose_plan" && missing.length && decisions < maxIterations) {
          return { ok: false, code: "research_incomplete", message: `Read these first, then propose: ${missing.join(", ")}.` };
        }
        return inner.validate ? inner.validate(name, args) : { ok: true };
      },
    };
  }
  // Planning ends only by proposing a plan — never by concluding the session.
  const finalActions = contextSetName === "planning" ? ["propose_plan"] : TERMINAL_ACTIONS;
  const append = (row) => store.appendEvents(sessionId, [makeEvent({ sequence: 0, ...row })]);
  // Paused from the state it is really in — the conditional write pins it,
  // and a guessed status would silently miss (F7).
  const pauseAsItIs = async (facts) => {
    const current = await store.getSession(sessionId);
    if (current) await harness.pause(current, "agent_loop_cap", facts);
  };

  const run = await runAgentLoop({
    agent, registry, goal, operation: contextSetName,
    caps: capsFor("study_prep", { maxIterations, maxToolCalls: POLICY.SESSION_TOOL_CALL_CAP }),
    terminalActions: TERMINAL_ACTIONS, finalActions,
    // A 402 ends the step — the harness already paused the session resumable
    // inside the practice op. The agent still SEES the code.
    stopCodes: ["insufficient_balance"],
    record: async (entry) => {
      const { iteration } = entry;
      if (entry.kind === "agent_error") {
        // A provider failure (rejected request, timeout) is in the session's log.
        return append({ iteration, eventType: "agent_action", origin: "harness", action: "agent_error", facts: { reason: entry.reason } });
      }
      if (entry.kind === "malformed") {
        return append({ iteration, eventType: "agent_action", origin: "harness", action: "malformed", facts: { reason: entry.reason } });
      }
      if (entry.kind === "decision") {
        const step = entry.step;
        decisions = entry.iteration;
        if (step.tool) read.add(step.tool);
        const now = Date.now();
        if (onThought && (step.thinking || step.intent)) {
          try { onThought({ iteration: entry.iteration, ms: now - lastAt, thinking: step.thinking || null, intent: step.intent || null, tool: step.tool || step.action || null }); } catch { /* never breaks the step */ }
        }
        lastAt = now;
        return append({
          iteration, eventType: step.tool ? "agent_tool_call" : "agent_action", origin: "agent_stated_intent",
          topicId: topicId || null, tool: step.tool || null, action: step.action || null,
          agentIntent: step.intent || null, facts: { args: step.args || {} },
        });
      }
      if (entry.kind === "observation") {
        // What it found, in one learner-safe line — worked out before the facts are bounded (they drop nested lists).
        const summary = studyPrepResultLine(entry.tool, entry.observation);
        lastAt = Date.now();   // the next decision's thinking time starts after this result
        return append({ iteration, eventType: "observation", origin: "harness", topicId: topicId || null, tool: entry.tool || null, facts: { ...entry.observation, ...(summary ? { summary } : {}) } });
      }
      return null;
    },
    // Session-level tool-call guard (S4 max-turns, ~40 calls).
    onToolCallCap: () => pauseAsItIs({ reason: "session_tool_call_cap" }),
    // Loop cap reached without a terminal action — pause, honestly.
    onLoopCap: ({ iterations }) => pauseAsItIs({ iterations }),
  });

  // Study Prep's own names for how a step ended (pinned by its contract tests).
  const ended = run.ended === "tool_call_cap" ? "session_tool_call_cap"
    : run.ended === "stop:insufficient_balance" ? "insufficient_balance" : run.ended;
  return { ended, iterations: run.iterations, terminal: run.terminal, observations: run.observations };
}

/** The replayable activity log for a session, public-shaped (§4.10.4). */
export function replayableEvents(rows) {
  return (rows || []).map(publicEvent);
}
