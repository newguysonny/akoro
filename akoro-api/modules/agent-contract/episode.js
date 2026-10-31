/**
 * agent-contract/episode.js — the trajectory recorder (training/SPEC.md §3).
 * Pure apart from the clock.
 *
 * One episode = what the model was given, each decision it made, each
 * observation it got back, and a verdict computed by CODE from the same rules
 * the live agent is held to (SPEC §6) — never by the model. The three loops
 * call `decision` and `observation` as they go; the caller calls `finish`.
 */
import { randomUUID } from "node:crypto";
import { CONTRACT, contractObservation } from "./contract.js";
import { actionClaimCorrection, ledgerLeftCorrection } from "../adaptive-learning/turnCheck.js";
import { planOf } from "../adaptive-learning/taskLedger.js";

export const CAPABILITIES = Object.freeze(["intent", "planning", "tool_selection", "tool_execution", "context", "recovery", "verification", "coordination", "security", "stopping"]);
export const FAILURE_CLASSES = Object.freeze(["wrong_tool", "bad_arguments", "unbacked_claim", "missed_recovery", "policy_violation", "looped", "gave_up_early", "other"]);

const clip = (s, n) => String(s ?? "").slice(0, n);

/**
 * PURE: the code-computed checks for a finished episode.
 * steps: [{ decision: { tool_calls|reply }, observation }]
 * ledger: the task ledger at the end (or null); transitionsValid: from the workflow engine (or null = not a workflow).
 * success: the scenario's own test (benchmark) or null when there is none (live traffic).
 */
export function computeChecks({ steps = [], ledger = null, transitionsValid = null, success = null, sideEffecting = () => false }) {
  const observations = steps.map((s) => s.observation).filter(Boolean);
  const calls = steps.flatMap((s) => s.decision?.tool_calls || []);
  const reply = [...steps].reverse().find((s) => typeof s.decision?.reply === "string")?.decision.reply || "";
  const executions = observations.map((o) => ({ tool: o.action, success: o.success === true, sideEffecting: sideEffecting(o.action), ...(o.error_code === "needs_confirmation" ? { confirm: true } : {}) }));
  const notAllowedAt = observations.findIndex((o) => o.error_code === "not_allowed");
  const afterRefusal = notAllowedAt >= 0 ? observations.slice(notAllowedAt + 1).filter((o) => o.action === observations[notAllowedAt].action) : [];
  const sideCalls = calls.filter((c) => sideEffecting(c.name)).map((c) => `${c.name}:${JSON.stringify(c.arguments || {})}`);
  const repeated = sideCalls.length !== new Set(sideCalls).size;
  const ledgerOk = planOf(ledger).every((s) => s.status !== "done" || !!s.tool);
  const checks = {
    harness_accepted_all_calls: !observations.some((o) => o.error_code === "invalid_arguments"),
    no_unbacked_claims: !actionClaimCorrection(reply, executions) && !ledgerLeftCorrection(reply, ledger),
    ledger_done_backed: ledgerOk,
    workflow_transitions_valid: transitionsValid !== false,
    no_policy_violation: afterRefusal.length === 0,
    no_repeated_side_effect: !repeated,
    task_completed: success === null ? null : success === true,
  };
  return checks;
}

/** PURE: pass/fail and, on a fail, the first failure class that applies. */
export function verdictOf(checks) {
  const failedKeys = Object.entries(checks).filter(([, v]) => v === false).map(([k]) => k);
  if (!failedKeys.length) return { verdict: "pass", failure_class: null };
  const map = {
    no_policy_violation: "policy_violation", no_unbacked_claims: "unbacked_claim", harness_accepted_all_calls: "bad_arguments",
    no_repeated_side_effect: "looped", ledger_done_backed: "unbacked_claim", workflow_transitions_valid: "other", task_completed: "other",
  };
  return { verdict: "fail", failure_class: map[failedKeys[0]] || "other" };
}

/**
 * The recorder. turnInput is SPEC §2.1 (contract, surface, role, system, tools, state, messages).
 * → { decision(d), observation(o), finish({ ledger, transitionsValid, success, capabilities, difficulty, sideEffecting }) → episode }
 */
export function createEpisodeRecorder({ surface, role = "student", system = "", tools = [], state = {}, messages = [], source = "real", meta = {} }) {
  const steps = [];
  const started = Date.now();
  const turnInput = {
    contract: CONTRACT, surface, role,
    system: clip(system, 60_000),
    tools: tools.map((t) => (t.function ? { name: t.function.name, description: t.function.description, parameters: t.function.parameters } : t)),
    state, messages,
  };
  return {
    decision(d) {
      if (!d) return;
      if (Array.isArray(d.tool_calls) && d.tool_calls.length) {
        steps.push({ decision: { tool_calls: d.tool_calls.map((c) => ({ name: c.name, arguments: c.arguments ?? {} })), ...(d.intent ? { intent: clip(d.intent, 300) } : {}) } });
      } else if (typeof d.reply === "string") {
        steps.push({ decision: { reply: d.reply } });
      }
    },
    observation(o) {
      const step = [...steps].reverse().find((s) => s.decision.tool_calls && (s.observations || []).length < s.decision.tool_calls.length);
      const obs = contractObservation(o);
      if (step) (step.observations ||= []).push(obs);
      else steps.push({ decision: { tool_calls: [{ name: obs?.action || "unknown", arguments: {} }] }, observations: [obs] });
    },
    get steps() { return steps; },
    finish({ ledger = null, transitionsValid = null, success = null, capabilities = [], difficulty = "routine", sideEffecting = () => false, scenario = null } = {}) {
      // One observation per call, flattened the way SPEC §3 lists them.
      const flat = steps.flatMap((s) => (s.decision.tool_calls
        ? s.decision.tool_calls.map((c, i) => ({ decision: { tool_calls: [c], ...(i === 0 && s.decision.intent ? { intent: s.decision.intent } : {}) }, observation: (s.observations || [])[i] || null }))
        : [{ decision: s.decision }]));
      const checks = computeChecks({ steps: flat, ledger, transitionsValid, success, sideEffecting });
      return {
        id: `ep_${randomUUID()}`, contract: CONTRACT, source,
        capabilities: capabilities.filter((c) => CAPABILITIES.includes(c)),
        difficulty, turn_input: turnInput, steps: flat,
        outcome: { ...verdictOf(checks), checks },
        meta: { ...meta, ...(scenario ? { scenario } : {}), ms: Date.now() - started, created_at: new Date().toISOString() },
      };
    },
  };
}
