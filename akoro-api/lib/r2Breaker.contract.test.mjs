import assert from "node:assert/strict";
import test from "node:test";

/**
 * 2026-10-19: r2Send(client, command) reached R2 never — the breaker's action
 * destructured its arguments as one array, so every call threw before the
 * network and the "r2" breaker opened. Called here exactly as the app calls it.
 */
import { r2Send, r2Breaker } from "./r2Breaker.js";

test("r2Send hands the command to the client and returns its answer", async () => {
  const seen = [];
  const client = { send: async (command) => { seen.push(command); return { ok: true, command: command.name }; } };
  const out = await r2Send(client, { name: "PutObject" });
  assert.deepEqual(out, { ok: true, command: "PutObject" });
  assert.equal(seen.length, 1);
  assert.equal(r2Breaker.opened, false, "a working call never opens the breaker");
});
