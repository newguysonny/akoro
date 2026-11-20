/**
 * queryDeadline.test.mjs — the deadline must never die with the query it
 * was guarding.
 *
 * Regression: step()'s timeout callback used to call `promise.catch(...)`
 * unconditionally. Supabase's PostgrestBuilder implements `then` only —
 * a bare thenable — so `.catch` was undefined and the call threw a
 * TypeError INSIDE the setTimeout callback, before the reject() and before
 * the timeout log line. Result: the deadline meant to cap a slow query
 * instead wedged the request forever with no log (only a swallowed
 * [uncaughtException]), which is exactly the communities-details hang
 * that survived two services and four rounds of hardening. These tests
 * run the real step() against bare thenables with a 25ms deadline —
 * the old code fails the first one outright.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { step, DEFAULT_QUERY_TIMEOUT_MS } from "../../lib/queryDeadline.js";

// The exact shape of a supabase PostgrestBuilder as seen by Promise.race:
// an object whose then() returns a promise and never calls either callback.
const bareThenableThatNeverSettles = {
  then(onFulfilled, _onRejected) {
    // Real builders start a fetch here; this one just never answers.
    return new Promise(() => {});
  },
};

test("a bare thenable that never settles still rejects at the deadline", async () => {
  let err;
  await assert.rejects(
    step("findCommunity", bareThenableThatNeverSettles, 25),
    (e) => { err = e; return true; },
  );
  assert.equal(err.deadlineExceeded, true);
  assert.equal(err.step, "findCommunity");
  assert.match(err.message, /Timed out after 25ms: findCommunity/);
});

test("a real promise that never settles also rejects at the deadline", async () => {
  let err;
  await assert.rejects(
    step("myMembership", new Promise(() => {}), 25),
    (e) => { err = e; return true; },
  );
  assert.equal(err.deadlineExceeded, true);
});

test("a fast thenable resolves with its value and the timer is cleared", async () => {
  const value = await step("memberCounts", Promise.resolve({ data: [1, 2], error: null }), 25);
  assert.deepEqual(value, { data: [1, 2], error: null });
  // Past the deadline now: a cleared timer means no late rejection, no
  // unhandled anything. Give the loop a chance to prove it.
  await new Promise((r) => setTimeout(r, 60));
});

test("a fast-rejecting thenable propagates its rejection", async () => {
  await assert.rejects(
    step("userNames", Promise.reject(new Error("db down")), 25),
    /db down/,
  );
});

test("a late-settling loser after a timeout leaves no unhandled rejection", async () => {
  // The timeout fires first; the loser rejects AFTER we've already moved
  // on. Real promises get a swallowed .catch attached by the guard; bare
  // thenables are absorbed by the settled race wrapper. Either way, the
  // process must not see an unhandledRejection — node --test fails the
  // suite on one, so merely surviving this test is the assertion.
  let lateReject;
  const loser = new Promise((_, rej) => { lateReject = rej; });
  await assert.rejects(step("activities", loser, 25));
  setTimeout(() => lateReject(new Error("late failure is not news")), 10);
  await new Promise((r) => setTimeout(r, 60));
});

test("default deadline is the documented 20s and stays exported for /health", async () => {
  assert.equal(DEFAULT_QUERY_TIMEOUT_MS, 20_000);
  const { readFile } = await import("node:fs/promises");
  const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");
  const store = await readFile(new URL("./store.js", import.meta.url), "utf8");
  assert.match(routes, /COMMUNITIES_QUERY_TIMEOUT_MS = DEFAULT_QUERY_TIMEOUT_MS/);
  assert.match(routes, /import \{ DEFAULT_QUERY_TIMEOUT_MS \}\s+from "\.\.\/\.\.\/lib\/queryDeadline\.js";/);
  // Phase 19 step 4: the queries (and therefore step()) live in store.js.
  assert.match(store, /import \{ step \}\s+from "\.\.\/\.\.\/lib\/queryDeadline\.js";/);
  // The poisoned pattern must never come back: an UNGUARDED .catch on the
  // raced promise inside the module family.
  assert.doesNotMatch([routes, store].join("\n"), /promise\.catch\(/);
});
