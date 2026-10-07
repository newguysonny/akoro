import { test } from "node:test";
import assert from "node:assert/strict";

test("redis guard · unset REDIS_URL gives up quietly; real URL retries forever", async () => {
  const { redisConnectionOptions, bullRedisOptions } = await import("./lib/redisOptions.js");
  delete process.env.REDIS_URL;
  const guarded = redisConnectionOptions({ label: "test-a" });
  assert.equal(guarded.maxRetriesPerRequest, null);           // BullMQ requirement kept
  assert.equal(guarded.retryStrategy(1), 2000);               // still backs off at first
  assert.equal(guarded.retryStrategy(6), null);               // …then gives up (one warn printed)
  assert.equal(guarded.retryStrategy(9), null);
  const guarded2 = redisConnectionOptions({ label: "test-a" }); // same label → no second warn
  assert.equal(guarded2.retryStrategy(6), null);
  process.env.REDIS_URL = "rediss://example.upstash.io:6379";
  const real = redisConnectionOptions({ label: "test-b" });
  assert.equal(real.retryStrategy(99), 10_000);               // configured → never gives up
  assert.equal(real.retryStrategy(1), 2000);
  assert.deepEqual(Object.keys(bullRedisOptions).length > 0, true);
  delete process.env.REDIS_URL;
});
