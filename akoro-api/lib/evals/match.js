// lib/evals/match.js
//
// One argument matcher, shared by every suite.
//
// Goldens live in JSON now, which cannot hold a RegExp — so the matchers are
// encoded as data and parsed here. Two suites with two slightly different ideas
// of what "matches" means would make their results incomparable, which is the
// whole thing a suite is supposed to prevent.

/** '/pattern/flags' → RegExp. Anything else comes back untouched. */
export function parseMatcher(spec) {
  if (typeof spec === "string") {
    const m = /^\/(.*)\/([gimsuy]*)$/.exec(spec);
    if (m) return new RegExp(m[1], m[2]);
  }
  return spec;
}

/**
 * Does the model's chosen argument match what the request plainly said?
 *
 *   '/math/i'          regex over the value
 *   ['class','learners'] membership — more than one answer is defensible
 *   2                  "this many entries", for lists like usernames
 *   'podcast'          case-insensitive equality
 */
export function argMatches(expectedSpec, actual) {
  const expected = parseMatcher(expectedSpec);
  if (expected instanceof RegExp)  return typeof actual === "string" && expected.test(actual);
  if (Array.isArray(expected))     return expected.includes(actual);
  if (typeof expected === "number") return Array.isArray(actual) && actual.length === expected;
  if (typeof expected === "string") return String(actual ?? "").toLowerCase() === expected.toLowerCase();
  return true;
}
