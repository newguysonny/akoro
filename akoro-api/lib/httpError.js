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
  console.error(
    `[api] 500 ${req?.method || "?"} ${req?.originalUrl || req?.path || "?"} —`,
    e?.stack || e?.message || e
  );
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}
