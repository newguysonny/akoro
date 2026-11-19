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
import { countQuery }   from "./lib/usageMeter.js";

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  db:   { schema: "public" },
  global: { headers: { "x-akoro-instance": config.instanceId } },
};

function requireSupabase() {
  if (!config.supabase.url || !config.supabase.serviceKey) {
    console.error("❌  SUPABASE_URL or SUPABASE_SERVICE_KEY missing from .env");
    process.exit(1);
  }
}

// Lazy: importing this module (directly or through a barrel) must not exit the
// process just because a test env has no Supabase credentials. The server still
// fails fast — app.js asserts the config at boot.
function lazyClient(build) {
  let client = null;
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];   // a test fake replaced it
      if (!client) client = build();
      const value = client[prop];
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
}

// Meter every PostgREST entry point (from/rpc/schema) so the platform's
// per-command quota is observable per route. Builders execute once, so
// builder creation ≈ command count.
function metered(client) {
  const wrapSchema = (schemaBuilder) => {
    const from = schemaBuilder.from.bind(schemaBuilder);
    const rpc = schemaBuilder.rpc.bind(schemaBuilder);
    schemaBuilder.from = (...a) => { countQuery(); return from(...a); };
    schemaBuilder.rpc  = (...a) => { countQuery(); return rpc(...a); };
    return schemaBuilder;
  };
  const from = client.from.bind(client);
  const rpc = client.rpc.bind(client);
  const schema = client.schema.bind(client);
  client.from    = (...a) => { countQuery(); return from(...a); };
  client.rpc     = (...a) => { countQuery(); return rpc(...a); };
  client.schema  = (...a) => wrapSchema(schema(...a));
  return client;
}

const primary = lazyClient(() => {
  requireSupabase();
  return metered(createClient(config.supabase.url, config.supabase.serviceKey, clientOptions));
});
const db = primary;

export const readDb = config.db.readUrl && config.db.readUrl !== config.supabase.url
  ? lazyClient(() => {
      requireSupabase();
      return metered(createClient(config.db.readUrl, config.supabase.serviceKey, {
        ...clientOptions,
        global: { headers: { "x-akoro-instance": `${config.instanceId}-read` } },
      }));
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
export const contentDb = lazyClient(() => db.schema("content"));

export default db;
