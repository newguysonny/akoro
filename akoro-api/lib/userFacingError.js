/**
 * lib/userFacingError.js — turn backend/database text into a sentence a learner
 * can act on. Postgres/PostgREST messages name tables, columns, constraints and
 * SQL keywords; those never belong in a response body.
 *
 * Deliberate, human-written validation messages pass through unchanged.
 */
const BACKENDISH = /(schema|relation|column|constraint|violat|duplicate key|null value|invalid input syntax|postgrest|supabase|pgrst|row-level security|permission denied|econn|sqlstate|stack trace|is not defined|undefined is not)/i;

const GENERIC = "We couldn't complete that request. Please check the details and try again.";

export function userFacingMessage(message, fallback = GENERIC) {
  const text = String(message ?? "").replace(/^error:\s*/i, "").trim();
  if (!text || text.length > 180) return fallback;
  if (/duplicate key|already exists/i.test(text)) return "That record already exists.";
  if (/foreign key|still referenced|violates foreign/i.test(text)) return "That item is still in use, so it can't be removed yet.";
  if (/invalid input syntax|could not parse|invalid uuid/i.test(text)) return "One of those details isn't valid. Please check and try again.";
  if (/row-level security|permission denied/i.test(text)) return "You don't have access to that.";
  if (BACKENDISH.test(text)) return fallback;
  return text;
}

export function userFacingError(error, fallback = GENERIC) {
  return userFacingMessage(error?.message, fallback);
}
