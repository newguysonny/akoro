/**
 * app.js  —  Akoro API — Unified Entry Point (Modular Monolith)
 *
 * Modules:
 *   /api/auth/*          auth        — register, login, JWT
 *   /api/*               courses     — courses, cart, payments, live sessions
 *   /api/ranking/*       ranking     — XP leaderboards
 *   /api/profiles/*      profiles    — teachers, classrooms, schools
 *   /api/adaptive/*      adaptive    — AI teaching agents, marketplace
 *   /api/*               battle      — 1v1/open/classroom battles, leaderboard
 *   /api/tasks/*         tasks       — teacher AI task agent (Anthropic loop)
 */

// Outbound meter FIRST: it patches global fetch, and every client library
// (supabase-js, the OpenAI SDK) captures fetch when it is constructed —
// importing this after them would measure nothing.
import "./lib/logTap.js";          // keeps the last server log lines for the agent console
import "./lib/outboundMeter.js";
import { loadRuntimeSettings } from "./lib/modelRuntime.js";
import { userFacingMessage } from "./lib/userFacingError.js";
import "dotenv/config";
import express                    from "express";
import { createServer }           from "http";
import { Server as SocketServer } from "socket.io";
import { createAdapter }          from "@socket.io/redis-adapter";
import Redis                      from "ioredis";
import { skipJob as sharedSkipJob } from "./lib/jobsGate.js";
import { redisQuotaStatus }       from "./lib/redisQuotaGuard.js";
import { outboundSummary }        from "./lib/outboundMeter.js";
import {
  standardLimit, teachingLimit, aiLimit,
  internalLimit, attachRateLimitIdentity, requestLogger,
} from "./middleware/security.js";
import { createCorsPolicy, applyHttpHardening, applyRequestGuards } from "./lib/httpHardening.js";
import { applyProxyTrust }           from "./lib/proxyTrust.js";
import { startWorkers, startRoutineSchedulerJob, startTaskWorker } from "./lib/startWorkers.js";
import { printStartBanner, logLastMigration } from "./lib/bootLog.js";
import { installErrorHandlers }      from "./lib/errorHandler.js";
import { installProcessSafety, installShutdown } from "./lib/lifecycle.js";
import { installSocketHandlers }     from "./lib/socketHandlers.js";

import config                     from "./config/index.js"; import "./lib/bootChecks.js";
import { requireSharedSecret }    from "./lib/safeCompare.js";
import { runConfigChecks }         from "./lib/preflightChecks.js";
import { runWithRouteUsage } from "./lib/usageMeter.js";
import { breakerStats } from "./lib/circuitBreaker.js";
import { refreshTenantHosts } from "./modules/school/tenant.js";
import db, { checkDb }           from "./db.js";
import { applyMigrations, migrationsAlreadyApplied, migrationUrl, currentGitSha } from "./lib/migrations.js";
import { traceRedis, startRedisTraceReporting } from "./lib/redisTrace.js";

// ─── Module imports ───────────────────────────────────────────────────────────
import { authModule } from "./modules/auth/index.js";
import walletModule from "./modules/wallet/routes.js";
import vouchersModule from "./modules/vouchers/index.js";
import coursesModule              from "./modules/courses/index.js";
import rankingModule              from "./modules/ranking/routes.js";
import agentNetworkModule         from "./modules/agent-network/routes.js";
import profilesModule             from "./modules/profiles/routes.js";
import adaptiveModule from "./modules/adaptive-learning/index.js";
import battleModule               from "./modules/battle/routes.js";
import tasksModule                from "./modules/tasks/routes.js";
import selfStudyModule            from "./modules/self-study/routes.js";
import pharmdModule              from "./modules/pharmd/routes.js";
import programmesModule          from "./modules/programmes/routes.js";
import courseBuilderModule       from "./modules/course-builder/routes.js";
import hfMirrorModule            from "./modules/hfmirror/routes.js";
import { parseConsoleModule }     from "./modules/records/index.js";
import agentConsoleModule        from "./modules/agentConsole/routes.js";
import verifyModule              from "./modules/verify/index.js";
import selfToolingModule         from "./modules/self-tooling/routes.js";
import { startViewRegistry }     from "./modules/self-tooling/index.js";
import communitiesModule, { COMMUNITIES_QUERY_TIMEOUT_MS } from "./modules/communities/routes.js";
import instructorModule           from "./modules/instructor/index.js";
import instructorToolsModule      from "./modules/instructor/tools.js";
import teachingToolsModule        from "./modules/teaching/index.js";
import { teachingWorkflowsModule } from "./modules/adaptive-learning/index.js";
import pastQuestionsModule        from "./modules/past-questions/routes.js";
import curriculumModule           from "./modules/curriculum/routes.js";
import schoolModule               from "./modules/school/index.js";
import { studentFeedRouter,
         battleFeedRouter }       from "./modules/courses/student-feed.js";
import voiceModule               from "./modules/voice/routes.js";
import contentModule             from "./modules/content/routes.js";
import paystackWebhookRouter     from "./modules/webhooks/paystack.js";
import adminModule              from "./modules/admin/index.js";
import contactModule            from "./modules/contact/routes.js";
import pilotApplicationsModule from "./modules/pilot-applications/routes.js";
import ticksRouter                     from "./modules/admin/ticks.js";
import billingGatewayModule    from "./modules/billing/index.js";
import "./modules/billing/jobs.js"; // billing cron jobs (trial-expiry / invoice-generation / payment-retry)
import learnerGoalsModule       from "./modules/learner-goals/index.js";
import agentProposalsModule      from "./modules/agent-proposals/index.js";
import agentLearnerModule      from "./modules/autonomy/learnerRoutes.js";
import { workflowsModule }        from "./modules/workflows/index.js";
import materialsModule           from "./modules/materials/index.js";
import blogsModule               from "./modules/blogs/routes.js";
import { recordsModule }          from "./modules/records/index.js";
import { recordsExtractionEnabled, runpodEndpointHealth } from "./modules/records/index.js";
import agentToolsModule from "./modules/agent-tools/routes.js";
import agentActionConfirmationsModule from "./modules/agent-tools/confirmation-routes.js";
import agentMemoryModule from "./modules/agent-tools/memory-routes.js";
const app        = express();
const httpServer = createServer(app);

// ─── Paystack webhook path ────────────────────────────────────────────────────
// The full webhook URL lives in PAYSTACK_WEBHOOK_URL (matching the Paystack
// dashboard). We mount on its path component so the route and the dashboard stay
// in sync from one env var. Defaults to /api/webhooks/paystack when unset.
const PAYSTACK_WEBHOOK_PATH = (() => {
  const raw = process.env.PAYSTACK_WEBHOOK_URL;
  if (!raw) return "/api/webhooks/paystack";
  try { return new URL(raw).pathname || "/api/webhooks/paystack"; }
  catch { return raw.startsWith("/") ? raw : "/api/webhooks/paystack"; }
})();

// ─── CORS origins ─────────────────────────────────────────────────────────────
// The policy (explicit list, wildcard base domains, tenant-host credentials)
// lives in lib/httpHardening.js. Sockets use the same isListedOrigin predicate:
// a tenant school site may call the API but is never credentialed.
const corsPolicy = createCorsPolicy();
const { allowedOrigins, isListedOrigin, corsDelegate } = corsPolicy;

// ─── Socket.io + Redis adapter ────────────────────────────────────────────────
const redisPub = new Redis(config.redis.url);
const redisSub = redisPub.duplicate();
// Local quota forensics (AKORO_REDIS_TRACE=true) — inert when the flag is off.
traceRedis(redisPub, "api/pub");
traceRedis(redisSub, "api/sub");
startRedisTraceReporting();
redisPub.on("error", (err) => console.error("[redis/pub]", err.message));
redisSub.on("error", (err) => console.error("[redis/sub]", err.message));

const io = new SocketServer(httpServer, {
  // Sockets authenticate from the handshake COOKIE, so the same rule as HTTP
  // credentials applies: portal origins only. A tenant school site must never
  // be able to open a socket as whoever is visiting it.
  cors: {
    origin: allowedOrigins === '*' ? '*' : ((origin, cb) => isListedOrigin(origin)
      ? cb(null, true)
      : cb(new Error(`CORS: socket origin ${origin} not allowed`))),
    credentials: true, methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});
io.adapter(createAdapter(redisPub, redisSub));
app.set("io", io);
global.io = io;   // battle worker uses global.io

// Socket auth, rooms and the adaptive/discussion/voice wiring run in their
// original order (lib/socketHandlers.js); io is still created and adapted here.
installSocketHandlers(io);

// ─── Core middleware ──────────────────────────────────────────────────────────
// Order: helmet → cors → cookies → egress/compression → body → security
// logging → auth → routes. The first half lives in lib/httpHardening.js; the
// body parsers stay here because the JSON redaction guard and the scoped
// 12mb parse-console parser are pinned to app.js by contract tests.
const { egress } = applyHttpHardening(app, corsPolicy);
// Paystack webhook signature validation needs the RAW request body. The raw
// parser must run BEFORE the global JSON parser (body-parser skips bodies
// already consumed by an earlier parser) — otherwise req.body arrives here as
// a parsed object, .toString() yields "[object Object]", and every webhook is
// rejected with "Invalid signature" (payments then never auto-grant agents).
app.use("/api/adaptive/marketplace/webhook", express.raw({ type: "application/json" }));
app.use(PAYSTACK_WEBHOOK_PATH,               express.raw({ type: "application/json" }));
// Submission file uploads are the one payload family that outgrows the 2mb
// global cap (a 5MB file arrives as ~6.8MB of base64). Parse them here, first
// — body-parser marks the body consumed so the global parser skips it.
app.use("/api/self-study/:id/files",          express.json({ limit: "9mb" }));
app.use("/api/records/extract",               express.json({ limit: "25mb" }));   // extraction: ≤16 rendered pages, base64'd
app.use("/api/parse/console",                 express.json({ limit: "12mb" }));   // parse console: ONE page, base64'd (worker cap ≈6 MB binary)
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
// Last line of defence: no 4xx/5xx JSON body may carry Postgres/PostgREST
// text (schema, constraint, table or SQL names), whatever a route returned.
// Deliberate human messages pass through unchanged.
app.use((req, res, next) => {
  const send = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 && body && typeof body === "object" && !Array.isArray(body)) {
      const fallback = res.statusCode >= 500
        ? "Something went wrong. Please try again."
        : "We couldn't complete that request. Please check the details and try again.";
      const clean = { ...body };
      for (const key of ["message", "error"]) {
        if (typeof clean[key] === "string") clean[key] = userFacingMessage(clean[key], fallback);
      }
      if (Array.isArray(clean.errors)) {
        clean.errors = clean.errors.map((e) => {
          if (typeof e === "string") return userFacingMessage(e, fallback);
          if (e && typeof e === "object") {
            const item = { ...e };
            delete item.value;                 // never echo submitted data
            for (const key of ["message", "msg"]) {
              if (typeof item[key] === "string") item[key] = userFacingMessage(item[key], fallback);
            }
            return item;
          }
          return e;
        });
      }
      return send(clean);
    }
    return send(body);
  };
  next();
});
// The remaining request guards (load shedder → tenant quota → passport →
// robots.txt/static uploads → X-Instance-Id) live in lib/httpHardening.js and
// run here, exactly where the block used to sit.
applyRequestGuards(app);

// ─── Health & readiness ───────────────────────────────────────────────────────
let serverReady = false;
// Render's healthCheckPath pings /health around the clock. Probing the DB and
// Redis on every ping bills BOTH platforms for commands (the Postgres quota
// AND the Upstash command quota) — so the deep verdict runs at most once per
// AKORO_HEALTH_PROBE_SECONDS (default 120) and is cached. `?deep=1` always
// probes now (humans, alerting).
const HEALTH_PROBE_MS = 1000 * Math.max(Number(process.env.AKORO_HEALTH_PROBE_SECONDS) || 120, 15);
let healthCache = { at: 0, dbOk: false, redisOk: false };
let runpodProbe  = null;   // last DEEP probe of the RunPod parse endpoint

/* Best-effort probe of the configured RunPod parse endpoint — never throws.
   The endpoint is an OPTIONAL dependency (scanned-PDF extraction degrades
   gracefully without it), so its state is REPORTED in /health, never gated
   into the 200/503: Render restarts services whose health check fails, and
   a RunPod blip must not restart the API. */
const probeRunpod = async () => {
  try {
    const d = await runpodEndpointHealth();
    return { ok: true, status: d.status ?? null, jobs: d.jobs ?? null,
             workers: d.workers ?? null, latencyMs: d.latencyMs ?? null,
             checkedAt: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: e?.message || "probe failed", checkedAt: new Date().toISOString() };
  }
};
app.get("/health", async (req, res) => {
  const deep = req.query.deep === "1";
  const fresh = Date.now() - healthCache.at < HEALTH_PROBE_MS;
  if (deep || !fresh) {
    // Zero-Redis health: ioredis keeps `status` current from connect/error
    // events — no PING round-trip, so an uptime monitor costs 0 commands.
    const redisOk = redisPub.status === "ready";
    const dbOk = await checkDb();
    // RunPod is probed only on a deep, deliberate check (?deep=1) AND only
    // when configured — the cached fast path never waits on it.
    runpodProbe = deep && recordsExtractionEnabled() ? await probeRunpod() : null;
    healthCache = { at: Date.now(), dbOk, redisOk };
  }
  const { dbOk, redisOk } = healthCache;
  const healthy = dbOk && redisOk;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded", instance: config.instanceId,
    uptime: Math.round(process.uptime()), env: config.nodeEnv,
    // Build identity: WHICH code is live must be answerable without server
    // access — a frontend fix deployed while the API silently rolled back
    // (or vice versa) otherwise reads as "the fix didn't work". Render sets
    // RENDER_GIT_COMMIT on every deploy; module flags prove specific fixes
    // are on board (the communities query deadline).
    build: {
      git: process.env.RENDER_GIT_COMMIT || null,
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    },
    modules: { communities: { queryDeadlineMs: COMMUNITIES_QUERY_TIMEOUT_MS } },
    egress: {
      sinceBootBytes: egress.totalBytes,
      last24hBytes: egress.hours.reduce((s, h) => s + h.bytes, 0),
      hourlyBytes: egress.hours.map((h) => ({ hour: h.hour, bytes: h.bytes })),
      // The category Render billed 5.67 GB of: bytes the service itself
      // SENDS (prompts, audio, Supabase bodies, header volume). Numbers
      // only — the per-host attribution lives behind the internal secret.
      outboundSinceBootBytes: outboundSummary().totalBytes,
      outboundLast24hBytes: outboundSummary().last24hBytes,
      // Top destinations by outbound bytes so a browser visit to /health is
      // enough to see WHO is eating the budget (hostnames only — the
      // Supabase project ref is already public in the web client bundle).
      outboundTopHosts: outboundSummary().hosts.slice(0, 3).map((h) => ({ host: h.host, bytes: h.bytes, requests: h.requests })),
    },
    checks: { database: dbOk ? "ok" : "error", redis: redisOk ? "ok" : "error" },
    // Whether background workers are paused because the Redis quota ran out (lib/redisQuotaGuard.js).
    redisQuota: redisQuotaStatus(),
    // RunPod parse-worker setup: config presence is always visible (cheap,
    // no round-trip — set RUNPOD_API_KEY + RUNPOD_PARSE_ENDPOINT_ID on this
    // service and `configured` flips here). `probe` appears only after a
    // ?deep=1 with config present: RunPod's own endpoint health (workers,
    // queue) plus latency. Informational — see probeRunpod above.
    runpod: {
      configured: recordsExtractionEnabled(),
      keyPresent: !!process.env.RUNPOD_API_KEY,
      endpointId: process.env.RUNPOD_PARSE_ENDPOINT_ID || null,
      ...(runpodProbe ? { probe: runpodProbe } : {}),
    },
    // Breaker states are local (no round-trip): a provider outage is visible
    // in /health the moment it trips, not only when requests fail.
    breakers: breakerStats(),
    cached: !deep && fresh,
  });
});
app.get("/ready", (_req, res) =>
  res.status(serverReady ? 200 : 503).json({ ready: serverReady, instance: config.instanceId })
);

// GET /internal/preflight — the SECURITY_CHECKLIST §1 config-blocker gate as an
// endpoint (same checks as `npm run preflight`). A posture report is sensitive
// (it names what's misconfigured), so it is NOT public: it requires the
// x-internal-secret header (same guard as the worker-callback endpoints). With
// INTERNAL_SECRET unset it answers 503 — off, never open (Phase 15 item 4).
// Returns 200 when all blockers pass, 503 when any fail — so an uptime
// monitor / deploy step can gate.
// GET /internal/egress — the per-route answer to "what is eating the
// bandwidth". Same guard as preflight.
app.get("/internal/egress", requireSharedSecret("INTERNAL_SECRET"), (req, res) => {
  res.json({
    since: egress.since,
    totalBytes: egress.totalBytes,
    requests: egress.requests,
    hours: egress.hours,
    outbound: outboundSummary(),
    routes: [...egress.byRoute.entries()]
      .map(([route, v]) => ({ route, ...v, avgBytes: Math.round(v.bytes / Math.max(v.requests, 1)) }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 30),
  });
});
app.get("/internal/preflight", requireSharedSecret("INTERNAL_SECRET"), (req, res) => {
  const result = runConfigChecks(process.env);
  res.status(result.ok ? 200 : 503).json({
    ready: result.ok, instance: config.instanceId, env: config.nodeEnv, ...result,
  });
});

// ─── Module routes (with tiered rate limits) ─────────────────────────────────
//   strictLimit   — login/register (5 req/15 min, by IP)
//   refreshLimit  — token refresh  (30 req/15 min, by IP)
//   standardLimit — read APIs      (100 req/min, by user or IP)
//   teachingLimit — adaptive       (50 req/min, by user or IP)
//   aiLimit       — AI operations  (10 req/min, by user or IP)
//   internalLimit — background jobs (300 req/min, all jobs pooled)
//
// "by user" only became true when this was added: the limiters are mounted
// here, authenticateToken lives inside each router, so req.user did not exist
// when the key was computed and every limiter fell back to per-IP. Behind a
// proxy that is ONE bucket for the whole platform. This verifies the token's
// signature (no DB) just to answer "whose quota is this?".
// Proxy trust is opt-in (a HOP COUNT, never `true`) and the first-request
// X-Forwarded-For diagnostic is one-shot; both live in lib/proxyTrust.js and
// run before the rate-limit identity middleware, exactly as before.
applyProxyTrust(app);

app.use("/api", attachRateLimitIdentity);
// Usage metering: attribute every DB command this request causes to its
// route (ids normalised out so cardinality stays bounded).
app.use("/api", (req, res, next) => {
  const norm = req.path.replace(/\/[0-9a-f-]{16,}/gi, "/:id").replace(/\/\d+/g, "/:id");
  runWithRouteUsage(`${req.method} ${norm}`, next);
});
// Background jobs call this same API over loopback as the user who scheduled
// the work. They skip the per-user limiters and are counted here instead, so a
// cron firing six assignments cannot trip a 10/min ceiling — while a runaway
// loop still hits one.
app.use("/api", internalLimit);
// Unified Paystack webhook — verifies the signature once from the raw body and
// dispatches to every fulfillment domain (course/cart, agent/tool, payouts).
// The mount path is derived from PAYSTACK_WEBHOOK_URL (its path component) so it
// stays in sync with what's configured in the Paystack dashboard; it defaults
// to /api/webhooks/paystack when the env var is unset.
app.use(PAYSTACK_WEBHOOK_PATH, paystackWebhookRouter);
// Private Python-agent tool gateway. It has its own shared credential and
// session-bound capability; standardLimit still protects the service caller.
app.use("/api/internal/agent-tools/v1", standardLimit, agentToolsModule);
// Browser-facing review/approve/decline endpoints for Python-agent write
// proposals. They authenticate the learner and never expose the private tools
// credential.
app.use("/api/agent-actions/v1", standardLimit, agentActionConfirmationsModule);
// Learner-visible controls to inspect and clear compact study memory created by
// the additive Python agent. Raw chat history remains at /api/adaptive/chat.
app.use("/api/agent-memory/v1", standardLimit, agentMemoryModule);
app.use("/api/auth",     authModule);           // auth router applies strictLimit/refreshLimit internally
app.use("/api",          standardLimit, coursesModule);
app.use("/api/ranking",  standardLimit, rankingModule);
app.use("/api/agent-network", standardLimit, agentNetworkModule);   // learners' agents finding, messaging, challenging each other
app.use("/api/profiles", standardLimit, profilesModule);
app.use("/api/wallet",   standardLimit, walletModule);
app.use("/api/vouchers", standardLimit, vouchersModule);
app.use("/api/adaptive", teachingLimit,  adaptiveModule);
app.use("/api/battle",   standardLimit, battleModule);
app.use("/api/battle",   standardLimit, battleFeedRouter);

// ─── Boot-time migrations (host-independent) ────────────────────────────────
// Railway applied migrations as a release step; Render's equivalent
// (preDeployCommand) needs a paid plan, so free-tier deploys silently skipped
// them. The backend now self-migrates at boot: idempotent SQL + a session
// advisory lock make it safe, and the run is skipped entirely when the last
// edu.migration_log row already matches this deploy's SHA — so a plain
// restart (free tier wake) costs one SELECT, not 150 DDL statements.
// It deliberately runs BEFORE any background worker starts: workers query
// tables at startup (learner-autonomy schedule recovery), and on the deploy
// that introduces a new table the old boot order let the worker race the
// migration and log a scary failure. Schema only, never demo data (mirrors
// the old deploy command).
// Disable with MIGRATIONS_ON_BOOT=false (e.g. one replica owns migrations).
if (process.env.MIGRATIONS_ON_BOOT !== "false") {
  const mUrl = migrationUrl();
  const mSha = currentGitSha();
  if (!mUrl) {
    console.warn("[MIGRATIONS] no MIGRATION_DATABASE_URL/DATABASE_URL configured — boot migration SKIPPED. Set the Supabase Postgres connection string so deploys self-migrate.");
  } else {
    // The boot waits for the migrations at most MIGRATIONS_BOOT_WAIT_MS (default
    // 60s), then opens its port with them still running: the host fails a
    // deploy whose port doesn't open in time, and a slow database once made
    // the whole run outlast it ("Port scan timeout reached").
    const run = (async () => {
      if (await migrationsAlreadyApplied(mUrl, mSha)) {
        console.log(`[MIGRATIONS] already applied for ${String(mSha).slice(0, 7) || "this build"} — skipping boot run`);
        return;
      }
      // The gate's sandbox (VERIFY_TARGET=sandbox, its own database) also gets the
      // demo seeds — schools, courses, classes — so its testers have a world to act in.
      const groups = process.env.VERIFY_TARGET === "sandbox" ? ["schema", "demo"] : ["schema"];
      const { failed } = await applyMigrations({ url: mUrl, groups, label: "boot" });
      if (failed) console.error(`[MIGRATIONS] ${failed} migration(s) FAILED at boot — check the logs above; the API is starting anyway.`);
    })().catch((e) => {
      // A failed migration must not crash-loop the whole service: start and
      // let the loud log (and /health) tell the operator. The error is also
      // recorded in edu.migration_log for the next boot to retry.
      console.error("[MIGRATIONS] boot run failed — starting anyway:", e.message);
    });
    const waitMs = Math.max(5_000, Number(process.env.MIGRATIONS_BOOT_WAIT_MS) || 60_000);
    let waited = false;
    await Promise.race([run, new Promise((r) => setTimeout(() => { waited = true; r(); }, waitMs).unref())]);
    if (waited) console.warn(`[MIGRATIONS] still running after ${Math.round(waitMs / 1000)}s — starting the API; they finish in the background.`);
  }
}

// ─── Background workers (lib/startWorkers.js) ────────────────────────────────
// Started after boot migrations and before the listener. The per-job gates and
// the original order moved with the code; the contract is still:
//   skipJob("battle worker"), skipJob("eval worker"),
//   skipJob("chat follow-ups worker"), skipJob("learner-autonomy worker"),
//   skipJob("autonomy cycle worker"), skipJob("embedding sweeper"),
//   skipJob("alert worker"), skipJob("routine scheduler"), skipJob("outbox"),
//   skipJob("deferred jobs"), skipJob("execution log").
// startWorkers() runs m.startDeferredRelease() and m.migrateBackgroundQueues()
// on their original timers, and startExecutionLogMaintenance() last.
const skipJob = sharedSkipJob;
const stopWorkers = await startWorkers();
app.use("/api/student",  standardLimit, studentFeedRouter);
app.use("/api/tasks",      aiLimit,       tasksModule);
// Only /plan calls a model; the rest is ordinary CRUD. Putting the whole module
// behind aiLimit capped a teacher at 10 requests a minute for listing and
// assigning, which a single afternoon of setting work would blow straight past.
app.use("/api/self-study/plan", aiLimit);
app.use("/api/self-study", standardLimit, selfStudyModule);
app.use("/api/pharmd",      standardLimit, pharmdModule);          // PHARM.D programme catalogue
app.use("/api/programmes",  standardLimit, programmesModule);  // Program Courses (admin)
app.use("/api/course-builder", standardLimit, courseBuilderModule);  // Course Creator (instructor)
app.use("/api/hf",          standardLimit, hfMirrorModule);        // Hugging Face model mirror console (key-guarded)
app.use("/api/parse",       standardLimit, parseConsoleModule);
app.use("/api/self-tooling",  standardLimit, selfToolingModule);     // learner: my agent-built tools
startViewRegistry();  // data-driven Data Views: merge edu.self_tool_views into the live registry (fail-open)
app.use("/api/verify",        standardLimit, verifyModule);          // Verification Gate (AGENT_CONSOLE_KEY) — PASS/FAIL with evidence
app.use("/api/agent-console", standardLimit, agentConsoleModule);   // learner Agent Chat test console (AGENT_CONSOLE_KEY)   // parse-worker console (key-guarded browser tester)
app.use("/api/communities",  standardLimit, communitiesModule);  // higher-ed study groups
app.use("/api/instructor/tools", standardLimit, instructorToolsModule);  // platform tools/assets catalog + purchase
app.use("/api/teaching/tools",   aiLimit,       teachingToolsModule);  // teaching tool suite — LLM + TTS, so aiLimit
app.use("/api/teaching/workflows", standardLimit, teachingWorkflowsModule);  // direct teaching session as a workflow (§15, Scenario A)
app.use("/api/past-questions",   standardLimit, pastQuestionsModule);  // WAEC/NECO/JAMB/NCEE question bank
app.use("/api/curriculum",       standardLimit, curriculumModule);     // NERDC & co. curriculum bank
app.use("/api/instructor", standardLimit, instructorModule);
app.use("/api/school",     standardLimit, schoolModule);        // school partner portal
app.use("/api/voice",      aiLimit,       voiceModule);
app.use("/api/content",    standardLimit, contentModule);   // public blog + careers, admin CRUD
app.use("/api/admin",      standardLimit, adminModule);     // admin-only: users, instructors, courses, stats
app.use("/api/goals",      standardLimit, learnerGoalsModule); // the learner's educational goals (Full Autonomy spine)
app.use("/api/workflows", standardLimit, workflowsModule);   // event stream: replay + live (§7.9.6)
app.use("/api/agent", standardLimit, agentLearnerModule);   // proactive agent: settings (consents, quiet hours, budget) + Ideas (§7.16)
app.use("/api/agent/proposals", standardLimit, agentProposalsModule); // Full Autonomy proposal inbox (approve executes via chat tools)
app.use("/api/agent/materials", standardLimit, materialsModule);   // chat uploads → a Library folder (material_ingest, §7.17)
app.use("/api/blogs",      standardLimit, blogsModule); // learner-authored blogs (higherEd library: draft / publish)
app.use("/api/records",    standardLimit, recordsModule); // learner library shelf: uploads (R2), links, pastes
app.use("/api/contact",    standardLimit, contactModule);  // public contact/partner intake + admin inbox
app.use("/api/public/pilot-applications", standardLimit, pilotApplicationsModule); // public /apply form (Tiers & Credits plan §4.2 — the one unauth write)
app.use("/api/subscriptions",  standardLimit, billingGatewayModule); // learner subscription checkout (Phase 3; webhook-fulfilled)
app.use("/api/internal/ticks", ticksRouter);            // scheduler ticks — x-internal-secret, not JWT (Cloudflare cron ticker)

// ─── 404 ──────────────────────────────────────────────────────────────────────
// ─── 404 + global error handler ──────────────────────────────────────────────
// Last in the stack (lib/errorHandler.js): the typed client-error contract and
// the fail-fast breaker/queue responses are unchanged.
installErrorHandlers(app);

// ─── Process safety nets + graceful shutdown ─────────────────────────────────
installProcessSafety();
installShutdown({
  httpServer, redisPub, redisSub, config, stopWorkers,
  setReady: (ready) => { serverReady = ready; },
});

// ─── Start ────────────────────────────────────────────────────────────────────
// Boot-time migrations already ran — they sit ABOVE the background-worker
// section so no worker can query a table before the deploy that creates it
// has applied (the learner-autonomy recovery race of 2026-09-12).

// Weekly routine preparation (drafts only — assignment stays human).
startRoutineSchedulerJob();

// Context-layer preflight (Context Layer Adoption P0): every registered
// doctrine set must resolve within budget or the process refuses to serve —
// agent behaviour can never silently change because a workspace file went
// missing. The logged version hash makes doctrine drift observable.
{
  const { preflight } = await import("./modules/agent-context/index.js");
  const contextLayer = await preflight();
  if (!contextLayer.ok) {
    console.error("[context-layer] PREFLIGHT FAIL:", contextLayer.problems.join(" | "));
    process.exit(1);
  }
  console.log(`[context-layer] ok v${contextLayer.version} — ${contextLayer.sets.length} sets, manifest v${contextLayer.manifestVersion}`);
  // Admin-edited prompt parts (Phase 18 item 7): from now on a part with an
  // override loads the admin's text (30-second cache; AGENT_PROMPT_OVERRIDES=off
  // turns them all off). The preflight above checked the shipped defaults.
  const { installPromptOverrides } = await import("./modules/agent-context/index.js");
  if (installPromptOverrides()) console.log("[context-layer] prompt overrides on");
}

// Persisted admin override for the global default model (survives restarts).
void loadRuntimeSettings();
httpServer.listen(config.server.port, config.server.host, () => {
  serverReady = true;

  // Warm the tenant-host cache, then keep it fresh. Until it loads, every
  // unknown subdomain is treated as a school site and denied credentials — so
  // a slow or failed load costs a broken page, never an open door.
  refreshTenantHosts()
    .then((r) => console.log(`[tenant] host cache: ${r.slugs} school slugs, ${r.domains} custom domains${r.loaded ? "" : " (NOT LOADED — credentials denied to unlisted subdomains)"}`))
    .catch(() => {});
  if (!skipJob("tenant host refresh")) {
    setInterval(() => { refreshTenantHosts().catch(() => {}); }, 5 * 60 * 1000).unref?.();
  }
  printStartBanner(config);

  // Best-effort: show the last DB migration run so deploys are verifiable
  // from the API's own boot log (never blocks startup).
  void logLastMigration(db);
});

// Start the background task worker (Anthropic agent loop) if enabled
startTaskWorker();

export { io };
export default app;
