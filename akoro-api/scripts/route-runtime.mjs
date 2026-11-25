/**
 * scripts/route-runtime.mjs — import the real app without booting it.
 *
 * app.js has an opt-in AKORO_ROUTE_EXPORT=1 guard that skips Redis/Socket.io,
 * migrations, workers, preflight and httpServer.listen. The placeholder
 * Supabase values only satisfy lib/bootChecks.js; db.js is lazy and never
 * connects. No .env file is read (DOTENV_CONFIG_PATH=/dev/null), and
 * REDIS_URL is removed so import-time BullMQ clients stay idle.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const APP_PATH = fileURLToPath(new URL("../app.js", import.meta.url));
const API_ROOT = fileURLToPath(new URL("..", import.meta.url));

export async function loadRuntimeRouteTable() {
  process.env.AKORO_ROUTE_EXPORT = "1";
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.DOTENV_CONFIG_PATH = "/dev/null";
  process.env.AKORO_BACKGROUND_JOBS_ENABLED = "false";
  process.env.VOUCHER_WEBHOOKS = "off";
  process.env.AKORO_DB_VIEWS = "false";
  // Some modules create Redis clients or run a best-effort ensure-table at
  // import time. Point both at a closed local port so this process cannot reach
  // (or mutate) a real Redis/Postgres; the extraction itself needs neither.
  process.env.REDIS_URL = "redis://127.0.0.1:1";
  process.env.DATABASE_URL = "postgres://route-export:route-export@127.0.0.1:1/route_export";
  process.env.MIGRATION_DATABASE_URL = process.env.DATABASE_URL;
  process.env.DB_READ_URL = process.env.DATABASE_URL;
  if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = "https://route-export.invalid";
  if (!process.env.SUPABASE_SERVICE_KEY) process.env.SUPABASE_SERVICE_KEY = "route-export-placeholder";
  // Several SDK clients are constructed at import time and throw when their
  // key is absent. They never make a request here; the placeholders only let
  // the modules load. Real keys are left untouched.
  const placeholders = {
    OPENAI_API_KEY: "route-export-placeholder",
    ANTHROPIC_API_KEY: "route-export-placeholder",
    DEEPGRAM_API_KEY: "route-export-placeholder",
    GROQ_API_KEY: "route-export-placeholder",
    GEMINI_API_KEY: "route-export-placeholder",
    GOOGLE_API_KEY: "route-export-placeholder",
    REPLICATE_API_TOKEN: "route-export-placeholder",
    HUGGINGFACE_API_KEY: "route-export-placeholder",
    HF_TOKEN: "route-export-placeholder",
    RESEND_API_KEY: "route-export-placeholder",
    PAYSTACK_SECRET_KEY: "route-export-placeholder",
    TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
    TWILIO_AUTH_TOKEN: "00000000000000000000000000000000",
  };
  for (const [name, value] of Object.entries(placeholders)) {
    if (!process.env[name]) process.env[name] = value;
  }

  const appSource = await readFile(APP_PATH, "utf8");
  // Import-time BullMQ/ioredis clients fall back to localhost when REDIS_URL is
  // absent, and one chat module runs a best-effort ensure-table at import. Both
  // are harmless here (no route or job runs) but their retry noise would drown
  // the CI log. Drop only those exact messages for this short process.
  const isNetworkNoise = (text) => {
    if (text.includes("ECONNREFUSED") && /6379|127\.0\.0\.1:1|port: 1|redis|Redis/.test(text)) return true;
    return /\[(?:Chat|Redis|tasks\/scheduler Redis)\]\s*(?:Migration error|Connection error)?\s*:?\s*$/.test(text.trim());
  };
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const text = args.map((value) => value?.stack || value?.message || String(value)).join(" ");
    if (isNetworkNoise(text)) return;
    originalConsoleError(...args);
  };
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    const text = typeof chunk === "string"
      ? chunk
      : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (isNetworkNoise(text)) return true;
    return originalStderrWrite(chunk, ...rest);
  };
  const { default: app } = await import(APP_PATH);
  const { extractRoutes } = await import(new URL("../lib/routeCatalog.js", import.meta.url));
  const routes = extractRoutes(app, { appSource });
  return { routes, appSource, apiRoot: API_ROOT };
}
