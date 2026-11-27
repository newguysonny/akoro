/**
 * modules/self-tooling/modeSpec.js — MODE tools (Plugin Runtime, 2026-11-27).
 *
 * A data tool answers from rows; a mode tool runs an interactive protocol
 * in the chat: a `steer` (the behaviour contract the agent follows while
 * the mode is live), a `state` document the tool owns (coverage lists,
 * phases, question logs — what its tab renders), and declared `actions`
 * the agent calls (via run_mode_action) to move that state. Actions are
 * declarative effects over the state — set / inc / append / mark / flip —
 * never code, so a mode tool is as safe to build as a recipe.
 *
 * Pure: validation and effect application are functions of their inputs.
 */

export const MODE_LIMITS = Object.freeze({
  steerChars: 4000,
  stateBytes: 8192,
  actions: 10,
  effectsPerAction: 8,
  listMax: 100,
});

const ACTION_NAME = /^[a-z][a-z0-9_]{1,40}$/;
const PARAM_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);
const EFFECT_OPS = new Set(["set", "inc", "append", "mark", "flip"]);

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);

/** Dot-path segments of a state path ("coverage" / "session.minutes"). */
const pathParts = (p) => (typeof p === "string" ? p.split(".").filter((s) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(s)) : []);
const validPath = (p) => { const parts = pathParts(p); return parts.length >= 1 && parts.length <= 3 && parts.join(".") === p; };

/** "$argName" references inside an effect value (one level of objects/arrays). */
function argRefs(v, out = new Set()) {
  if (typeof v === "string" && v.startsWith("$")) out.add(v.slice(1));
  else if (Array.isArray(v)) v.forEach((x) => argRefs(x, out));
  else if (isObj(v)) Object.values(v).forEach((x) => argRefs(x, out));
  return out;
}

function validateEffect(fx, action, stateKeys, errors, at) {
  if (!isObj(fx) || !EFFECT_OPS.has(fx.op)) { errors.push(`${at}: op must be one of ${[...EFFECT_OPS].join(", ")}`); return; }
  if (!validPath(fx.path)) { errors.push(`${at}: "path" must be a state path like "phase" or "session.minutes"`); return; }
  const root = fx.path.split(".")[0];
  if (!stateKeys.has(root)) errors.push(`${at}: path "${fx.path}" — the state has no "${root}"`);
  const params = action.params || {};
  for (const ref of argRefs(fx.value)) {
    if (ref === "today" || ref === "now") continue;
    if (!(ref in params)) errors.push(`${at}: value uses $${ref} but the action declares no such param`);
  }
  if (fx.op === "mark") {
    if (typeof fx.matchField !== "string" || !fx.matchField) errors.push(`${at}: mark needs a matchField (the item field to match)`);
    if (typeof fx.matchFrom !== "string" || !(fx.matchFrom in params)) errors.push(`${at}: mark needs matchFrom naming one of the action's params`);
    if (!isObj(fx.set) || !Object.keys(fx.set).length) errors.push(`${at}: mark needs a non-empty "set" of fields to write on matched items`);
    for (const ref of argRefs(fx.set)) if (ref !== "today" && ref !== "now" && !(ref in params)) errors.push(`${at}: set uses $${ref} but the action declares no such param`);
  }
  if (fx.op === "flip") {
    if (typeof fx.field !== "string" || !fx.field) errors.push(`${at}: flip needs the item "field" whose value changes`);
    if (fx.from === undefined || fx.to === undefined) errors.push(`${at}: flip needs "from" and "to" values`);
  }
  if (fx.op === "inc" && fx.by !== undefined && typeof fx.by !== "number") errors.push(`${at}: inc "by" must be a number`);
}

/**
 * Validate a mode definition. → { ok, errors }
 * The definition: { kind: "mode", steer, state: {…initial}, actions: […] }.
 */
export function validateModeDefinition(def) {
  const errors = [];
  if (!isObj(def)) return { ok: false, errors: ["definition must be an object"] };
  if (def.kind !== "mode") errors.push('kind must be "mode"');
  if (typeof def.steer !== "string" || def.steer.trim().length < 40) errors.push("steer must say how the agent behaves in this mode (at least a sentence or two)");
  if (typeof def.steer === "string" && def.steer.length > MODE_LIMITS.steerChars) errors.push(`steer is over ${MODE_LIMITS.steerChars} characters`);
  if (!isObj(def.state)) errors.push("state must be an object — the tool's initial state document");
  const stateKeys = new Set(isObj(def.state) ? Object.keys(def.state) : []);
  if (isObj(def.state) && JSON.stringify(def.state).length > MODE_LIMITS.stateBytes) errors.push(`state is over ${MODE_LIMITS.stateBytes} bytes`);
  if (!Array.isArray(def.actions) || !def.actions.length) errors.push("actions must be a non-empty list — the named steps the agent calls to move the state");
  const seen = new Set();
  for (const [i, a] of (Array.isArray(def.actions) ? def.actions : []).entries()) {
    const at = `actions[${i}]${a?.name ? ` (${a.name})` : ""}`;
    if (!isObj(a)) { errors.push(`${at}: an action must be an object`); continue; }
    if (!ACTION_NAME.test(String(a.name || ""))) errors.push(`${at}: name must be snake_case`);
    if (a.name && seen.has(a.name)) errors.push(`${at}: duplicate action name`);
    seen.add(a.name);
    if (typeof a.description !== "string" || a.description.trim().length < 8) errors.push(`${at}: give a description the agent can act on`);
    for (const [p, spec] of Object.entries(a.params || {})) {
      if (!isObj(spec) || !PARAM_TYPES.has(spec.type)) errors.push(`${at}: param "${p}" needs a type of ${[...PARAM_TYPES].join("|")}`);
    }
    if (!Array.isArray(a.effects) || !a.effects.length) errors.push(`${at}: effects must be a non-empty list`);
    if (Array.isArray(a.effects) && a.effects.length > MODE_LIMITS.effectsPerAction) errors.push(`${at}: over ${MODE_LIMITS.effectsPerAction} effects`);
    for (const [j, fx] of (Array.isArray(a.effects) ? a.effects : []).entries()) validateEffect(fx, a, stateKeys, errors, `${at}.effects[${j}]`);
  }
  if (Array.isArray(def.actions) && def.actions.length > MODE_LIMITS.actions) errors.push(`over ${MODE_LIMITS.actions} actions`);
  return { ok: errors.length === 0, errors };
}

/** Substitute $param / $today / $now refs in a value (deep, one pass). */
export function substituteRefs(v, { args = {}, params = {}, now = new Date() } = {}) {
  if (typeof v === "string" && v.startsWith("$")) {
    const key = v.slice(1);
    if (key === "today") return now.toISOString().slice(0, 10);
    if (key === "now") return now.toISOString();
    if (key in args) return args[key];
    if (key in params) return params[key];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      // A longer string that happens to start with $ — fall through to
      // embedded interpolation below.
    } else return v;
  }
  if (typeof v === "string" && v.includes("$")) {
    // Embedded refs ("State what $topic is…") interpolate too — the builder
    // writes content templates, and a raw $ref must never reach the state
    // the agent teaches from or the tab renders (live, 2026-11-27). A $name
    // that resolves to nothing is left exactly as written.
    return v.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, key) => {
      if (key === "today") return now.toISOString().slice(0, 10);
      if (key === "now") return now.toISOString();
      if (key in args) return String(args[key]);
      if (key in params) return String(params[key]);
      return m;
    });
  }
  if (Array.isArray(v)) return v.map((x) => substituteRefs(x, { args, params, now }));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substituteRefs(x, { args, params, now })]));
  return v;
}

const getPath = (obj, parts) => parts.reduce((cur, p) => (cur == null ? undefined : cur[p]), obj);
function setPath(obj, parts, value) {
  let cur = obj;
  for (const p of parts.slice(0, -1)) { if (!isObj(cur[p])) cur[p] = {}; cur = cur[p]; }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Apply one declared action's effects to a state document.
 * → { ok, state } | { ok: false, error }. Never mutates the input state.
 */
export function applyModeAction(def, state, actionName, args = {}, now = new Date()) {
  const action = (def?.actions || []).find((a) => a.name === actionName);
  if (!action) return { ok: false, error: `This tool has no action called "${actionName}". Its actions: ${(def?.actions || []).map((a) => a.name).join(", ") || "none"}.` };
  for (const [p, spec] of Object.entries(action.params || {})) {
    const v = args?.[p];
    if (v === undefined || v === null) {
      if (spec.required) return { ok: false, error: `Action "${actionName}" needs "${p}".` };
      continue;
    }
    const typeOk = { string: typeof v === "string", number: typeof v === "number", integer: Number.isInteger(v), boolean: typeof v === "boolean", array: Array.isArray(v), object: isObj(v) }[spec.type];
    if (typeOk === false) return { ok: false, error: `Action "${actionName}": "${p}" must be a ${spec.type}.` };
  }
  const next = JSON.parse(JSON.stringify(state || {}));
  const sub = (v) => substituteRefs(v, { args, now });
  for (const fx of action.effects || []) {
    const parts = pathParts(fx.path);
    if (!parts.length) return { ok: false, error: `Bad state path "${fx.path}".` };
    if (fx.op === "set") setPath(next, parts, sub(fx.value));
    else if (fx.op === "inc") {
      const cur = getPath(next, parts);
      setPath(next, parts, (typeof cur === "number" ? cur : 0) + (typeof fx.by === "number" ? fx.by : 1));
    } else if (fx.op === "append") {
      const cur = getPath(next, parts);
      const list = Array.isArray(cur) ? cur : [];
      if (list.length >= MODE_LIMITS.listMax) return { ok: false, error: `"${fx.path}" is full (${MODE_LIMITS.listMax} items).` };
      list.push(sub(fx.value));
      setPath(next, parts, list);
    } else if (fx.op === "mark") {
      const list = getPath(next, parts);
      if (!Array.isArray(list)) return { ok: false, error: `"${fx.path}" is not a list.` };
      const want = args?.[fx.matchFrom];
      let hit = 0;
      for (const item of list) {
        if (isObj(item) && String(item[fx.matchField] ?? "").toLowerCase() === String(want ?? "").toLowerCase()) {
          for (const [k, v] of Object.entries(fx.set || {})) item[k] = sub(v);
          hit++;
        }
      }
      if (!hit) return { ok: false, error: `No item in "${fx.path}" has ${fx.matchField} = "${want}".` };
    } else if (fx.op === "flip") {
      const list = getPath(next, parts);
      if (!Array.isArray(list)) return { ok: false, error: `"${fx.path}" is not a list.` };
      for (const item of list) if (isObj(item) && item[fx.field] === fx.from) item[fx.field] = fx.to;
    }
  }
  return { ok: true, state: next };
}

/** The tool's initial state for a run: the definition's state with $param refs filled from the run input. */
export function initialModeState(def, runInput = {}) {
  return substituteRefs(JSON.parse(JSON.stringify(def?.state || {})), { params: runInput });
}
