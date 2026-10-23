import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { EventEmitter } from "node:events";
import { isQuotaError, guardWorker, redisQuotaTripped, redisQuotaStatus } from "./redisQuotaGuard.js";

test("Upstash quota replies are recognised; ordinary errors are not", () => {
  assert.ok(isQuotaError(new Error("ERR max requests limit exceeded. Limit: 500000, Usage: 500000")));
  assert.ok(isQuotaError(new Error("ERR max daily request limit exceeded")));
  assert.ok(!isQuotaError(new Error("Connection is closed.")));
  assert.ok(!isQuotaError(new Error("WRONGTYPE Operation against a key")));
});

test("a quota error pauses every registered worker instead of a retry storm", async () => {
  const mk = () => Object.assign(new EventEmitter(), { paused: 0, resumed: 0, async pause() { this.paused++; }, resume() { this.resumed++; } });
  const a = mk(), b = mk();
  guardWorker(a, "a"); guardWorker(b, "b");
  a.emit("error", new Error("Connection is closed."));
  assert.equal(redisQuotaTripped(), false);
  a.emit("error", new Error("ERR max requests limit exceeded"));
  await new Promise((r) => setImmediate(r));
  assert.equal(redisQuotaTripped(), true);
  assert.equal(a.paused, 1); assert.equal(b.paused, 1);
  b.emit("error", new Error("ERR max requests limit exceeded"));   // already tripped: once only
  assert.equal(a.paused, 1);
  assert.equal(redisQuotaStatus().strikes, 1);
});

test("every in-app BullMQ worker is guarded and scans for stalled jobs every 5 min (top-level option)", async () => {
  // The quiet kinds (follow-ups, check-ins, quiet learning, resumes, evals, the
  // autonomy cycle) share one worker in lib/backgroundQueue.js.
  const files = ["../modules/battle/worker.js", "./backgroundQueue.js", "../modules/tasks/worker.js"];
  for (const f of files) {
    const src = await readFile(new URL(f, import.meta.url), "utf8");
    assert.match(src, /guardWorker\(/, f);
    assert.doesNotMatch(src, /settings:\s*\{\s*stalledInterval/, f);   // BullMQ ignores it there
    assert.match(src, /^\s*stalledInterval: 300_000,/m, f);
  }
});
