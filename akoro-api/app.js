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
import { checkDb }                from "./db.js";

// ─── Module imports ───────────────────────────────────────────────────────────
import authModule                 from "./modules/auth/routes.js";
import coursesModule              from "./modules/courses/index.js";
import rankingModule              from "./modules/ranking/routes.js";
import profilesModule             from "./modules/profiles/routes.js";
import adaptiveModule, {
  setupAdaptiveWebSocket }        from "./modules/adaptive-learning/index.js";
import battleModule               from "./modules/battle/routes.js";
import tasksModule                from "./modules/tasks/routes.js";
import instructorModule           from "./modules/instructor/index.js";
import instructorToolsModule      from "./modules/instructor/tools.js";
import { studentFeedRouter,
         battleFeedRouter }       from "./modules/courses/student-feed.js";
import voiceModule               from "./modules/voice/routes.js";
import { setupVoiceStreaming }   from "./modules/voice/streaming.js";
import contentModule             from "./modules/content/routes.js";
import adminModule              from "./modules/admin/index.js";
import passport                  from "passport";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const app        = express();
const httpServer = createServer(app);

// ─── CORS origins ─────────────────────────────────────────────────────────────
// Support comma-separated list: CORS_ORIGIN=https://akoro.app,https://instructor.akoro.app
const allowedOrigins = config.server.corsOrigin === '*'
  ? '*'
  : config.server.corsOrigin.split(',').map(s => s.trim()).filter(Boolean);

// ─── Socket.io + Redis adapter ────────────────────────────────────────────────
const redisPub = new Redis(config.redis.url);
const redisSub = redisPub.duplicate();
redisPub.on("error", (err) => console.error("[redis/pub]", err.message));
redisSub.on("error", (err) => console.error("[redis/sub]", err.message));

const io = new SocketServer(httpServer, {
  cors:       { origin: allowedOrigins, credentials: true, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
});
io.adapter(createAdapter(redisPub, redisSub));
app.set("io", io);
global.io = io;   // battle worker uses global.io

io.on("connection", (socket) => {
  socket.on("join-session",            (id) => socket.join(`session:${id}`));
  socket.on("leave-session",           (id) => socket.leave(`session:${id}`));
  socket.on("join-chat",               (id) => socket.join(`chat:${id}`));
  socket.on("leave-chat",              (id) => socket.leave(`chat:${id}`));
  socket.on("join-classroom",          (id) => socket.join(`classroom:${id}`));
  socket.on("join-battle",             (id) => socket.join(`battle:${id}`));
  socket.on("leave-battle",            (id) => socket.leave(`battle:${id}`));
  socket.on("subscribe-notifications", (id) => socket.join(`user:${id}`));
  socket.on("subscribe-student",       (id) => socket.join(`user:${id}`));
  // Joins student:{id} room for decay alerts from decayEngine cron
  socket.on("join-student-room",       (id) => socket.join(`student:${id}`));
  socket.on("join-instructor",         (id) => socket.join(`instructor:${id}`));
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
  origin: allowedOrigins === '*'
    ? '*'
    : (origin, cb) => {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`CORS: origin ${origin} not allowed`));
      },
  credentials: true,
  methods:     ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
}));
app.use(cookieParser());
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
app.use("/api/auth",     authModule);           // auth router applies strictLimit/refreshLimit internally
app.use("/api",          standardLimit, coursesModule);
app.use("/api/ranking",  standardLimit, rankingModule);
app.use("/api/profiles", standardLimit, profilesModule);
app.use("/api/adaptive", teachingLimit,  adaptiveModule);
app.use("/api/battle",   standardLimit, battleModule);
app.use("/api/battle",   standardLimit, battleFeedRouter);
app.use("/api/student",  standardLimit, studentFeedRouter);
app.use("/api/tasks",      aiLimit,       tasksModule);
app.use("/api/instructor/tools", standardLimit, instructorToolsModule);  // platform tools/assets catalog + purchase
app.use("/api/instructor", standardLimit, instructorModule);
app.use("/api/voice",      aiLimit,       voiceModule);
app.use("/api/content",    standardLimit, contentModule);   // public blog + careers, admin CRUD
app.use("/api/admin",      standardLimit, adminModule);     // admin-only: users, instructors, courses, stats

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, message: "Route not found" }));

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof MulterError)
    return res.status(400).json({ success: false, message: `Upload error: ${err.message}`, code: err.code });
  console.error(`[${config.instanceId.slice(0, 8)}] ❌`, err.message);
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
🚀  Akoro API  [${config.instanceId.slice(0, 8)}]  —  http://localhost:${config.server.port}

📦  Modules
    /api/auth/*           Auth
    /api/courses/*        Courses + Cart + Payments + Live Sessions
    /api/ranking/*        XP Leaderboards
    /api/profiles/*       Teachers / Classrooms / Schools
    /api/adaptive/*       AI Teaching Agents (NaNa, Professor, Trained)
    /api/battle/*         1v1 / Open / Classroom / Session Battles
    /api/tasks/*          Teacher AI Task Agent

📝  New endpoints
    /api/profiles/instructor/students    global student list
    /api/profiles/teacher/invite         magic invite link
    /api/profiles/teacher/students/import CSV bulk import
    /api/profiles/students/:id           edit + message student
    /api/battle/instructor/stats         battle dashboard stats
    /api/battle/battles/:id   PUT        edit battle
    /api/battle/courses/:id/battles/session  session-scoped battle
    /api/live-sessions/:id/replay        recording playback
    /api/adaptive/training/stream/*      live device training

🔌  Socket.io (Redis adapter)
    session:<id>  chat:<id>  classroom:<id>  battle:<id>  user:<id>

📊  /health  /ready
  `);
});

// Start the background task worker (Anthropic agent loop) if enabled
if (process.env.ENABLE_TASK_WORKER !== "false") {
  import("./modules/tasks/worker.js")
    .then(() => console.log("[tasks] worker started"))
    .catch((e) => console.error("[tasks] worker failed to start:", e.message));
}

export { io };
export default app;
