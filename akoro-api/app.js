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
  requestLogger,
} from "./middleware/security.js";

import config                     from "./config/index.js";
import { SITE_BASE_DOMAINS }       from "./modules/school/tenant.js";
import db, { checkDb }           from "./db.js";

// ─── Module imports ───────────────────────────────────────────────────────────
import authModule, { authenticateSocket } from "./modules/auth/routes.js";
import coursesModule              from "./modules/courses/index.js";
import rankingModule              from "./modules/ranking/routes.js";
import profilesModule             from "./modules/profiles/routes.js";
import adaptiveModule, {
  setupAdaptiveWebSocket }        from "./modules/adaptive-learning/index.js";
import battleModule               from "./modules/battle/routes.js";
import tasksModule                from "./modules/tasks/routes.js";
import instructorModule           from "./modules/instructor/index.js";
import instructorToolsModule      from "./modules/instructor/tools.js";
import schoolModule               from "./modules/school/index.js";
import { studentFeedRouter,
         battleFeedRouter }       from "./modules/courses/student-feed.js";
import voiceModule               from "./modules/voice/routes.js";
import { setupVoiceStreaming }   from "./modules/voice/streaming.js";
import contentModule             from "./modules/content/routes.js";
import paystackWebhookRouter     from "./modules/webhooks/paystack.js";
import adminModule              from "./modules/admin/index.js";
import contactModule            from "./modules/contact/routes.js";
import passport                  from "passport";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const app        = express();
const httpServer = createServer(app);

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
const listedHosts = new Set(allowedOrigins === '*' ? [] : allowedOrigins.map(originHost).filter(Boolean).map(stripWww));
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

// ─── Socket.io + Redis adapter ────────────────────────────────────────────────
const redisPub = new Redis(config.redis.url);
const redisSub = redisPub.duplicate();
redisPub.on("error", (err) => console.error("[redis/pub]", err.message));
redisSub.on("error", (err) => console.error("[redis/sub]", err.message));

const io = new SocketServer(httpServer, {
  cors:       { origin: allowedOrigins === '*' ? '*' : corsOriginFn, credentials: true, methods: ["GET", "POST"] },
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
app.use(cors({
  origin: allowedOrigins === '*' ? '*' : corsOriginFn,
  credentials: true,
  methods:     ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","X-Akoro-Portal","X-Internal-Secret"],
}));
app.use(cookieParser());
// Paystack webhook signature validation needs the RAW request body. The raw
// parser must run BEFORE the global JSON parser (body-parser skips bodies
// already consumed by an earlier parser) — otherwise req.body arrives here as
// a parsed object, .toString() yields "[object Object]", and every webhook is
// rejected with "Invalid signature" (payments then never auto-grant agents).
app.use("/api/adaptive/marketplace/webhook", express.raw({ type: "application/json" }));
app.use("/api/webhooks/paystack",            express.raw({ type: "application/json" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(passport.initialize());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use((_req, res, next) => { res.setHeader("X-Instance-Id", config.instanceId); next(); });

// ─── Health & readiness ───────────────────────────────────────────────────────
let serverReady = false;
app.get("/health", async (_req, res) => {
  const [dbOk, redisOk] = await Promise.all([
    checkDb(),
    redisPub.ping().then((r) => r === "PONG").catch(() => false),
  ]);
  const healthy = dbOk && redisOk;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded", instance: config.instanceId,
    uptime: Math.round(process.uptime()), env: config.nodeEnv,
    checks: { database: dbOk ? "ok" : "error", redis: redisOk ? "ok" : "error" },
  });
});
app.get("/ready", (_req, res) =>
  res.status(serverReady ? 200 : 503).json({ ready: serverReady, instance: config.instanceId })
);

// ─── Module routes (with tiered rate limits) ─────────────────────────────────
//   strictLimit   — login/register (5 req/15 min, by IP)
//   refreshLimit  — token refresh  (30 req/15 min, by IP)
//   standardLimit — read APIs      (100 req/min, by user or IP)
//   teachingLimit — adaptive       (50 req/min, by user or IP)
//   aiLimit       — AI operations  (10 req/min, by user or IP)
// Unified Paystack webhook — verifies the signature once from the raw body and
// dispatches to every fulfillment domain (course/cart, agent/tool, payouts).
// This is the single URL configured in the Paystack dashboard.
app.use("/api/webhooks/paystack", paystackWebhookRouter);
app.use("/api/auth",     authModule);           // auth router applies strictLimit/refreshLimit internally
app.use("/api",          standardLimit, coursesModule);
app.use("/api/ranking",  standardLimit, rankingModule);
app.use("/api/profiles", standardLimit, profilesModule);
app.use("/api/adaptive", teachingLimit,  adaptiveModule);
app.use("/api/battle",   standardLimit, battleModule);
app.use("/api/battle",   standardLimit, battleFeedRouter);

// Eagerly start the BullMQ battle worker at boot (it was previously imported
// lazily on the first enqueue, so battles could stall until some action kicked
// it). Guarded by REDIS_URL so environments without Redis stay quiet.
if (process.env.REDIS_URL) {
  import("./modules/battle/worker.js")
    .then(() => console.log("[battle] worker started at boot"))
    .catch((e) => console.error("[battle] worker failed to start:", e.message));
}
app.use("/api/student",  standardLimit, studentFeedRouter);
app.use("/api/tasks",      aiLimit,       tasksModule);
app.use("/api/instructor/tools", standardLimit, instructorToolsModule);  // platform tools/assets catalog + purchase
app.use("/api/instructor", standardLimit, instructorModule);
app.use("/api/school",     standardLimit, schoolModule);        // school partner portal
app.use("/api/voice",      aiLimit,       voiceModule);
app.use("/api/content",    standardLimit, contentModule);   // public blog + careers, admin CRUD
app.use("/api/admin",      standardLimit, adminModule);     // admin-only: users, instructors, courses, stats
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
httpServer.listen(config.server.port, config.server.host, () => {
  serverReady = true;
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
