/**
 * lib/queryDeadline.js — race any query against a deadline, safely.
 *
 * Extracted from modules/communities/routes.js after the timer callback
 * there was caught crashing: it called `promise.catch(...)` on a supabase
 * PostgrestBuilder, which implements `then` only — a BARE thenable, not a
 * real Promise, so `.catch` is undefined and the call threw a TypeError
 * *inside the setTimeout callback*. The throw ran BEFORE the reject() and
 * before the timeout log line, so:
 *
 *   - the timeout promise never settled,
 *   - Promise.race never settled,
 *   - the route handler stayed pending forever,
 *   - the learner's request hung past every deadline with NO log line,
 *   - process.on("uncaughtException") swallowed the crash, so the only
 *     trace was one easy-to-miss [uncaughtException] line ~6s before the
 *     watchdog's REQUEST_STALLED.
 *
 * That single line was the communities-details hang that survived two
 * services and four rounds of hardening: the 20s deadline meant to CAP a
 * slow query became the thing that WEDGED it. The lesson baked in here:
 * a deadline's timer callback must be exception-proof — losing the race
 * is routine, and a routine event must never take the rescue path down
 * with it. The timeout is injectable so tests can prove that in
 * milliseconds instead of 20 seconds.
 */

export const DEFAULT_QUERY_TIMEOUT_MS = 20_000;

/**
 * step(label, promise, ms?) — resolve with `promise`'s value, or reject
 * with a deadline error after `ms` (default 20s), whichever comes first.
 *
 * Works with real Promises AND bare thenables (supabase builders are
 * thenables: calling .then on them executes the query). Every path in the
 * timer callback is defensive: the losing promise's late failure is
 * swallowed where possible (real promises) and simply left to the race's
 * internal absorption where not (bare thenables) — either way it must
 * never prevent the deadline from firing.
 */
export function step(label, promise, ms = DEFAULT_QUERY_TIMEOUT_MS) {
  const t0 = Date.now();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      // It lost the race — a late failure is not news. But `promise` may be
      // a bare thenable without .catch (supabase builders): attaching a
      // handler must never be able to throw inside this callback, or the
      // deadline silently dies with it (the bug this module exists for).
      try {
        promise?.catch?.(() => {});
      } catch {
        // Bare thenable: the Promise.race wrapper already owns its fate —
        // a late rejection there is absorbed by the settled race.
      }
      console.error("[communities] query timed out", { step: label, ms });
      const err = new Error(`Timed out after ${ms}ms: ${label}`);
      err.deadlineExceeded = true;
      err.step = label;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout])
    .finally(() => clearTimeout(timer))
    .finally(() => {
      // Narration: one line per settled step, with its duration. The
      // communities hunt took days because a wedged query left NO trace —
      // now a slow or missing line names itself.
      console.log(`[communities] step ${label} settled in ${Date.now() - t0}ms`);
    });
}
