/**
 * config/index.js  —  Piabam Centralised Configuration
 *
 * Single source of truth for all environment-based settings.
 * Designed for horizontal scalability — every instance is stateless
 * and identified by a unique instanceId.
 *
 * Usage:
 *   import config from "../config/index.js";
 *   console.log(config.instanceId);
 *   console.log(config.db.poolMax);
 */

import crypto from "crypto";

const env     = process.env;
const isProd  = env.NODE_ENV === "production";
const isDev   = !isProd;

const config = {

  // ── Instance identity ───────────────────────────────────────────────────
  // Each server instance gets a unique ID — useful for debugging across
  // multiple Railway replicas or Docker containers.
  instanceId: env.INSTANCE_ID ?? crypto.randomUUID(),
  nodeEnv:    env.NODE_ENV ?? "development",
  isProd,
  isDev,

  // ── Server ──────────────────────────────────────────────────────────────
  server: {
    port:            parseInt(env.PORT            ?? "4000", 10),
    host:            env.HOST                     ?? "0.0.0.0",
    corsOrigin:      env.CORS_ORIGIN              ?? "*",
    // How long (ms) to wait for in-flight requests to finish on SIGTERM
    shutdownTimeout: parseInt(env.SHUTDOWN_TIMEOUT ?? "30000", 10),
  },

  // ── Supabase ─────────────────────────────────────────────────────────────
  supabase: {
    url:        env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_KEY,
    // Private Storage bucket holding Library record files when R2 isn't
    // configured (created on first use; ≤ 5 MB per file).
    recordsBucket: env.SUPABASE_RECORDS_BUCKET ?? "akoro-records",
  },

  // ── Database connection pool ─────────────────────────────────────────────
  // Doctrine: keep the per-instance pool SURPRISINGLY SMALL and let the
  // external connection proxy (Supabase Supavisor) absorb traffic spikes.
  // A pool larger than the database can serve just moves the queue into
  // Postgres, where every idle connection costs RAM and every competing
  // connection costs context switches. Node's pg defaults (max 10, no
  // connection timeout) are exactly the failure mode to avoid.
  //
  // Budget: poolMax × instances + 1 boot-time migration client ≤ the
  // project's connection limit. Default 5 leaves headroom on the smallest
  // Supabase compute even with a few instances. Point DATABASE_URL at the
  // Supavisor transaction pooler (port 6543) — this codebase only issues
  // stateless pool.query() calls, no session state, so transaction pooling
  // is safe. DDL/migrations bypass the pool (single pg.Client via
  // MIGRATION_DATABASE_URL, session/direct, port 5432).
  db: {
    poolMax:      parseInt(env.DB_POOL_MAX      ?? "5",   10),
    poolMin:      parseInt(env.DB_POOL_MIN      ?? "1",   10),
    poolIdleMs:   parseInt(env.DB_POOL_IDLE_MS  ?? "10000", 10),
    // Fail fast when the pool is exhausted instead of queueing forever —
    // the honest error a caller can retry, rather than a hung request.
    poolConnectMs: parseInt(env.DB_POOL_CONNECT_MS ?? "5000", 10),
    // Read replica URL — falls back to primary if not set
    // Point this to a Supabase read replica when you add one
    readUrl:      env.DB_READ_URL ?? env.SUPABASE_URL,
  },

  // ── Redis ────────────────────────────────────────────────────────────────
  redis: {
    url:             env.REDIS_URL              ?? "redis://localhost:6379",
    // Socket.io adapter channels
    pubSubPrefix:    env.REDIS_PUBSUB_PREFIX    ?? "akoro",
    // Presence TTL (seconds)
    presenceTtl:     parseInt(env.REDIS_PRESENCE_TTL ?? "86400", 10),
  },

  // ── Auth / JWT ───────────────────────────────────────────────────────────
  auth: {
    // No default: a missing key stops sign-in (and boot, in production) rather than
    // signing with a value that is in the repository.
    jwtSecret:    env.JWT_SECRET || null,
    jwtRsa:       (env.JWT_PRIVATE_KEY || "").includes("-----BEGIN") && (env.JWT_PUBLIC_KEY || "").includes("-----BEGIN"),
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? "7d",
    bcryptRounds: parseInt(env.BCRYPT_ROUNDS ?? "10", 10),
  },

  // ── Cloudflare R2 ────────────────────────────────────────────────────────
  r2: {
    accountId:       env.R2_ACCOUNT_ID,
    accessKeyId:     env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucketName:      env.R2_BUCKET_NAME,
    publicUrl:       env.R2_PUBLIC_URL,
    enabled:         !!(env.R2_ACCESS_KEY_ID && env.R2_BUCKET_NAME),
  },

  // ── Meeting platforms ────────────────────────────────────────────────────
  zoom: {
    clientId:     env.ZOOM_CLIENT_ID,
    clientSecret: env.ZOOM_CLIENT_SECRET,
    redirectUri:  env.REDIRECT_URI_ZOOM,
  },
  google: {
    clientId:     env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri:  env.REDIRECT_URI_GOOGLE,
  },
  teams: {
    clientId:     env.TEAMS_CLIENT_ID,
    clientSecret: env.TEAMS_CLIENT_SECRET,
    redirectUri:  env.REDIRECT_URI_TEAMS,
  },

  // ── Notifications ────────────────────────────────────────────────────────
  smtp: {
    host:      env.SMTP_HOST,
    port:      parseInt(env.SMTP_PORT ?? "587", 10),
    user:      env.SMTP_USER,
    pass:      env.SMTP_PASS,
    fromEmail: env.SMTP_FROM_EMAIL ?? "noreply@akoro.app",
  },
  twilio: {
    accountSid:   env.TWILIO_ACCOUNT_SID,
    authToken:    env.TWILIO_AUTH_TOKEN,
    phoneNumber:  env.TWILIO_PHONE_NUMBER,
    countryCode:  env.DEFAULT_COUNTRY_CODE ?? "234",
  },
  vapid: {
    publicKey:  env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    email:      env.VAPID_EMAIL ?? "admin@akoro.app",
  },

  // ── Payments ─────────────────────────────────────────────────────────────
  paystack: {
    secretKey: env.PAYSTACK_SECRET_KEY,
    publicKey: env.PAYSTACK_PUBLIC_KEY,
    appUrl:    env.APP_URL ?? "https://api.akoro.app",
  },

  // ── AI / Anthropic ───────────────────────────────────────────────────────
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
  },

  // ── Worker / encoding ────────────────────────────────────────────────────
  worker: {
    concurrency:    parseInt(env.WORKER_CONCURRENCY ?? "1", 10),
    ffmpegPath:     env.FFMPEG_PATH  ?? "ffmpeg",
    ffprobePath:    env.FFPROBE_PATH ?? "ffprobe",
    tempDir:        env.TEMP_DIR     ?? "./temp",
    internalSecret: env.INTERNAL_SECRET ?? "",
    apiBaseUrl:     env.API_BASE_URL    ?? "http://localhost:4000",
  },
};

// ── Startup validation ───────────────────────────────────────────────────────
// Warn loudly in production if critical env vars are missing
if (isProd) {
  const required = [
    ["SUPABASE_URL",        config.supabase.url],
    ["SUPABASE_SERVICE_KEY",config.supabase.serviceKey],
    ["JWT_PRIVATE_KEY+JWT_PUBLIC_KEY or JWT_SECRET", config.auth.jwtRsa || config.auth.jwtSecret ? "ok" : null],
    ["REDIS_URL",           config.redis.url !== "redis://localhost:6379" ? "ok" : null],
  ];

  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`❌  Missing required env vars in production: ${missing.join(", ")}`);
    process.exit(1);
  }
}

console.log(`[config] ✅ Instance ${config.instanceId.slice(0, 8)} | env=${config.nodeEnv} | port=${config.server.port}`);

export default config;

// ── Platform business rules ──────────────────────────────────────────────────
// Pulled from env so finance team can adjust without a code deploy
export const businessConfig = {
  // Percentage the platform keeps from every course sale (0-100)
  commissionPercent:  parseFloat(env.PLATFORM_COMMISSION_PERCENT ?? "20"),
  // Minimum balance (kobo) before an instructor can request payout
  payoutMinimumKobo:  parseInt(env.PAYOUT_MINIMUM_KOBO ?? "500000", 10),
};
