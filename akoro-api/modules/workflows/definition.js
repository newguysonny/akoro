/**
 * workflows/definition.js — what a workflow IS, as data, and the one
 * transition rule every workflow's state changes go through (Grand Plan §7.1,
 * Phase 1). PURE — no db, no clock.
 *
 *   const def = defineWorkflow({
 *     type: "study_prep", version: "1",
 *     states: [...], initial: "planning",
 *     transitions: { planning: ["awaiting_confirmation", ...], ... },
 *     statusOf: { planning: "active", awaiting_confirmation: "waiting_learner", ... },
 *   });
 *   assertTransition(def, "planning", "completed");   // throws TransitionError
 *
 * The rule is enforced, not advisory (Phase 0 finding F7): a state change a
 * definition doesn't list is refused with `invalid_state_transition`.
 */

/** Generic lifecycle statuses (workflow_instances.status) — what the dashboard needs. */
export const WORKFLOW_STATUSES = Object.freeze(["created", "active", "waiting_learner", "waiting_child", "paused", "completed", "abandoned", "cancelled"]);
export const TERMINAL_STATUSES = Object.freeze(["completed", "abandoned", "cancelled"]);
export const WORKFLOW_TYPES = Object.freeze(["study_prep", "teaching", "decay_review", "practice"]);

export class TransitionError extends Error {
  constructor(message, { from = null, to = null, kind = "state" } = {}) {
    super(message);
    this.name = "TransitionError";
    this.code = "invalid_state_transition";
    this.status = 409;
    this.httpStatus = 409;
    Object.assign(this, { from, to, kind });
  }
}

/**
 * Check and freeze a definition. Every state has a transition list and a
 * lifecycle status; transitions only name known states; terminal states
 * (status completed/abandoned/cancelled) lead nowhere.
 */
export function defineWorkflow({ type, version = "1", states, initial, transitions, statusOf, machines = {} }) {
  if (!type) throw new Error("defineWorkflow: type is required");
  const known = new Set(states || []);
  if (!known.size) throw new Error(`${type}: states are required`);
  if (!known.has(initial)) throw new Error(`${type}: initial state "${initial}" is not a state`);
  for (const state of known) {
    if (!Array.isArray(transitions?.[state])) throw new Error(`${type}: state "${state}" has no transition list`);
    for (const to of transitions[state]) if (!known.has(to)) throw new Error(`${type}: "${state}" → unknown state "${to}"`);
    const status = statusOf?.[state];
    if (!WORKFLOW_STATUSES.includes(status)) throw new Error(`${type}: state "${state}" has no lifecycle status`);
    if (TERMINAL_STATUSES.includes(status) && transitions[state].length) throw new Error(`${type}: terminal state "${state}" must lead nowhere`);
  }
  // Sub-machines (e.g. a Study Prep topic): their own states and transitions, same rule.
  const subs = {};
  for (const [name, m] of Object.entries(machines)) {
    const subKnown = new Set(m.states || []);
    for (const state of subKnown) {
      if (!Array.isArray(m.transitions?.[state])) throw new Error(`${type}.${name}: state "${state}" has no transition list`);
      for (const to of m.transitions[state]) if (!subKnown.has(to)) throw new Error(`${type}.${name}: "${state}" → unknown state "${to}"`);
    }
    subs[name] = Object.freeze({ states: Object.freeze([...subKnown]), transitions: Object.freeze({ ...m.transitions }) });
  }
  return Object.freeze({
    type, version, initial,
    states: Object.freeze([...known]),
    transitions: Object.freeze({ ...transitions }),
    statusOf: Object.freeze({ ...statusOf }),
    machines: Object.freeze(subs),
  });
}

/** May `from` move to `to`? (Staying put is not a transition.) `machine` picks a sub-machine. */
export function canTransition(def, from, to, machine = null) {
  const m = machine ? def.machines[machine] : def;
  if (!m) return false;
  return (m.transitions[from] || []).includes(to);
}

/** Throw TransitionError unless `from` → `to` is listed. */
export function assertTransition(def, from, to, machine = null) {
  if (canTransition(def, from, to, machine)) return true;
  const what = machine ? `${def.type} ${machine}` : def.type;
  throw new TransitionError(`A ${what} can't go from ${from} to ${to}`, { from, to, kind: machine || "state" });
}

/** The lifecycle status of a domain state. */
export function statusFor(def, state) {
  return def.statusOf[state] || null;
}

export const isTerminalStatus = (status) => TERMINAL_STATUSES.includes(status);
