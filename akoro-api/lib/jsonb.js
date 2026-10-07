// lib/jsonb.js
//
// Reading a JSONB column without destroying the request.
//
// PostgREST returns JSONB as a real array or object — already parsed. Calling
// JSON.parse on it is not a harmless no-op: JSON.parse coerces its argument to
// a string first, so
//
//     JSON.parse(["Evaporation","Condensation"])   → JSON.parse("Evaporation,Condensation")
//     JSON.parse([])                               → JSON.parse("")
//     JSON.parse({ a: 1 })                         → JSON.parse("[object Object]")
//
// all throw SyntaxError. The `|| "[]"` fallback everyone writes never fires,
// because an empty array is truthy.
//
// This shipped in the endpoint behind "Continue Teaching", which meant it threw
// on every call and continuation could never load a previous session. One
// caller in student-feed.js had already been patched with an inline
// Array.isArray guard — the bug was known, fixed in one place, and left
// everywhere else. Hence a shared helper rather than a fourth inline guard.

/** A JSONB array column, however the driver hands it over. */
export function jsonbArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return fallback;
  if (typeof value === "string") {
    // A genuine JSON string — some rows were written with JSON.stringify before
    // the write side was corrected, so both shapes exist in the same column.
    try { const p = JSON.parse(value); return Array.isArray(p) ? p : fallback; }
    catch { return fallback; }
  }
  return fallback;
}

/** A JSONB object column. */
export function jsonbObject(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (value == null || value === "") return fallback;
  if (typeof value === "string") {
    try {
      const p = JSON.parse(value);
      return p && typeof p === "object" && !Array.isArray(p) ? p : fallback;
    } catch { return fallback; }
  }
  return fallback;
}
