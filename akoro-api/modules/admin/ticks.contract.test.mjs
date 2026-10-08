/**
 * modules/admin/ticks.contract.test.mjs
 *
 * Guards the scheduled-job clock seam:
 *   • the registry (lib/cronTicks.js) behaves — unknown name, overlap
 *     skip, error envelope;
 *   • the tick route is internal-secret-guarded and runs registered
 *     ticks over real HTTP;
 *   • every scheduled job registers THE SAME function its local
 *     node-cron schedule calls, and CRON_SOURCE=cloudflare disarms the
 *     local clocks (no double-runs);
 *   • the edge ticker maps the same crons to the same tick names.
 *
 * Offline: registry + route run live; the scheduled modules are pinned
 * by source (their imports are far too heavy to pull into a test).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";
import http from "node:http";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

const [registrySrc, routeSrc, appSrc, pilotSrc, ladderSrc, adaptiveIdxSrc,
  tickerSrc, wranglerSrc, envExample] = await Promise.all([
  read("../../lib/cronTicks.js"),
  read("ticks.js"),
  read("../../app.js"),
  read("pilotSchools.js"),
  read("../adaptive-learning/ladderPrewarm.js"),
  read("../adaptive-learning/index.js"),
  read("../../../cf/cron-ticker/src/worker.js"),
  read("../../../cf/cron-ticker/wrangler.toml"),
  read("../../.env.example"),
]);

const { registerTick, runTick, listTicks, cloudflareCronEnabled } = await import("../../lib/cronTicks.js");

test("the registry: unknown names 404, overlap skips, errors come back as envelopes", async () => {
  const outcome = await runTick("nope");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 404);
  assert.match(outcome.error, /no such tick "nope"/);

  let runs = 0;
  registerTick("test-slow", () => new Promise((resolve) => setTimeout(() => { runs += 1; resolve({ ran: true }); }, 120)));
  const first = runTick("test-slow");          // starts, holds the slot
  const second = await runTick("test-slow");   // arrives mid-run → skipped, NOT queued
  assert.equal(second.ok, true);
  assert.equal(second.data.skipped, true);
  assert.match(second.data.reason, /previous run still in progress/);
  const done = await first;
  assert.equal(done.data.result.ran, true);
  assert.equal(runs, 1, "exactly one execution for two pokes");

  registerTick("test-boom", async () => { throw new Error("kaboom"); });
  const boom = await runTick("test-boom");
  assert.equal(boom.ok, false);
  assert.equal(boom.status, 500);
  assert.match(boom.error, /kaboom/);
  // and the slot is released after the failure
  const again = await runTick("test-boom");
  assert.equal(again.status, 500, "the tick can be re-run after a failure");
  assert.ok(listTicks().includes("test-slow"));
});

test("the route is internal-secret-guarded and runs ticks over real HTTP", async () => {
  process.env.INTERNAL_SECRET = "tick-secret";
  registerTick("test-http", async () => ({ hello: "world" }));
  const { default: router } = await import("./ticks.js");
  const express = (await import("express")).default;
  const app = express();
  app.use(router);   // the exact mounting app.js uses

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const noAuth = await fetch(`${base}/test-http`, { method: "POST" });
    assert.equal(noAuth.status, 403);
    const badAuth = await fetch(`${base}/test-http`, { method: "POST", headers: { "x-internal-secret": "wrong" } });
    assert.equal(badAuth.status, 403);

    const hit = await fetch(`${base}/test-http`, { method: "POST", headers: { "x-internal-secret": "tick-secret" } });
    assert.equal(hit.status, 200);
    assert.deepEqual((await hit.json()).data.result, { hello: "world" });

    const listing = await fetch(`${base}/`, { headers: { "x-internal-secret": "tick-secret" } });
    assert.ok(((await listing.json()).data.ticks).includes("test-http"));

    const unknown = await fetch(`${base}/ghost`, { method: "POST", headers: { "x-internal-secret": "tick-secret" } });
    assert.equal(unknown.status, 404);
  } finally {
    server.close();
  }
});

test("every scheduled job registers its real callback and the local clock is gated", () => {
  // decay — registered inside setupAdaptiveWebSocket (it needs io)
  assert.match(adaptiveIdxSrc, /registerTick\("decay-scheduler", runDecayTick\)/);
  assert.match(adaptiveIdxSrc, /cronSource\(\) !== "cloudflare"/);
  assert.match(adaptiveIdxSrc, /await decayEngine\.runDecayScheduler\(io\)/, "the tick IS the nightly pass, not a stub");
  // ladder prewarm
  assert.match(ladderSrc, /registerTick\("ladder-prewarm", runLadderPrewarm\)/);
  assert.match(ladderSrc, /cronSource\(\) !== "cloudflare"/);
  // pilot expiry — the extracted function is exported and registered
  assert.match(pilotSrc, /export async function runPilotExpiryCheck\(\)/);
  assert.match(pilotSrc, /registerTick\("pilot-expiry-check", runPilotExpiryCheck\)/);
  assert.match(pilotSrc, /cronSource\(\) !== "cloudflare"/);
  // registry imports present in all three
  for (const s of [adaptiveIdxSrc, ladderSrc, pilotSrc]) {
    assert.match(s, /import \{ registerTick, cronSource \} from "\.\.\/\.\.\/lib\/cronTicks\.js";/);
  }
});

test("the app mounts the tick route, and the edge ticker aims at the same names", () => {
  assert.match(appSrc, /import ticksRouter\s+from "\.\/modules\/admin\/ticks\.js";/);
  assert.match(appSrc, /app\.use\("\/api\/internal\/ticks", ticksRouter\);/);

  assert.match(tickerSrc, /"20 2 \* \* \*":\s+"ladder-prewarm"/);
  assert.match(tickerSrc, /"0 3 \* \* \*":\s+"decay-scheduler"/);
  assert.match(tickerSrc, /"30 3 \* \* \*":\s+"pilot-expiry-check"/);
  assert.match(tickerSrc, /x-internal-secret/, "the poke is authenticated");
  assert.match(tickerSrc, /\/api\/internal\/ticks\/\$\{name\}/, "the poke hits the tick route");
  assert.doesNotMatch(tickerSrc, /supabase|openai|bcrypt/, "the ticker carries NO business logic");

  for (const cron of ["20 2 * * *", "0 3 * * *", "30 3 * * *"]) {
    assert.ok(wranglerSrc.includes(`"${cron}"`), `wrangler crons missing ${cron}`);
  }
  assert.match(envExample, /CRON_SOURCE=cloudflare/, "the flip is documented");
  assert.match(envExample, /or nothing fires the nightly jobs/, "…with the honest warning");
});

test("the clock switch: default is local, cloudflare mode is opt-in", () => {
  delete process.env.CRON_SOURCE;
  assert.equal(cloudflareCronEnabled(), false, "unset → node-cron owns the clock");
  process.env.CRON_SOURCE = "cloudflare";
  assert.equal(cloudflareCronEnabled(), true);
  delete process.env.CRON_SOURCE;
});
