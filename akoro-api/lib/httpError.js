/**
 * lib/httpError.js — shared catch-all 500 responder.
 *
 * Postgres/PostgREST messages name tables, columns and constraints; returning
 * them to a client is free schema reconnaissance. Log the real error, return
 * a generic one. Deliberate 4xx errors meant for the caller should still use
 * explicit res.status(4xx).json({ error: "..." }).
 *
 * (modules/vouchers keeps its own copy of this — that module is deliberately
 * self-contained so it can be extracted into a standalone service.)
 */
export function serverError(res, e, req) {
  // A typed, deliberate fail-fast (breaker open, queue full) carries its own
  // status and Retry-After — honor it instead of flattening to 500. Only
  // errors WE threw qualify: expose + statusCode + a stable code. Library
  // errors that merely follow the http-errors expose convention (body-parser)
  // never carry our codes and fall through to the generic handling below.
  if (e?.expose === true && e?.code && Number.isInteger(e?.statusCode) && e.statusCode >= 400) {
    if (e.retryAfterSec) res.setHeader("Retry-After", String(e.retryAfterSec));
    return res.status(e.statusCode).json({
      success: false,
      error:   e.message,
      message: e.message,
      ...(e.code ? { code: e.code } : {}),
    });
  }
  // Postgres unique-constraint violations are the caller's conflict to
  // resolve, not a server fault — but the constraint name in the message is
  // schema reconnaissance, so the body stays generic. PostgREST surfaces the
  // code as e.code; a route wanting a specific message still owns its own
  // explicit 409.
  if (e?.code === "23505") {
    return res.status(409).json({
      success: false,
      error:   "That record already exists",
      message: "That record already exists",
      code:    "conflict",
    });
  }
  console.error(
    `[api] 500 ${req?.method || "?"} ${req?.originalUrl || req?.path || "?"} —`,
    e?.stack || e?.message || e
  );
  // `message` + `code` join the long-standing `error` key so every failure
  // answers with one envelope: { success:false, message, code? }. The old key
  // stays so existing clients keep parsing.
  return res.status(500).json({
    success: false,
    error:   "Something went wrong. Please try again.",
    message: "Something went wrong. Please try again.",
    code:    "internal_error",
  });
}
