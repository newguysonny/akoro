/**
 * modules/self-tooling/bind.js — parameters: a small JSON-Schema subset and
 * "$name" references inside a definition.
 */
import { ToolError } from "./ops.js";

export const PARAM_TYPES = new Set(["string", "number", "integer", "boolean"]);
export const MAX_PARAMS = 6;

/**
 * Keep only well-formed params (the agent sometimes passes data as a param:
 * a list of sessions, a nested object). → { params, dropped: [names] }
 */
export function wellFormedParams(params) {
  const kept = {}, dropped = [];
  for (const [k, p] of Object.entries(params || {})) {
    if (p && typeof p === "object" && !Array.isArray(p) && (PARAM_TYPES.has(p.type) || Array.isArray(p.enum))) kept[k] = p;
    else dropped.push(k);
  }
  return { params: kept, dropped };
}

/** Validate a params schema: { name: { type, description?, enum?, default? } }. → errors[] */
export function validateParams(params) {
  const errors = [];
  if (params == null) return errors;
  if (typeof params !== "object" || Array.isArray(params)) return ["params must be an object"];
  const props = params.properties && typeof params.properties === "object" ? params.properties : params;
  const names = Object.keys(props);
  if (names.length > MAX_PARAMS) errors.push(`at most ${MAX_PARAMS} params`);
  for (const [k, p] of Object.entries(props)) {
    if (!/^[a-z][a-zA-Z0-9_]{0,31}$/.test(k)) errors.push(`param name ${k} is invalid`);
    if (!p || !PARAM_TYPES.has(p.type) && !Array.isArray(p.enum)) errors.push(`param ${k}: type must be string, number, integer, boolean or enum`);
  }
  return errors;
}

export const paramProps = (params) => (params?.properties && typeof params.properties === "object" ? params.properties : params || {});

/** Inputs coerced to the declared types, with defaults. Unknown inputs are dropped. */
export function coerceInput(params, input = {}) {
  const out = {};
  for (const [k, p] of Object.entries(paramProps(params))) {
    let v = input?.[k];
    // An explicitly passed "" is a VALUE for a string param, not a missing
    // input — honour it (a blank text filter then matches nothing; ops.js).
    // Before this, "" silently became the param's default, so "run with an
    // empty phrase" ran with whatever target the default named (live,
    // 2026-11-17). Defaults fill only absent values (undefined/null), plus
    // "" for non-string params, where "" cannot be a real value.
    const isStringParam = p.type === "string" || p.type == null || Array.isArray(p.enum);
    if (v === undefined || v === null || (v === "" && !isStringParam)) v = p.default;
    if (v === undefined) continue;
    if (p.type === "number" || p.type === "integer") { v = Number(v); if (!Number.isFinite(v)) throw new ToolError(`${k} must be a number`); if (p.type === "integer") v = Math.round(v); }
    else if (p.type === "boolean") v = v === true || v === "true";
    else v = String(v).slice(0, 200);
    if (Array.isArray(p.enum) && !p.enum.includes(v)) throw new ToolError(`${k} must be one of ${p.enum.join(", ")}`);
    out[k] = v;
  }
  return out;
}

/** Every "$name" string in a definition. */
export function refsIn(value, acc = new Set()) {
  if (typeof value === "string" && /^\$[a-zA-Z][a-zA-Z0-9_]*$/.test(value)) acc.add(value.slice(1));
  else if (Array.isArray(value)) value.forEach((v) => refsIn(v, acc));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => refsIn(v, acc));
  return acc;
}

/** Replace "$name" with input values (missing → null). */
export function bind(value, input) {
  if (typeof value === "string" && /^\$[a-zA-Z][a-zA-Z0-9_]*$/.test(value)) return input[value.slice(1)] ?? null;
  if (Array.isArray(value)) return value.map((v) => bind(v, input));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bind(v, input)]));
  return value;
}
