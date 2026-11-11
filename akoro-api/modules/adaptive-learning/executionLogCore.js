/**
 * adaptive-learning/executionLogCore.js — the PURE half of the Phase 22
 * execution trace: redaction, error classification and step shaping. No db, so
 * the tests drive it directly. executionLog.js adds the best-effort writers.
 */

export const MAX_TEXT = 500;
const MAX_KEYS = 24;
const MAX_DEPTH = 2;
const SECRET_KEY = /(?:authorization|api[_-]?key|apikey|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|private[_-]?key|cookie)/i;

const cap = (text, n = MAX_TEXT) => String(text == null ? "" : text).slice(0, n);

/** PURE: scrub secrets and cap a value so it is safe to persist. */
export function redactValue(value, depth = 0) {
  if (value == null) return null;
  if (typeof value === "string") return cap(value, 240);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((v) => redactValue(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    const keys = Object.keys(value);
    for (const k of keys.slice(0, MAX_KEYS)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redactValue(value[k], depth + 1);
    }
    if (keys.length > MAX_KEYS) out["…"] = `+${keys.length - MAX_KEYS} more`;
    return out;
  }
  return String(value).slice(0, 240);
}

/** PURE: the redacted input stored for a step (never the raw arguments). */
export function redactInput(input) {
  const safe = redactValue(input, 0);
  return safe && typeof safe === "object" && !Array.isArray(safe) ? safe : {};
}

const ERROR_CLASSES = [
  ["timeout", /\b(?:time(?:d)?[- ]?out|timeout|stalled|not answering)\b/i],
  ["rate_limit", /\b(?:rate.?limit|429|too many requests)\b/i],
  ["unavailable", /\b(?:unavailable|503|502|504|econnrefused|econnreset|network|fetch failed|busy|overloaded)\b/i],
  ["auth", /\b(?:unauthori[sz]ed|forbidden|401|403|permission|not allowed|revoked)\b/i],
  ["validation", /\b(?:invalid|required|must be|missing|malformed|schema|validation)\b/i],
  ["database", /\b(?:relation|column|constraint|duplicate key|violates|postgres|\bsql\b|rls|foreign key)\b/i],
  ["not_found", /\b(?:not found|404|does not exist|no such)\b/i],
];

/** PURE: a coarse class for a failed tool result (for clustering + dashboards). */
export function classifyError(result) {
  const text = [result?.error, result?.message, result?.code, result?.reason, result?.detail]
    .filter((x) => typeof x === "string").join(" ");
  for (const [name, re] of ERROR_CLASSES) if (re.test(text)) return name;
  return text ? "error" : "unknown";
}

/** PURE: the failure message persisted (redacted + capped; no stack or internals dump). */
export function errorMessage(result) {
  const text = [result?.error, result?.message, result?.detail, result?.reason]
    .find((x) => typeof x === "string" && x.trim());
  return text ? cap(String(text).replace(/\s+/g, " ").trim(), 500) : null;
}

/** PURE: shape one completed tool call into a step row (no db). */
export function stepRow({ runId, iteration = 0, tool, input = {}, success = true, result = null, durationMs = null, retries = 0, requestId = null }) {
  const failed = !success;
  return {
    run_id: runId,
    iteration: Number.isInteger(iteration) ? iteration : 0,
    tool: String(tool || "unknown").slice(0, 80),
    input_redacted: redactInput(input),
    status: failed ? "failed" : "ok",
    error_class: failed ? classifyError(result) : null,
    error_message: failed ? errorMessage(result) : null,
    duration_ms: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
    retries: Math.max(0, Number(retries) || 0),
    request_id: requestId ? String(requestId).slice(0, 80) : null,
  };
}
