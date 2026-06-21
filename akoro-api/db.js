/**
 * db.js  —  Akoro Supabase Postgres client
 *
 * Exports:
 *   db        primary client (write + read)
 *   readDb    read-replica client (falls back to primary if DB_READ_URL not set)
 *   checkDb() health check for /health endpoint
 */

import { createClient } from "@supabase/supabase-js";
import config           from "./config/index.js";

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  db:   { schema: "public" },
  global: { headers: { "x-akoro-instance": config.instanceId } },
};

if (!config.supabase.url || !config.supabase.serviceKey) {
  console.error("❌  SUPABASE_URL or SUPABASE_SERVICE_KEY missing from .env");
  process.exit(1);
}

const db = createClient(config.supabase.url, config.supabase.serviceKey, clientOptions);

export const readDb = config.db.readUrl && config.db.readUrl !== config.supabase.url
  ? createClient(config.db.readUrl, config.supabase.serviceKey, {
      ...clientOptions,
      global: { headers: { "x-akoro-instance": `${config.instanceId}-read` } },
    })
  : db;

export const checkDb = async () => {
  try {
    const { error } = await db.from("users").select("id").limit(1);
    return !error;
  } catch { return false; }
};

// ─── Content schema client ──────────────────────────────────────────────────
// Marketing / public-site content (blog, careers) lives in its own `content`
// schema, isolated from the core app tables in `public`.
// Requires `content` to be in the project's exposed schemas (see
// migrations/2026-content-schema.sql header).
export const contentDb = db.schema("content");

export default db;
