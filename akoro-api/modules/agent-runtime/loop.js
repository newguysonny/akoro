/**
 * agent-runtime/loop.js — the one agent loop every workflow runs (Grand Plan
 * §7.2, Phase 2). Workflow behaviour comes from what it is given: its
 * registry, caps, terminal actions, and hooks.
 *
 *   decide (one action + a bounded intent) → validate → execute → observe → …
 *
 * Stop conditions: a terminal action · a stop code in an observation (e.g.
 * insufficient_balance) · the tool-call cap · the iteration cap · a decision
 * timeout (fallback, or an agent error).
 *
 * `agent.next(step)` → { tool|action, args, intent } — injected, so contract
 * tests run stub agents. `record(entry)` gets every step for the workflow's
 * own event log; the loop records, it never decides state.
 *
 * Phase 18: the loop guard (loopGuard.js) adds a reminder to the observation
 * of a call that repeats the previous one exactly; a tool past its time limit
 * (tools.js / toolTime.js) comes back as a `timeout` observation; each
 * decision is recorded with its basis (actionBasis.js) when the registry has one.
 */

import { classifyError } from "../agent-contract/contract.js";
import { createLoopGuard } from "./loopGuard.js";

export class DecisionTimeout extends Error {
  constructor(ms) { super(`The agent did not decide within ${ms} ms`); this.name = "DecisionTimeout"; this.code = "decision_timeout"; }
}

const withTimeout = (promise, ms) => {
  if (!ms || !Number.isFinite(ms)) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new DecisionTimeout(ms)), ms); }),
  ]).finally(() => clearTimeout(timer));
};

/** The observation the agent sees after an execution or a rejection. Bounded. */
export function observationFor({ ok, result, error }) {
  if (ok) return { ok: true, result: boundedResult(result) };
  const code = error?.code || "unknown_action";
  const message = String(error?.message || "The action was not allowed").slice(0, 300);
  // The agent contract's code beside the workflow's own (agent-contract/contract.js).
  return { ok: false, code, message, error_code: classifyError({ code, message }).code };
}

/** No nested run rows, no answer-shaped payloads: strings, numbers, short lists. */
export function boundedResult(result) {
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
 * runAgentLoop → { ended, iterations, terminal, observations, fallback? }
 *   ended: "terminal" | "stop:<code>" | "tool_call_cap" | "agent_loop_cap" | "fallback"
 *
 * caps            { maxIterations, maxToolCalls, decisionTimeoutMs }
 * terminalActions actions that end the step once they succeed
 * finalActions    what the last iteration may offer (defaults to terminalActions)
 * stopCodes       rejection codes that end the step (the agent still sees them)
 * operation       which operation this step serves (passed to the agent)
 * record(entry)   { kind: "agent_error"|"malformed"|"model_refusal"|"decision"|"observation"|"timeout", iteration, ... }
 *                 model_refusal: the model declined (its fallback answered, or nothing did) — never a crash
 * onToolCallCap / onLoopCap   the workflow's cap policy (e.g. pause honestly)
 * fallback(info)  when a decision times out: the workflow's deterministic next step
 */
export async function runAgentLoop({
  agent, registry, goal, caps, operation = null,
  terminalActions = [], finalActions = null, stopCodes = [],
  record = async () => {}, onToolCallCap = async () => {}, onLoopCap = async () => {}, fallback = null,
  episode = null,   // agent-contract/episode.js recorder, when the run is recorded
}) {
  const { maxIterations, maxToolCalls = Infinity, decisionTimeoutMs = null } = caps || {};
  const observations = [];
  const finals = finalActions || terminalActions;
  const guard = createLoopGuard();
  let toolCalls = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    let step;
    try {
      // The agent knows its budget; the last iteration may only end the step.
      step = await withTimeout(agent.next({
        iteration, maxIterations, goal, operation, observations, tools: registry.catalogue,
        finalOnly: iteration === maxIterations ? finals : null,
      }), decisionTimeoutMs);
    } catch (error) {
      if (error instanceof DecisionTimeout && fallback) {
        await record({ kind: "timeout", iteration, reason: error.message });
        return { ended: "fallback", iterations: iteration, terminal: null, observations, fallback: await fallback({ iteration, observations }) };
      }
      // The provider call itself failed (rejected request, timeout): recorded, then the step fails.
      await record({ kind: "agent_error", iteration, reason: String(error?.message || error).slice(0, 240) }).catch(() => {});
      throw error;
    }

    // A refusal (§7.11.4) is its own observation: recorded, and the agent sees it.
    if (step?.refusal) {
      await record({ kind: "model_refusal", iteration, model: step.refusal.model, fallbackModel: step.refusal.fallbackModel || null, category: step.refusal.category ?? null });
      observations.push({ ok: false, code: "model_refusal", model: step.refusal.model, fallbackModel: step.refusal.fallbackModel || null });
    }
    const requested = step?.tool || step?.action;
    if (!requested) {
      if (!step?.refusal) await record({ kind: "malformed", iteration, reason: "no tool or action in agent response" });
      continue;
    }

    toolCalls += 1;
    if (toolCalls > maxToolCalls) {
      await onToolCallCap({ iteration });
      return { ended: "tool_call_cap", iterations: iteration - 1, terminal: null, observations };
    }

    const basis = registry.basisFor ? registry.basisFor(requested, step.args || {}) : null;
    await record({ kind: "decision", iteration, step, ...(basis ? { basis } : {}) });
    episode?.decision({ tool_calls: [{ name: requested, arguments: step.args || {} }], intent: step.intent || null });

    let observation;
    let stopped = null;
    let terminal = null;
    // The generic checks first (unknown tool, not permitted, schema); a
    // rejection is an observation the agent reads and adapts to.
    const verdict = registry.validate ? registry.validate(requested, step.args || {}) : { ok: true };
    if (!verdict.ok) {
      observation = observationFor({ ok: false, error: verdict });
    } else {
      try {
        const result = await registry.execute(requested, step.args || {}, step.intent || null);
        observation = observationFor({ ok: true, result });
        terminal = terminalActions.includes(step.action) || terminalActions.includes(step.tool) ? (step.action || step.tool) : null;
      } catch (error) {
        observation = observationFor({ ok: false, error });
        if (stopCodes.includes(error?.code)) stopped = error.code;
      }
    }
    // The same call again in a row: say so where the agent reads (a reminder, then a firmer one).
    const repeat = guard.note(requested, step.args || {});
    if (repeat) observation = { ...observation, reminder: repeat.text };
    // The agent's transcript names the tool each observation answers.
    // With think, the agent's own notes for the step ride along, so its analysis builds across decisions.
    observations.push({ tool: requested, ...(step.thinking ? { yourNotes: String(step.thinking).slice(0, 900) } : {}), ...observation });
    await record({ kind: "observation", iteration, observation, tool: requested });
    episode?.observation({ success: observation.ok === true, action: requested, result: observation.result ?? null, error: observation.ok ? null : observation.message, ...(observation.ok ? {} : { error_code: observation.error_code }) });
    if (stopped) return { ended: `stop:${stopped}`, iterations: iteration, terminal: null, observations };
    if (terminal) return { ended: "terminal", iterations: iteration, terminal, observations };
  }

  await onLoopCap({ iterations: maxIterations });
  return { ended: "agent_loop_cap", iterations: maxIterations, terminal: null, observations };
}
