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

import "dotenv/config";
import express                    from "express";
import { createServer }           from "http";
import { Server as SocketServer } from "socket.io";
import { createAdapter }          from "@socket.io/redis-adapter";
import Redis                      from "ioredis";
import cors                       from "cors";
import helmet                     from "helmet";
import cookieParser               from "cookie-parser";
import path                       from "path";
import { fileURLToPath }          from "url";
import { MulterError }            from "multer";
import {
  strictLimit, refreshLimit, standardLimit, teachingLimit, aiLimit,
  internalLimit, attachRateLimitIdentity, requestLogger,
} from "./middleware/security.js";

import config                     from "./config/index.js";
import { runConfigChecks }         from "./lib/preflightChecks.js";
import { runWithRouteUsage } from "./lib/usageMeter.js";
import { schoolBillTo }            from "./lib/coins.js";
import { SITE_BASE_DOMAINS, isTenantHost, refreshTenantHosts } from "./modules/school/tenant.js";
import db, { checkDb }           from "./db.js";
import { applyMigrations, migrationsAlreadyApplied, migrationUrl, currentGitSha } from "./lib/migrations.js";
import { traceRedis, startRedisTraceReporting } from "./lib/redisTrace.js";

// ─── Module imports ───────────────────────────────────────────────────────────
import authModule, { authenticateSocket } from "./modules/auth/routes.js";
import walletModule from "./modules/wallet/routes.js";
import vouchersModule from "./modules/vouchers/index.js";
import coursesModule              from "./modules/courses/index.js";
import rankingModule              from "./modules/ranking/routes.js";
import profilesModule             from "./modules/profiles/routes.js";
import adaptiveModule, {
  setupAdaptiveWebSocket }        from "./modules/adaptive-learning/index.js";
import { startChatFollowUpWorker } from "./modules/adaptive-learning/chat-follow-ups.js";
import { startLearnerAutonomyWorker, recoverLearnerAutonomySchedules } from "./modules/adaptive-learning/learner-autonomy.js";
import battleModule               from "./modules/battle/routes.js";
import tasksModule                from "./modules/tasks/routes.js";
import selfStudyModule            from "./modules/self-study/routes.js";
import { startRoutineScheduler }  from "./modules/self-study/routines.js";
import communitiesModule          from "./modules/communities/routes.js";
import instructorModule           from "./modules/instructor/index.js";
import instructorToolsModule      from "./modules/instructor/tools.js";
import teachingToolsModule        from "./modules/teaching/tools.js";
import pastQuestionsModule        from "./modules/past-questions/routes.js";
import curriculumModule           from "./modules/curriculum/routes.js";
import schoolModule               from "./modules/school/index.js";
import { studentFeedRouter,
         battleFeedRouter }       from "./modules/courses/student-feed.js";
import voiceModule               from "./modules/voice/routes.js";
import { setupVoiceStreaming }   from "./modules/voice/streaming.js";
import contentModule             from "./modules/content/routes.js";
import paystackWebhookRouter     from "./modules/webhooks/paystack.js";
import adminModule              from "./modules/admin/index.js";
import contactModule            from "./modules/contact/routes.js";
import agentToolRequestsModule  from "./modules/agent-tool-requests/routes.js";
import learnerGoalsModule       from "./modules/learner-goals/routes.js";
import agentProposalsModule      from "./modules/agent-proposals/routes.js";
import blogsModule               from "./modules/blogs/routes.js";
import {
  agentToolsRouter as agentToolsModule,
  agentActionConfirmationsRouter as agentActionConfirmationsModule,
  agentMemoryRouter as agentMemoryModule,
} from "./modules/agent-tools/index.js";
import passport                  from "passport";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
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
// Support comma-separated list: CORS_ORIGIN=https://akoro.app,https://instructor.akoro.app
const allowedOrigins = config.server.corsOrigin === '*'
  ? '*'
  : config.server.corsOrigin.split(',').map(s => s.trim()).filter(Boolean);

// Beyond the explicit list, also allow the apex, www, and EVERY subdomain of
// the wildcard base domain(s) — so www.<domain> and every tenant school site
// (<slug>.<domain>) can call the API without being listed one by one.
const originHost = (o) => { try { return new URL(o).hostname.toLowerCase(); } catch { return ''; } };
const stripWww = (h) => h.replace(/^www\./, '');
// The platform's OWN front-ends. These are configured as env URLs and are not
// tenant sites, so they belong in the credentialed set even when CORS_ORIGIN
// doesn't spell them out. Missing them is what broke the AI-chat hand-off: the
// school portal sits at a subdomain of the base domain, so the wildcard matched
// it for access but the credentials rule — correctly — did not.
const PLATFORM_APP_URLS = [
  process.env.FRONTEND_URL, process.env.MAIN_SITE_URL,
  process.env.SCHOOL_FRONTEND_URL, process.env.INSTRUCTOR_FRONTEND_URL,
  process.env.INSTRUCTOR_APP_URL, process.env.ADMIN_FRONTEND_URL,
  process.env.AGENT_FRONTEND_URL, process.env.BUSINESS_FRONTEND_URL,
  process.env.VOUCHERS_FRONTEND_URL,
].filter(Boolean);

// Hostnames are no longer guessed. isTenantHost() answers from the actual
// school slugs and verified custom domains, so any subdomain of the base domain
// that ISN'T a school is one of our apps — whatever it happens to be named.
// The cache is warmed at boot and refreshed in the background.

const listedHosts = new Set(
  allowedOrigins === '*' ? [] :
  [...allowedOrigins, ...PLATFORM_APP_URLS].map(originHost).filter(Boolean).map(stripWww)
);
function isAllowedOrigin(origin) {
  if (!origin) return true;                 // curl / mobile / same-origin
  const bare = stripWww(originHost(origin));
  if (!bare) return false;
  if (listedHosts.has(bare)) return true;                                        // explicitly listed (± www)
  if (SITE_BASE_DOMAINS.some((b) => bare === b || bare.endsWith(`.${b}`))) return true; // apex/any subdomain of base
  return false;
}
const corsOriginFn = (origin, cb) => isAllowedOrigin(origin)
  ? cb(null, true)
  : cb(new Error(`CORS: origin ${origin} not allowed`));

// CREDENTIALS are granted only to the explicitly listed portal origins.
//
// Tenant school sites (<slug>.<base domain>) are allowed to call the API, but
// WITHOUT cookies. They must not be credentialed: a school admin can put
// arbitrary <script> in header_scripts/footer_scripts and page HTML on their
// own site, so a credentialed wildcard would let that script call the API as
// ANY signed-in visitor — a parent, a teacher, or an admin of another school —
// and read the response. School sites only need public endpoints, so this
// costs them nothing.
const isListedOrigin = (origin) => {
  if (!origin) return true;                       // curl / mobile / same-origin
  const bare = stripWww(originHost(origin));
  if (!bare) return false;
  if (listedHosts.has(bare)) return true;         // explicitly configured
  if (isTenantHost(bare)) return false;           // a school's own site — never credentialed
  // Ours: an app on the base domain, under whatever name it is deployed.
  return SITE_BASE_DOMAINS.some((b) => bare === b || bare.endsWith(`.${b}`));
};
// One line per origin, the first time it is seen, so a wrongly-classified host
// shows up in the deploy log instead of only in someone's browser console.
const seenOrigins = new Set();
const corsDelegate = (req, cb) => {
  const origin = req.headers.origin;
  if (origin && !seenOrigins.has(origin)) {
    seenOrigins.add(origin);
    const bare = stripWww(originHost(origin));
    console.log(`[cors] ${origin} → allowed=${isAllowedOrigin(origin)} credentials=${isListedOrigin(origin)}` +
      ` (listed=${listedHosts.has(bare)} tenant=${isTenantHost(bare)})`);
  }
  cb(null, {
    origin: allowedOrigins === '*' ? true : isAllowedOrigin(origin),
    credentials: allowedOrigins === '*' ? true : isListedOrigin(origin),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Akoro-Portal", "X-Internal-Secret"],
  });
};

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

// Authenticate every socket connection from its handshake cookies/token.
// Anonymous connections are still ACCEPTED (socket.data.user = null) so public
// flows keep working — but identity-bearing events (adaptive teaching,
// proctored assessments, voice streaming, user-scoped rooms) require and use
// socket.data.user instead of trusting client-supplied ids.
io.use(async (socket, next) => {
  socket.data.user = await authenticateSocket(socket);
  // AI billing target: on a school portal the school funds usage (billTo);
  // elsewhere the user's own wallet (student-first hybrid) is used.
  const portal = socket.handshake?.auth?.portal || socket.handshake?.query?.portal || null;
  socket.data.portal = portal;
  socket.data.billTo = (["school", "school_admin", "site"].includes(portal) && socket.data.user)
    ? await schoolBillTo(socket.data.user.id).catch(() => null)
    : null;
  next();
});

io.on("connection", (socket) => {
  socket.on("join-session",            (id) => socket.join(`session:${id}`));
  socket.on("leave-session",           (id) => socket.leave(`session:${id}`));
  socket.on("join-chat",               (id) => socket.join(`chat:${id}`));
  socket.on("leave-chat",              (id) => socket.leave(`chat:${id}`));
  socket.on("join-classroom",          (id) => socket.join(`classroom:${id}`));
  socket.on("join-battle",             (id) => socket.join(`battle:${id}`));
  socket.on("leave-battle",            (id) => socket.leave(`battle:${id}`));
  // User-scoped rooms: join the AUTHENTICATED user's room only — the payload
  // id is ignored, so nobody can subscribe to someone else's notifications.
  socket.on("subscribe-notifications", () => { const u = socket.data.user; if (u) socket.join(`user:${u.id}`); });
  socket.on("subscribe-student",       () => { const u = socket.data.user; if (u) socket.join(`user:${u.id}`); });
  // Joins student:{id} room for decay alerts from decayEngine cron
  socket.on("join-student-room",       () => { const u = socket.data.user; if (u) socket.join(`student:${u.id}`); });
  socket.on("join-instructor",         () => { const u = socket.data.user; if (u) socket.join(`instructor:${u.id}`); });
});

setupAdaptiveWebSocket(io);
setupVoiceStreaming(io);

// ─── Core middleware ──────────────────────────────────────────────────────────
// Order: helmet → cors → cookies → body → security logging → auth → routes
app.use(helmet({
  contentSecurityPolicy: false,   // configured separately per-page if needed
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors(corsDelegate));
app.use(cookieParser());
// Paystack webhook signature validation needs the RAW request body. The raw
// parser must run BEFORE the global JSON parser (body-parser skips bodies
// already consumed by an earlier parser) — otherwise req.body arrives here as
// a parsed object, .toString() yields "[object Object]", and every webhook is
// rejected with "Invalid signature" (payments then never auto-grant agents).
app.use("/api/adaptive/marketplace/webhook", express.raw({ type: "application/json" }));
app.use(PAYSTACK_WEBHOOK_PATH,               express.raw({ type: "application/json" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(passport.initialize());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use((_req, res, next) => { res.setHeader("X-Instance-Id", config.instanceId); next(); });

// ─── Health & readiness ───────────────────────────────────────────────────────
let serverReady = false;
// Render's healthCheckPath pings /health around the clock. Probing the DB and
// Redis on every ping bills BOTH platforms for commands (the Postgres quota
// AND the Upstash command quota) — so the deep verdict runs at most once per
// AKORO_HEALTH_PROBE_SECONDS (default 120) and is cached. `?deep=1` always
// probes now (humans, alerting).
const HEALTH_PROBE_MS = 1000 * Math.max(Number(process.env.AKORO_HEALTH_PROBE_SECONDS) || 120, 15);
let healthCache = { at: 0, dbOk: false, redisOk: false };
app.get("/health", async (req, res) => {
  const deep = req.query.deep === "1";
  const fresh = Date.now() - healthCache.at < HEALTH_PROBE_MS;
  if (deep || !fresh) {
    // Zero-Redis health: ioredis keeps `status` current from connect/error
    // events — no PING round-trip, so an uptime monitor costs 0 commands.
    const redisOk = redisPub.status === "ready";
    const dbOk = await checkDb();
    healthCache = { at: Date.now(), dbOk, redisOk };
  }
  const { dbOk, redisOk } = healthCache;
  const healthy = dbOk && redisOk;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded", instance: config.instanceId,
    uptime: Math.round(process.uptime()), env: config.nodeEnv,
    checks: { database: dbOk ? "ok" : "error", redis: redisOk ? "ok" : "error" },
    cached: !deep && fresh,
  });
});
app.get("/ready", (_req, res) =>
  res.status(serverReady ? 200 : 503).json({ ready: serverReady, instance: config.instanceId })
);

// GET /internal/preflight — the SECURITY_CHECKLIST §1 config-blocker gate as an
// endpoint (same checks as `npm run preflight`). A posture report is sensitive
// (it names what's misconfigured), so it is NOT public: it requires the
// x-internal-secret header (same guard as the worker-callback endpoints). In dev
// (no INTERNAL_SECRET set) it's open for convenience. Returns 200 when all
// blockers pass, 503 when any fail — so an uptime monitor / deploy step can gate.
app.get("/internal/preflight", (req, res) => {
  const secret = config.internalSecret;
  const authorized = secret
    ? req.headers["x-internal-secret"] === secret
    : config.isDev;   // no secret configured → allow only in dev
  if (!authorized) return res.status(403).json({ success: false, message: "Forbidden" });
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
/**
 * Proxy trust — deliberately opt-in.
 *
 * req.ip is the socket peer unless Express is told how many proxies sit in
 * front. On a platform edge that means every visitor shares one address, so
 * every IP-keyed limit (login: 5 per 15 min) is one bucket for everybody.
 *
 * The fix is a HOP COUNT, never `true`: trusting the whole chain lets a caller
 * spoof X-Forwarded-For and pick their own bucket, which is worse than sharing
 * one. Left unset by default so this change can't silently make things less
 * safe. The diagnostic below reads the hop count off a real request and tells
 * you the number to use — guessing it gets you an intermediate proxy, not the
 * visitor.
 */
if (process.env.TRUST_PROXY !== undefined && process.env.TRUST_PROXY !== "") {
  const hops = Number(process.env.TRUST_PROXY);
  app.set("trust proxy", Number.isFinite(hops) ? hops : process.env.TRUST_PROXY);
  console.log(`[security] trust proxy = ${process.env.TRUST_PROXY}`);
}

/**
 * One-shot diagnostic: print what the first API request actually looks like,
 * and work out the hop count rather than guessing it.
 *
 * X-Forwarded-For is built left-to-right: the leftmost entry is the original
 * client, and each proxy appends the address it received the request from. So
 * the number of entries IS the number of hops to trust — with two entries,
 * TRUST_PROXY=1 yields the intermediate proxy, not the visitor.
 */
let ipProbed = false;
app.use("/api", (req, _res, next) => {
  if (!ipProbed) {
    ipProbed = true;
    const xff  = req.headers["x-forwarded-for"];
    const hops = xff ? String(xff).split(",").length : 0;

    console.log("[security] first request — req.ip=%s socket=%s x-forwarded-for=%s trustProxy=%s",
      req.ip, req.socket?.remoteAddress, xff ?? "(none)", app.get("trust proxy") ?? "(unset)");

    if (!process.env.TRUST_PROXY && hops) {
      console.warn(`[security] X-Forwarded-For has ${hops} hop(s) but TRUST_PROXY is unset — ` +
        "IP-keyed limits (login, refresh) are keying on the proxy, i.e. ONE bucket for every " +
        `visitor. Set TRUST_PROXY=${hops} and redeploy.`);
    } else if (process.env.TRUST_PROXY) {
      // Two ways the count can be wrong, and only one of them LOOKS wrong.
      const trusted = Number(process.env.TRUST_PROXY);
      if (Number.isFinite(trusted) && hops > trusted) {
        // The case that slipped through the first time: req.ip resolved to a
        // proxy with a perfectly ordinary public address, so nothing looked
        // amiss — it was simply the wrong machine. Compare the counts rather
        // than judging the address. (A client can pad X-Forwarded-For, so this
        // is phrased as a prompt to check, not a verdict.)
        console.warn(`[security] TRUST_PROXY=${trusted} but X-Forwarded-For has ${hops} hop(s), so ` +
          `req.ip=${req.ip} is a proxy rather than the visitor — everyone behind it shares one ` +
          `rate-limit bucket. If ${hops} hops is your normal setup, set TRUST_PROXY=${hops}.`);
      } else if (isNonRoutable(req.ip)) {
        console.warn(`[security] TRUST_PROXY=${process.env.TRUST_PROXY} but req.ip=${req.ip} is a ` +
          `private or carrier-NAT address, so it is not the visitor. X-Forwarded-For has ` +
          `${hops} hop(s) — try TRUST_PROXY=${hops}.`);
      }
    }
  }
  next();
});

/** Private, loopback and carrier-grade-NAT ranges — never a real visitor. */
function isNonRoutable(ip) {
  if (!ip) return true;
  const v4 = String(ip).replace(/^::ffff:/, "");
  return /^(10\.|127\.|192\.168\.|169\.254\.|::1$|fc|fd)/.test(v4)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(v4)
      || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v4);   // 100.64.0.0/10
}

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
    try {
      if (await migrationsAlreadyApplied(mUrl, mSha)) {
        console.log(`[MIGRATIONS] already applied for ${String(mSha).slice(0, 7) || "this build"} — skipping boot run`);
      } else {
        const { applied, failed } = await applyMigrations({ url: mUrl, groups: ["schema"], label: "boot" });
        if (failed) console.error(`[MIGRATIONS] ${failed} migration(s) FAILED at boot — check the logs above; the API is starting anyway.`);
      }
    } catch (e) {
      // A failed migration must not crash-loop the whole service: start and
      // let the loud log (and /health) tell the operator. The error is also
      // recorded in edu.migration_log for the next boot to retry.
      console.error("[MIGRATIONS] boot run failed — starting anyway:", e.message);
    }
  }
}

// ─── Background jobs kill switch ─────────────────────────────────────────────
// Every recurring job (sweeps, crons, schedulers) burns Redis commands while
// the process runs — on a metered free tier that can outrun real usage with
// ZERO users. Three dials, most specific wins:
//   AKORO_JOBS_ENABLED="chat follow-ups worker,learner-autonomy worker"
//     → ONLY the named jobs run (each BullMQ worker idles at ~1-2k cmds/month,
//       so running only the learner-facing two fits the free tier comfortably)
//   AKORO_JOBS_DISABLED="eval worker,battle worker"
//     → all jobs EXCEPT the named ones run
//   AKORO_BACKGROUND_JOBS_ENABLED=false
//     → the everything switch, unchanged
// Job names are exactly the strings passed to skipJob below (battle worker,
// eval worker, chat follow-ups worker, learner-autonomy worker, autonomy
// cycle worker, embedding sweeper, alert worker, routine scheduler, tenant
// host refresh). The tasks worker has its own legacy gate (ENABLE_TASK_WORKER).
const backgroundJobsEnabled = String(process.env.AKORO_BACKGROUND_JOBS_ENABLED ?? "true").trim().toLowerCase() === "true";
const JOBS_ONLY = String(process.env.AKORO_JOBS_ENABLED ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const JOBS_DISABLED = String(process.env.AKORO_JOBS_DISABLED ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const skipJob = (name) => {
  if (JOBS_ONLY.length && !JOBS_ONLY.includes(name)) {
    console.log(`[jobs] ${name} skipped (not listed in AKORO_JOBS_ENABLED)`);
    return true;
  }
  if (JOBS_DISABLED.includes(name)) {
    console.log(`[jobs] ${name} skipped (AKORO_JOBS_DISABLED)`);
    return true;
  }
  if (backgroundJobsEnabled) return false;
  console.log(`[jobs] ${name} skipped (AKORO_BACKGROUND_JOBS_ENABLED=false)`);
  return true;
};

// Eagerly start the BullMQ battle worker at boot (it was previously imported
// lazily on the first enqueue, so battles could stall until some action kicked
// it). Guarded by REDIS_URL so environments without Redis stay quiet.
if (process.env.REDIS_URL && !skipJob("battle worker")) {
  import("./modules/battle/worker.js")
    .then(() => console.log("[battle] worker started at boot"))
    .catch((e) => console.error("[battle] worker failed to start:", e.message));

  // Eval runs. Same guard: a suite is minutes of model calls, so it runs on a
  // queue and the admin page polls.
  if (!skipJob("eval worker")) {
    import("./lib/evalWorker.js")
      .then((m) => m.startEvalWorker())
      .catch((e) => console.error("[evals] worker failed to start:", e.message));
  }

  // Learner-requested agent check-ins are durable delayed jobs. Their worker
  // creates the persistent chat and notification at the requested time.
  try {
    if (!skipJob("chat follow-ups worker")) {
      startChatFollowUpWorker();
      console.log("[chat-follow-ups] worker started at boot");
    }
  } catch (e) {
    console.error("[chat-follow-ups] worker failed to start:", e.message);
  }

  // The learner's persisted opt-in, not a browser state, authorizes every
  // autonomous due-task nudge. Recovery only restores delayed due-time jobs;
  // it never enables autonomy for a learner.
  try {
    if (!skipJob("learner-autonomy worker")) {
      startLearnerAutonomyWorker();
      recoverLearnerAutonomySchedules()
        .then((scheduled) => console.log(`[learner-autonomy] recovered ${scheduled ?? 0} due-task review(s)`))
        .catch((e) => console.error("[learner-autonomy] schedule recovery failed:", e.message));
      console.log("[learner-autonomy] worker started at boot");
    }
  } catch (e) {
    console.error("[learner-autonomy] worker failed to start:", e.message);
  }

  // Full Autonomy level 2 (Planner): the nightly background cycle. The
  // scheduler ticks once a minute and enqueues at most one small batch
  // inside the 21:00-22:00 Africa/Lagos window — O(learners) jobs per day.
  try {
    if (!skipJob("autonomy cycle worker")) {
      const autonomy = await import("./modules/autonomy/index.js");
      autonomy.startAutonomyCycleWorker();
      console.log("[autonomy] planner worker started at boot");
    }
  } catch (e) {
    console.error("[autonomy] planner worker failed to start:", e.message);
  }
}

// Keeps the vector stores current. Rows arrive without embeddings (SQL seeds,
// a failed inline call) and rows get edited after being embedded; both leave
// search quietly wrong, and nothing used to report either.
if (!skipJob("embedding sweeper")) {
  import("./lib/embeddingSweeper.js")
    .then((m) => m.startEmbeddingSweeper())
    .catch((e) => console.error("[embeddings] sweeper failed to start:", e.message));
}

// Alert rules — spend, latency, failures, and work that has silently stopped.
// Needs no Redis: it reads the telemetry tables on a cron.
if (!skipJob("alert worker")) {
  import("./lib/alertWorker.js")
    .then((m) => m.startAlertWorker())
    .catch((e) => console.error("[alerts] worker failed to start:", e.message));
}
app.use("/api/student",  standardLimit, studentFeedRouter);
app.use("/api/tasks",      aiLimit,       tasksModule);
// Only /plan calls a model; the rest is ordinary CRUD. Putting the whole module
// behind aiLimit capped a teacher at 10 requests a minute for listing and
// assigning, which a single afternoon of setting work would blow straight past.
app.use("/api/self-study/plan", aiLimit);
app.use("/api/self-study", standardLimit, selfStudyModule);
app.use("/api/communities",  standardLimit, communitiesModule);  // higher-ed study groups
app.use("/api/instructor/tools", standardLimit, instructorToolsModule);  // platform tools/assets catalog + purchase
app.use("/api/teaching/tools",   aiLimit,       teachingToolsModule);  // teaching tool suite — LLM + TTS, so aiLimit
app.use("/api/past-questions",   standardLimit, pastQuestionsModule);  // WAEC/NECO/JAMB/NCEE question bank
app.use("/api/curriculum",       standardLimit, curriculumModule);     // NERDC & co. curriculum bank
app.use("/api/instructor", standardLimit, instructorModule);
app.use("/api/school",     standardLimit, schoolModule);        // school partner portal
app.use("/api/voice",      aiLimit,       voiceModule);
app.use("/api/content",    standardLimit, contentModule);   // public blog + careers, admin CRUD
app.use("/api/admin",      standardLimit, adminModule);     // admin-only: users, instructors, courses, stats
app.use("/api",            standardLimit, agentToolRequestsModule); // explicit learner Agent Chat feature/tool requests
app.use("/api/goals",      standardLimit, learnerGoalsModule); // the learner's educational goals (Full Autonomy spine)
app.use("/api/agent/proposals", standardLimit, agentProposalsModule); // Full Autonomy proposal inbox (approve executes via chat tools)
app.use("/api/blogs",      standardLimit, blogsModule); // learner-authored blogs (higherEd library: draft / publish)
app.use("/api/contact",    standardLimit, contactModule);  // public contact/partner intake + admin inbox

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, message: "Route not found" }));

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof MulterError)
    return res.status(400).json({ success: false, message: `Upload error: ${err.message}`, code: err.code });
  console.error(`[${config.instanceId.slice(0, 8)}] [ERROR]`, err.message);
  res.status(500).json({
    success: false, message: "Internal server error", instance: config.instanceId,
    ...(config.isDev && { stack: err.stack }),
  });
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const shutdown = async (signal) => {
  serverReady = false;
  httpServer.close(async () => {
    await redisPub.quit().catch(() => {});
    await redisSub.quit().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), config.server.shutdownTimeout);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// ─── Start ────────────────────────────────────────────────────────────────────
// Boot-time migrations already ran — they sit ABOVE the background-worker
// section so no worker can query a table before the deploy that creates it
// has applied (the learner-autonomy recovery race of 2026-09-12).

// Weekly routine preparation (drafts only — assignment stays human).
if (!skipJob("routine scheduler")) startRoutineScheduler();

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
  console.log(`
[API]  Akoro API  [${config.instanceId.slice(0, 8)}]  --  http://localhost:${config.server.port}

[MODULES]
    /api/auth/*           Auth
    /api/courses/*        Courses + Cart + Payments + Live Sessions
    /api/ranking/*        XP Leaderboards
    /api/profiles/*       Teachers / Classrooms / Schools
    /api/adaptive/*       AI Teaching Agents (NaNa, Professor, Trained)
    /api/battle/*         1v1 / Open / Classroom / Session Battles
    /api/tasks/*          Teacher AI Task Agent

[ENDPOINTS]
    /api/profiles/instructor/students    global student list
    /api/profiles/teacher/invite         magic invite link
    /api/profiles/teacher/students/import CSV bulk import
    /api/profiles/students/:id           edit + message student
    /api/battle/instructor/stats         battle dashboard stats
    /api/battle/battles/:id   PUT        edit battle
    /api/battle/courses/:id/battles/session  session-scoped battle
    /api/live-sessions/:id/replay        recording playback
    /api/adaptive/training/stream/*      live device training

[SOCKET.IO]  (Redis adapter)
    session:<id>  chat:<id>  classroom:<id>  battle:<id>  user:<id>

[HEALTH]  /health  /ready
  `);

  // Best-effort: show the last DB migration run so deploys are verifiable
  // from the API's own boot log (never blocks startup).
  db.schema("edu")
    .from("migration_log")
    .select("run_group, applied, failed, git_sha, ran_at")
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(({ data }) => {
      if (!data) return console.log("[MIGRATIONS]  no runs recorded yet (run `npm run db:deploy`).");
      const sha = data.git_sha ? ` @ ${String(data.git_sha).slice(0, 7)}` : "";
      console.log(`[MIGRATIONS]  last run ${data.ran_at} -- ${data.run_group}, ${data.applied} applied${data.failed ? `, ${data.failed} failed` : ""}${sha}`);
    })
    .catch(() => { /* table may not exist yet — ignore */ });
});

// Start the background task worker (Anthropic agent loop) if enabled
if (process.env.ENABLE_TASK_WORKER !== "false") {
  import("./modules/tasks/worker.js")
    .then(() => console.log("[tasks] worker started"))
    .catch((e) => console.error("[tasks] worker failed to start:", e.message));
}

export { io };
export default app;
