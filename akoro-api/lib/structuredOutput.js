/**
 * lib/structuredOutput.js — one tolerant reader for model JSON.
 *
 * Providers differ in how strictly they honour a JSON schema (and the OpenCode
 * gateway may translate it into a prompt). Rather than every feature parsing
 * on its own, lib/aiModel.js normalises every `response_format: json_schema`
 * reply with these helpers: parse the body/fence/embedded object, check the
 * schema's required keys and types, and retry once if it is unusable.
 *
 * PURE — no DB, no provider calls.
 */

/** Parse JSON from a clean body, a fenced block, or the first balanced object. */
export function parseLooseJson(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const candidates = [raw];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* try inside */ }
    const a = candidate.indexOf("{");
    const b = candidate.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try { return JSON.parse(candidate.slice(a, b + 1)); } catch { /* next */ }
    }
  }
  return null;
}

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const typeOf = (v) => Array.isArray(v) ? "array" : v === null ? "null" : typeof v;

function typeMatches(value, type) {
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "object") return isObj(value);
  if (type === "array") return Array.isArray(value);
  if (type === "null") return value === null;
  return typeOf(value) === type;
}

/** Required keys and types only — enough to know if a retry is worthwhile. */
export function validateShape(value, schema, path = "root") {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;
  const union = schema.anyOf || schema.oneOf;
  if (Array.isArray(union) && union.length) {
    const best = union.map((s) => validateShape(value, s, path)).sort((a, b) => a.length - b.length)[0];
    return best || [];
  }
  const types = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : []);
  if (types.length && !types.some((t) => typeMatches(value, t))) {
    errors.push(`${path}: expected ${types.join("|")}, got ${typeOf(value)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not one of the allowed values`);
  if (types.includes("object") || (isObj(value) && schema.properties)) {
    if (!isObj(value)) return errors;
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${path}.${key}: required`);
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (key in value) errors.push(...validateShape(value[key], sub, `${path}.${key}`));
    }
  }
  if (types.includes("array") || (Array.isArray(value) && schema.items)) {
    if (Array.isArray(value) && schema.items) {
      value.forEach((item, i) => errors.push(...validateShape(item, schema.items, `${path}[${i}]`)));
    }
  }
  return errors;
}

const defaultFor = (schema = {}) => {
  const t = Array.isArray(schema.type) ? schema.type.find((x) => x !== "null") : schema.type;
  if (t === "string") return "";
  if (t === "integer" || t === "number") return 0;
  if (t === "boolean") return false;
  if (t === "array") return [];
  if (t === "object") return {};
  return null;
};

/** Structural repair: unwrap, coerce scalars, fill required keys with empty values. */
export function repairShape(value, schema) {
  if (!schema || typeof schema !== "object") return value;
  const union = schema.anyOf || schema.oneOf;
  if (Array.isArray(union) && union.length) return repairShape(value, union[0]);
  const types = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : []);
  if (!types.length) return value;
  if (types.includes("object")) {
    if (Array.isArray(value) && value.length === 1 && isObj(value[0])) value = value[0];
    if (!isObj(value)) value = {};
    for (const key of schema.required || []) {
      if (!(key in value)) value[key] = defaultFor(schema.properties?.[key]);
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (key in value) value[key] = repairShape(value[key], sub);
    }
    return value;
  }
  if (types.includes("array")) {
    if (!Array.isArray(value)) value = value == null ? [] : [value];
    return schema.items ? value.map((v) => repairShape(v, schema.items)) : value;
  }
  if (types.includes("integer") || types.includes("number")) {
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
    return value;
  }
  if (types.includes("string") && value != null && typeof value !== "string") return String(value);
  if (types.includes("boolean") && typeof value === "string" && /^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  return value;
}

/** Parse + validate + repair in one call. */
export function readStructured(text, schema) {
  const parsed = parseLooseJson(text);
  if (parsed == null) return { ok: false, value: null, errors: ["unparseable JSON"] };
  const value = repairShape(parsed, schema);
  const errors = validateShape(value, schema);
  return { ok: errors.length === 0, value, errors };
}

export function jsonRetryInstruction(schema, errors = []) {
  return [
    "Your previous reply was not valid JSON for the required shape.",
    errors.length ? `Problems: ${errors.slice(0, 4).join("; ")}.` : "",
    "Return ONLY one JSON value now — no prose, no markdown fences — that matches this JSON Schema:",
    JSON.stringify(schema),
  ].filter(Boolean).join("\n");
}
