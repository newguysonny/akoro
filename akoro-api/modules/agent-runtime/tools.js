/**
 * agent-runtime/tools.js — one binder for every workflow's tool registry
 * (Grand Plan §7.5, Phase 2).
 *
 * Levels:
 *   read     free, bounded, no state change, no cost
 *   propose  the harness validates, then executes
 *   execute  the harness executes only when a hard gate passes (cost, caps, learner gate)
 *   persona  calls a persona model (protégé, NaNa, Sargeant): costs tokens,
 *            produces learner-visible text or a judgement, NEVER changes
 *            state — its output is an observation
 *
 * bindRegistry({ definitions, args, harnessOnly, handlers, isEnabled, checks, basis })
 *   → { catalogue, validate(name, args), execute(name, args, intent), display(name), basisFor(name, args), timeLimitFor(name) }
 *
 * The generic checks every proposed action meets (§7.3): a name the
 * catalogue offers (tool_not_permitted), arguments that match its schema
 * (tool_schema_invalid). A workflow plugs its own checks in after them
 * (`checks`: (name, args, tool) → null | { code, message }, e.g. "is this
 * operation allowed in this state"); the deeper ones stay in its harness.
 *
 * Phase 18: a change (levels propose / execute) has a basis (actionBasis.js).
 * A workflow's agent decides its own actions, so they are inferred and the
 * registry must name the workflow policy that allows them (`basis`: an object
 * or (name, args) → basis); without one a change is refused with
 * `no_rule_for_inferred_action`. Every tool has a time limit (`timeLimitMs`
 * on its definition, else its level's default, toolTime.js); past it the
 * call fails with the code `timeout` instead of stalling the step.
 */
import { actionBasis, basisRefusal } from "./actionBasis.js";
import { timeLimitFor as familyLimit, withToolTimeLimit } from "./toolTime.js";

export const TOOL_LEVELS = Object.freeze(["read", "propose", "execute", "persona"]);
/** The levels that change something: these need a basis (Phase 18 item 6). */
export const CHANGE_LEVELS = Object.freeze(["propose", "execute"]);

const rejection = (code, message, httpStatus) => Object.assign(new Error(message), { code, httpStatus });
const notPermitted = (message) => rejection("tool_not_permitted", message, 403);

const TYPE_OK = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => v != null && typeof v === "object" && !Array.isArray(v),
};

/**
 * Do these arguments fit the schema? Required keys present, each given key of
 * the declared type and enum. Lenient on keys the schema doesn't name — a
 * model's extra field is ignored, not a rejection. → null | message.
 */
export function argsProblem(schema, args) {
  if (!schema || schema.type !== "object") return null;
  if (!TYPE_OK.object(args)) return "arguments must be an object";
  for (const key of schema.required || []) {
    if (args[key] === undefined || args[key] === null || args[key] === "") return `"${key}" is required`;
  }
  for (const [key, prop] of Object.entries(schema.properties || {})) {
    const value = args[key];
    if (value === undefined || value === null) continue;
    if (prop.type && TYPE_OK[prop.type] && !TYPE_OK[prop.type](value)) return `"${key}" must be ${prop.type === "array" ? "a list" : `a ${prop.type}`}`;
    if (Array.isArray(prop.enum) && !prop.enum.includes(value)) return `"${key}" must be one of ${prop.enum.join(", ")}`;
    if (prop.type === "array" && prop.items?.type && TYPE_OK[prop.items.type] && !value.every(TYPE_OK[prop.items.type])) return `every "${key}" item must be a ${prop.items.type}`;
  }
  return null;
}

export function bindRegistry({ definitions, args = {}, harnessOnly = [], handlers, isEnabled = () => true, checks = [], basis = null, emptyArgs = { type: "object", properties: {}, required: [], additionalProperties: false } }) {
  for (const d of definitions) {
    if (!TOOL_LEVELS.includes(d.level)) throw new Error(`${d.name}: unknown level "${d.level}"`);
    if (harnessOnly.includes(d.name)) throw new Error(`${d.name} is harness-only and can't be a tool`);
  }
  const byName = new Map(definitions.map((d) => [d.name, d]));
  const offered = definitions.filter((d) => isEnabled(d.name));

  const lookup = (name) => {
    const tool = byName.get(name);
    if (!tool || harnessOnly.includes(name)) throw notPermitted(`Unknown tool: ${name}`);
    if (!isEnabled(name)) throw notPermitted(`${name} is not enabled in this loop`);
    if (typeof handlers[name] !== "function") throw notPermitted(`Unhandled tool: ${name}`);
    return tool;
  };
  // The agent decided it: inferred, with the workflow's rule when the registry names one.
  const basisFor = (name, given) => actionBasis(typeof basis === "function" ? basis(name, given) : basis, { basis: "inferred", rule: null });
  const refusalFor = (tool, given) => basisRefusal(basisFor(tool.name, given), { sideEffecting: CHANGE_LEVELS.includes(tool.level), action: tool.name });

  return {
    // What the agent (LLM or stub) plans against: name, level, description, argument schema.
    catalogue: offered.map((d) => ({ name: d.name, level: d.level, description: d.description, args: args[d.name] || emptyArgs })),
    /** The generic checks, as a verdict — the loop turns a failure into an observation. */
    validate(name, given = {}) {
      let tool;
      try { tool = lookup(name); } catch (error) { return { ok: false, code: error.code, message: error.message }; }
      const problem = argsProblem(args[name], given);
      if (problem) return { ok: false, code: "tool_schema_invalid", message: `${name}: ${problem}` };
      for (const check of checks) {
        const verdict = check(name, given, tool);
        if (verdict) return { ok: false, code: verdict.code, message: verdict.message || "That action is not allowed now" };
      }
      const refused = refusalFor(tool, given);
      if (refused) return { ok: false, code: refused.code, message: refused.message };
      return { ok: true };
    },
    async execute(name, given = {}, intent = null) {
      const tool = lookup(name);
      // Checked again here: a caller that skips validate still can't make an unruled change.
      const refused = refusalFor(tool, given);
      if (refused) throw rejection(refused.code, refused.message, 403);
      const result = await withToolTimeLimit(() => handlers[name](given || {}, intent, tool), familyLimit(tool), name);
      // A persona speaks or judges; it never moves state — its output is all it returns.
      return tool.level === "persona" ? { persona: true, ...(result && typeof result === "object" ? result : { text: result }) } : result;
    },
    /** The basis a call of this tool records ({ basis, rule }). */
    basisFor(name, given = {}) { return basisFor(name, given); },
    /** How long a call of this tool may take before it fails with `timeout`. */
    timeLimitFor(name) { const tool = byName.get(name); return tool ? familyLimit(tool) : null; },
    /** The learner-language row for a tool (headline / description), never its name. */
    display(name) {
      return byName.get(name)?.display || { headline: "Working on your study plan", description: "A step in your study session" };
    },
  };
}
