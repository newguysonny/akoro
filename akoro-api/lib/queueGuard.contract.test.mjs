// lib/queueGuard.contract.test.mjs
//
// Backpressure contract (hardening plan §3.3): when a queue is at capacity,
// the enqueue is REJECTED with a typed 503 (queue_full, retryAfterSec) — an
// honest failure now instead of a job that runs an hour late. When the depth
// read fails, the guard must stand aside: a guard that blocks all work
// because it cannot look is worse than no guard.
import test from "node:test";
import assert from "node:assert/strict";
import { assertQueueCapacity, QueueFullError } from "./queueGuard.js";

const fakeQueue = (counts, fail = false) => ({
  getJobCounts: async () => {
    if (fail) throw new Error("redis hiccup");
    return counts;
  },
});

test("a queue at capacity rejects the enqueue with a typed 503", async () => {
  await assert.rejects(
    () => assertQueueCapacity(fakeQueue({ waiting: 480, delayed: 20 }), { name: "tasks", max: 500 }),
    (e) => {
      assert.ok(e instanceof QueueFullError);
      assert.equal(e.statusCode, 503);
      assert.equal(e.code, "queue_full");
      assert.equal(e.expose, true);
      assert.ok(e.retryAfterSec > 0);
      assert.ok(e.message.includes("tasks"));
      return true;
    },
  );
});

test("a queue under capacity lets the enqueue through", async () => {
  await assert.doesNotReject(() =>
    assertQueueCapacity(fakeQueue({ waiting: 10, delayed: 5 }), { name: "tasks", max: 500 }));
});

test("a failed depth read must NOT block the enqueue", async () => {
  await assert.doesNotReject(() =>
    assertQueueCapacity(fakeQueue(null, true), { name: "tasks", max: 500 }));
});

test("a queue object without getJobCounts is left alone", async () => {
  await assert.doesNotReject(() => assertQueueCapacity({}, { name: "tasks" }));
});

test("default cap comes from the env knob", async () => {
  process.env.QUEUE_MAX_WIDGETS = "3";
  try {
    await assert.rejects(() =>
      assertQueueCapacity(fakeQueue({ waiting: 3, delayed: 0 }), { name: "widgets" }));
    await assert.doesNotReject(() =>
      assertQueueCapacity(fakeQueue({ waiting: 2, delayed: 0 }), { name: "widgets" }));
  } finally {
    delete process.env.QUEUE_MAX_WIDGETS;
  }
});
