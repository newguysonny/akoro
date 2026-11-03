/**
 * agent-runtime/actionBasis.js — asked or inferred, on every agent action
 * (Grand Plan Phase 18, item 6).
 *
 * Every side-effecting agent action records its basis:
 *   explicit  a person (learner, instructor or admin) asked for it — in this
 *             conversation, or by tapping Approve / Confirm on it
 *   inferred  the agent decided it; then `rule` names what allowed it:
 *             a consent, a proactive kind, a workflow policy, an approved
 *             request ("proactive:study_plan", "workflow:study_prep", …)
 * An inferred action with no rule is refused (`no_rule_for_inferred_action`),
 * the same way in every loop: the workflow registry (tools.js), Agent Chat's
 * tools (chat.js executeChatTool) and proactive deliveries.
 *
 * The basis travels with the work in an AsyncLocalStorage scope, so the
 * writers deep below a tool (the self-tooling audit, a change card) record
 * it without every call in between passing it on.
 *
 *   actionBasis(given, fallback)     → { basis, rule } (an unknown basis reads as inferred)
 *   basisRefusal(b, { sideEffecting }) → null | { code, message }
 *   basisColumns(b)                  → { basis, basis_rule } for a row
 *   RULES.*                          the rule names, one shape everywhere
 *   withActionBasis(b, fn) / currentActionBasis()
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const BASES = Object.freeze(["explicit", "inferred"]);
export const NO_RULE_CODE = "no_rule_for_inferred_action";

/** The rule names: what may allow an inferred action. */
export const RULES = Object.freeze({
  proactive: (kind) => `proactive:${kind}`,
  workflow: (type) => `workflow:${type}`,
  consent: (name) => `consent:${name}`,
  request: (id) => `approved_request:${id}`,
});

const cleanRule = (rule) => {
  const text = typeof rule === "string" ? rule.replace(/[\r\n\u0000]+/g, " ").trim().slice(0, 120) : "";
  return text || null;
};

/**
 * PURE: a normalised basis. `given` is "explicit" | "inferred" | { basis, rule }.
 * A basis that is neither reads as inferred (fail closed: it then needs a rule).
 */
export function actionBasis(given, fallback = null) {
  const raw = given == null ? fallback : given;
  if (raw == null) return null;
  const obj = typeof raw === "string" ? { basis: raw } : raw;
  const basis = BASES.includes(obj?.basis) ? obj.basis : "inferred";
  return { basis, rule: cleanRule(obj?.rule) };
}

/** PURE: refuse an inferred side-effecting action that names no rule. Reads and explicit actions pass. */
export function basisRefusal(b, { sideEffecting = true, action = null } = {}) {
  if (!sideEffecting || !b) return null;
  if (b.basis === "explicit") return null;
  if (b.basis === "inferred" && cleanRule(b.rule)) return null;
  return {
    code: NO_RULE_CODE,
    message: `${action ? `${action}: ` : ""}nobody asked for this change and no consent, proactive kind or workflow policy allows it, so it was not done. Ask the person first.`,
  };
}

/** PURE: the columns a row stores (edu.self_tool_events, agent_tool_write_confirmations, agent_proposals, verify_real_user_runs). */
export function basisColumns(b) {
  const n = actionBasis(b);
  return n ? { basis: n.basis, basis_rule: n.rule } : {};
}

/** PURE: the API fields for a stored row (absent on rows written before the column existed). */
export function basisOfRow(row, fallback = null) {
  if (!row?.basis) return fallback ? { basis: fallback.basis, rule: fallback.rule ?? null } : { basis: null, rule: null };
  return { basis: row.basis, rule: row.basis_rule ?? null };
}

const scope = new AsyncLocalStorage();

/** Run fn with this basis as the current one (nested calls inherit it). */
export function withActionBasis(b, fn) {
  const n = actionBasis(b);
  return n ? scope.run(n, fn) : fn();
}

/** The basis of the work running now, or null outside any. */
export function currentActionBasis() {
  return scope.getStore() || null;
}
