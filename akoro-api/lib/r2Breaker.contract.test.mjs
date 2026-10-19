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

test("R2 takes a browser upload only from a site its CORS rule allows; asked once per origin", async () => {
  const { makeOriginCheck } = await import("./r2Cors.js");
  let asked = 0;
  const answer = (allow, status = 200) => async () => { asked += 1; return { ok: status < 300, headers: { get: (h) => (h === "access-control-allow-origin" ? allow : null) } }; };
  const accepts = makeOriginCheck({ enabled: () => true, url: () => "https://b.example/probe", log: {} });
  assert.equal(await accepts(null), true, "no origin: a server calling");
  assert.equal(await accepts("https://a.example", { fetch: answer("https://a.example") }), true);
  assert.equal(await accepts("https://b.example", { fetch: answer(null, 403) }), false, "no CORS rule: the fallback takes it");
  assert.equal(await accepts("https://b.example", { fetch: answer("https://b.example") }), false, "cached for a while");
  assert.equal(asked, 2);
  assert.equal(await makeOriginCheck({ enabled: () => false, url: () => "" })("https://c.example"), true, "no R2: nothing to ask");
});
