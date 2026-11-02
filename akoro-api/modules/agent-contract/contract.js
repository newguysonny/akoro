/**
 * agent-contract/contract.js — the one agent contract (training/SPEC.md §2,
 * Grand Plan Phase 17, phase 1). Pure.
 *
 * The three agent loops — Agent Chat (adaptive-learning/chat.js), the
 * workflow loop (agent-runtime/loop.js) and the task runner
 * (tasks/lib/agentLoop.js) — speak this: an observation is the
 * utils/toolObservation.js envelope, and a failure carries one of the error
 * codes below, so the model (and the training data) see the same kinds of
 * failure everywhere, with the same expected behaviour.
 */
export const CONTRACT = "akoro-agent/1";

/** The error codes (SPEC §2.3): each with whether trying again can help. */
export const ERROR_CODES = Object.freeze({
  timeout: { retryable: true, behaviour: "read: retry once; change: check status before any retry — it may have run" },
  unavailable: { retryable: true, behaviour: "retry once, then the documented alternative or report" },
  invalid_arguments: { retryable: false, behaviour: "correct the arguments from the schema and the message; ask rather than invent" },
  missing_information: { retryable: false, behaviour: "ask the learner for it; never guess" },
  not_allowed: { retryable: false, behaviour: "stop and report; never retry or route around it" },
  needs_confirmation: { retryable: false, behaviour: "tell the learner to confirm; don't claim it happened" },
  not_found: { retryable: false, behaviour: "the documented alternative, or say nothing was found" },
  state_conflict: { retryable: false, behaviour: "read the state, pick an allowed move or explain" },
  insufficient_balance: { retryable: false, behaviour: "stop and say so" },
  repeated_failure: { retryable: false, behaviour: "escalate: say plainly what failed and offer the next step" },
  unknown: { retryable: false, behaviour: "say plainly what didn't work; don't claim it worked" },
});

// Codes the existing loops already use, mapped onto the contract's.
const ALIASES = Object.freeze({
  decision_timeout: "timeout", unknown_action: "invalid_arguments", malformed: "invalid_arguments",
  invalid_input: "invalid_arguments", bad_request: "invalid_arguments", forbidden: "not_allowed",
  unauthorized: "not_allowed", permission_denied: "not_allowed", not_ready: "state_conflict",
  wrong_state: "state_conflict", conflict: "state_conflict", no_balance: "insufficient_balance",
  wrong_type: "invalid_arguments", needs_permission: "needs_confirmation",
  // Phase 18: an inferred change with no rule allowing it (agent-runtime/actionBasis.js).
  no_rule_for_inferred_action: "not_allowed",
});

// Order matters: the first match wins.
const PATTERNS = [
  ["insufficient_balance", /\b(?:insufficient (?:balance|coins|credits?)|not enough (?:coins|credits?)|402|top up)\b/i],
  ["not_allowed", /\b(?:not allowed|forbidden|not permitted|permission|unauthori[sz]ed|403|only (?:an? )?admins?|isn't yours|not yours)\b/i],
  ["timeout", /\b(?:time[sd]?[- ]?out|timeout|took too long|deadline)\b/i],
  ["unavailable", /\b(?:unavailable|not answering|50[234]|econnrefused|econnreset|fetch failed|socket hang up|busy|overloaded|rate.?limit|429|try again (?:shortly|later|in a moment))\b/i],
  ["state_conflict", /\b(?:not in a state|already (?:started|running|finished|ended|cancell?ed|assigned|done)|409|conflict|isn't read yet|not ready)\b/i],
  ["not_found", /\b(?:not found|no such|doesn'?t exist|does not exist|404|nothing (?:matched|found))\b/i],
  ["missing_information", /\b(?:missing|which (?:subject|class|learners?|topic)|wasn'?t (?:given|said)|not said|please (?:give|tell|say))\b/i],
  ["invalid_arguments", /\b(?:invalid|is required|are required|must be|expected|schema|malformed|bad request|400|not a valid|too (?:long|short|many))\b/i],
];

/** PURE: a failure's code (and whether retrying can help). `err` is an envelope, a tool result, an Error or a string. */
export function classifyError(err) {
  if (err == null) return { code: "unknown", retryable: false };
  if (typeof err === "object" && (err.confirmation?.confirmationId || err.result?.confirmation?.confirmationId || err.needsConfirmation === true)) {
    return { code: "needs_confirmation", retryable: false };
  }
  const given = typeof err === "object" ? (err.error_code || err.code || err.error?.code) : null;
  const known = given && (ERROR_CODES[given] ? given : ALIASES[given]);
  if (known) return { code: known, retryable: ERROR_CODES[known].retryable };
  const status = typeof err === "object" ? Number(err.status ?? err.statusCode ?? err.response?.status) : NaN;
  const text = [
    typeof err === "string" ? err : "",
    typeof err === "object" ? [err.error?.message, typeof err.error === "string" ? err.error : "", err.message, err.reason, err.detail].filter((x) => typeof x === "string").join(" ") : "",
    Number.isFinite(status) ? String(status) : "",
  ].join(" ");
  for (const [code, re] of PATTERNS) if (re.test(text)) return { code, retryable: ERROR_CODES[code].retryable };
  return { code: "unknown", retryable: false };
}

/** The contract's observation: the envelope plus, on a failure, its error code. */
export function contractObservation(envelope) {
  if (!envelope || typeof envelope !== "object") return envelope;
  if (envelope.success !== false) return envelope;
  const { code, retryable } = classifyError(envelope.error_code ? envelope : { ...envelope, ...(envelope.result && typeof envelope.result === "object" ? envelope.result : {}) });
  return { ...envelope, error_code: code, retryable };
}
