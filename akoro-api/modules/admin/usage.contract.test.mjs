import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runWithRouteUsage, countQuery, currentRouteKey, usageSnapshot } from "../../lib/usageMeter.js";

const dbSource = await readFile(new URL("../../db.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../../app.js", import.meta.url), "utf8");
const adminSource = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const workerJs = await readFile(new URL("../../worker.js", import.meta.url), "utf8");
const followUpsJs = await readFile(new URL("../adaptive-learning/chat-follow-ups.js", import.meta.url), "utf8");
const autonomyJs = await readFile(new URL("../adaptive-learning/learner-autonomy.js", import.meta.url), "utf8");
const evalJs = await readFile(new URL("../../lib/evalWorker.js", import.meta.url), "utf8");
const backgroundJs = await readFile(new URL("../../lib/backgroundQueue.js", import.meta.url), "utf8");

test("usage meter attributes commands to the route in context", () => {
  assert.equal(currentRouteKey(), "(background)");
  const before = usageSnapshot({}).lifetimeTotal;
  runWithRouteUsage("GET /health", () => {
    countQuery();
    countQuery(3);
    assert.equal(currentRouteKey(), "GET /health");
  });
  assert.equal(currentRouteKey(), "(background)");
  const snap = usageSnapshot({ topN: 5 });
  assert.equal(snap.lifetimeTotal, before + 4);
  const health = snap.topRoutes.find((r) => r.route === "GET /health");
  assert.ok(health && health.commands >= 4);
  assert.equal(typeof snap.burnPerHour, "number");
  assert.match(snap.note, /auth and other platform services are NOT included/);
});

test("every PostgREST entry point on the db client is metered", () => {
  for (const m of ["metered(createClient(config.supabase.url", "client.from", "client.rpc", "client.schema"]) {
    assert.ok(dbSource.includes(m), `db.js wraps: ${m}`);
  }
  assert.match(dbSource, /readDb = config\.db\.readUrl && config\.db\.readUrl !== config\.supabase\.url\n  \? metered\(/);
});

test("the /api middleware attributes requests, and admins can read the burn", () => {
  assert.match(appSource, /app\.use\("\/api", \(req, res, next\) => \{\s*\n  const norm = req\.path/);
  assert.match(appSource, /runWithRouteUsage\(`\$\{req\.method\} \$\{norm\}`, next\)/);
  assert.match(adminSource, /router\.get\("\/usage", adminOnly, asyncHandler\(async \(req, res\) => \{\s*\n  ok\(res, usageSnapshot/);
});

test("health checks and the encoding worker no longer bill per-command Redis/DB", () => {
  // /health caches the deep verdict — Render pings it around the clock.
  assert.match(appSource, /let healthCache = \{ at: 0, dbOk: false, redisOk: false \};/);
  assert.match(appSource, /AKORO_HEALTH_PROBE_SECONDS/);
  assert.match(appSource, /Date\.now\(\) - healthCache\.at < HEALTH_PROBE_MS/);
  assert.match(appSource, /req\.query\.deep === "1"/);
  // The video-encoding worker got the battle worker's Upstash treatment.
  const workerSource = workerJs;
  assert.match(workerSource, /drainDelay:\s+300/);
  assert.match(workerSource, /stalledInterval: 300_000/);
  // ...and the quiet kinds share one worker with the house tuning (lib/backgroundQueue.js).
  for (const src of [followUpsJs, autonomyJs, evalJs]) assert.match(src, /handleBackground\(/);
  assert.match(backgroundJs, /drainDelay: 300/);
  assert.match(backgroundJs, /stalledInterval: 300_000/);
  // A stand-down switch exits before any Redis connection is made.
  assert.match(workerSource, /VIDEO_WORKER_ENABLED/);
});
