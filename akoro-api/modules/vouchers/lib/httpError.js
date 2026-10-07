/**
 * lib/httpError.js — one place to turn an unexpected exception into a response.
 *
 * Postgres/PostgREST error messages name tables, columns and constraints
 * ("duplicate key value violates unique constraint uq_vouchers_..."). Handing
 * those to an API client is free schema reconnaissance, so the real error is
 * logged server-side and the caller gets a generic message.
 *
 * Deliberate errors meant FOR the caller (validation, insufficient funds,
 * not-found) should keep using explicit res.status(4xx).json({ error: "..." })
 * — this is only for the catch-all 500 path.
 */
export function serverError(res, e, req) {
  console.error(
    `[vouchers] 500 ${req?.method || "?"} ${req?.originalUrl || req?.path || "?"} —`,
    e?.stack || e?.message || e
  );
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}
