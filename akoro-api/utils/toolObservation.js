/**
 * toolObservation.js — the structured observation envelope for agent tool
 * results (REASON → ACT → OBSERVE → LLM).
 *
 * Every tool execution is normalised to one shape before it becomes a tool
 * message in the model transcript, so the model confirms what the backend
 * actually did instead of guessing:
 *
 *   {
 *     "success": true,
 *     "request_id": "req_8f72a1",
 *     "action": "create_task",
 *     "result": { "taskId": "todo_123", "title": "Buy groceries" },
 *     "error": null
 *   }
 *
 * `success` is explicit when the tool sets it; otherwise it is inferred —
 * a tool that returned an `error` failed, anything else succeeded. The
 * tool's own top-level `success`/`error` keys are hoisted into the envelope
 * (never duplicated inside `result`). The shape mirrors the private Akoro
 * tools gateway contract already spoken by the Python agent
 * (`{success, result, error}`), with request/action correlation added so a
 * confirmation can be traced to exactly one execution.
 */
import { randomBytes } from "node:crypto";

const MAX_ERROR_CHARS = 500;
const MAX_ACTION_CHARS = 80;
const MAX_REQUEST_ID_CHARS = 40;

/** Short, log-friendly correlation id for one tool execution. */
export function newToolRequestId() {
  return `req_${randomBytes(4).toString("hex")}`;
}

/**
 * Normalise one raw tool result into the observation envelope.
 *
 * @param {object} options
 * @param {string} options.action       Tool name, e.g. "create_task".
 * @param {any}    options.result       Whatever the tool returned.
 * @param {string} [options.requestId]  Correlation id (newToolRequestId()).
 * @param {object} [options.extra]      Extra envelope-level flags merged in
 *                                      (e.g. { alreadyDone: true, note }).
 * @returns {{ success: boolean, request_id: string|null, action: string,
 *              result: any, error: string|null }}
 */
export function toolObservation({ action, result, requestId = null, extra = null } = {}) {
  const payload = result === undefined ? null : result;
  const canHoist = payload !== null && typeof payload === "object" && !Array.isArray(payload);

  const explicitSuccess = canHoist && typeof payload.success === "boolean"
    ? payload.success
    : null;
  const rawError = canHoist && typeof payload.error === "string"
    ? payload.error.trim()
    : "";
  const error = rawError ? rawError.slice(0, MAX_ERROR_CHARS) : null;
  // An error string always means failure (an optimistic success flag beside
  // an error is a bug in the tool, not a success); otherwise an explicit
  // flag wins, and anything else succeeded.
  const success = error ? false : (explicitSuccess ?? true);

  let normalisedResult;
  if (!canHoist) {
    // Arrays pass through untouched; scalars/null get a stable { value } wrap
    // so `result` is always inspectable, mirroring the tools gateway.
    normalisedResult = Array.isArray(payload) ? payload : (payload === null ? null : { value: payload });
  } else if (explicitSuccess === null && rawError === "") {
    normalisedResult = payload;   // plain read result — keep exactly as returned
  } else {
    const { success: _success, error: _error, ...rest } = payload;
    normalisedResult = rest;      // hoisted keys live on the envelope only
  }

  return {
    success,
    request_id: requestId ? String(requestId).slice(0, MAX_REQUEST_ID_CHARS) : null,
    action: String(action || "unknown_tool").slice(0, MAX_ACTION_CHARS),
    result: normalisedResult,
    error,
    ...(extra && typeof extra === "object" ? extra : {}),
  };
}
