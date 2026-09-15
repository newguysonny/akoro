import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { traceRedis, redisTraceSnapshot } from "../../lib/redisTrace.js";

const appSource = await readFile(new URL("../../app.js", import.meta.url), "utf8");
const battleWorker = await readFile(new URL("../battle/worker.js", import.meta.url), "utf8");

test("redis tracer attributes every command to its call-site and stays a pass-through", async () => {
  process.env.AKORO_REDIS_TRACE = "true";
  const served = [];
  const fake = { sendCommand: (cmd) => { served.push(cmd.name); return Promise.resolve("PONG"); } };
  traceRedis(fake, "test");
  traceRedis(fake, "test"); // idempotent — never double-wrap

  const issue = () => fake.sendCommand({ name: "ping" });
  const before = redisTraceSnapshot().total;
  const result = await issue();
  assert.equal(result, "PONG");           // pass-through: the real client still answers
  assert.deepEqual(served, ["ping"]);     // exactly one underlying command

  const snap = redisTraceSnapshot();
  assert.equal(snap.total, before + 1);
  assert.ok(snap.byCommand.some(([name]) => name === "ping"));
  assert.ok(snap.bySite.some(([site]) => site.includes("redis-trace.contract.test.mjs")), `call-site attributed: ${JSON.stringify(snap.bySite)}`);

  delete process.env.AKORO_REDIS_TRACE;
  await issue();                          // flag off → inert, nothing counted
  assert.equal(redisTraceSnapshot().total, before + 1);
});

test("the tracer is wired on the API pub/sub clients and the battle worker — flag-gated", () => {
  assert.match(appSource, /traceRedis\(redisPub, "api\/pub"\)/);
  assert.match(appSource, /traceRedis\(redisSub, "api\/sub"\)/);
  assert.match(appSource, /startRedisTraceReporting\(\)/);
  assert.match(battleWorker, /traceRedis\(redis, "battle-worker"\)/);
  // Docs: defaults off, local-only diagnostics.
  const env = readFile(new URL("../../.env.example", import.meta.url), "utf8");
  return env.then((src) => assert.match(src, /AKORO_REDIS_TRACE=false/));
});
