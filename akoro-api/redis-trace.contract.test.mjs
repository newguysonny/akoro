import { test } from "node:test";
import assert from "node:assert/strict";

test("redis trace · per-label attribution names the consumer", async () => {
  process.env.AKORO_REDIS_TRACE = "true";
  const { traceRedis, redisTraceSnapshot } = await import("./lib/redisTrace.js");
  const calls = [];
  const fake = { sendCommand: (cmd, ...rest) => { calls.push(cmd?.name); return Promise.resolve("OK"); } };
  traceRedis(fake, "label-test");
  await fake.sendCommand({ name: "evalsha" });
  await fake.sendCommand({ name: "evalsha" });
  await fake.sendCommand({ name: "hset" });
  const snap = redisTraceSnapshot();
  const entry = snap.byLabel.find(([l]) => l === "label-test");
  assert.ok(entry, "label missing from byLabel");
  assert.equal(entry[1], 3);                                   // total for this label
  assert.deepEqual(entry[2].map(([c]) => c), ["evalsha", "hset"]);
  assert.equal(calls.length, 3);                               // commands still pass through
  delete process.env.AKORO_REDIS_TRACE;
});
