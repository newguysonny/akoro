/**
 * lib/migrations.js — the migration engine, host-independent.
 *
 * History: this logic lived only in scripts/apply-migrations.mjs and was
 * wired as Railway's release command. On Render, the equivalent
 * (preDeployCommand) requires a paid instance — free tiers skip it, so
 * schema updates silently lagged (last run stamped Aug 11 while deploys
 * continued). The backend now applies migrations itself at boot (see
 * app.js), so deploys self-migrate on ANY host.
 *
 * Safety properties (inherited from the script):
 *   • every schema file is idempotent (IF NOT EXISTS / DO $$ / ON CONFLICT)
 *   • a session-level advisory lock serializes concurrent boots/replicas
 *   • the run is recorded in edu.migration_log with the deploy SHA
 *   • boot skips the whole run when the last record matches this deploy's
 *     SHA and had no failures — a plain restart costs one SELECT.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dns from "node:dns";
import pg from "pg";

// Supabase hostnames often resolve to IPv6, which some container hosts
// can't reach — force IPv4 like the rest of the pipeline.
dns.setDefaultResultOrder("ipv4first");

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

/** Deploy SHA from whichever host env is present (Railway/Render/Vercel/manual). */
export function currentGitSha() {
  return process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_SHA ||
    null;
}

/** MIGRATION_DATABASE_URL (direct/session pooler preferred) → DATABASE_URL → DB_URL. */
export function migrationUrl() {
  return process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL || null;
}

function manifestFiles(groups) {
  const manifest = JSON.parse(readFileSync(join(migrationsDir, "manifest.json"), "utf8"));
  const files = [];
  for (const g of groups) {
    if (!Array.isArray(manifest[g])) throw new Error(`unknown migration group "${g}". Valid: schema, demo, all.`);
    files.push(...manifest[g]);
  }
  return files;
}

/**
 * True when the newest migration_log row matches this deploy's SHA and had
 * no failures — the "already applied here" signal. Unknown SHA / no table /
 * any error → false (run; the SQL is idempotent anyway).
 */
export async function migrationsAlreadyApplied(url, sha) {
  if (!sha) return false;
  const client = new pg.Client({ connectionString: url, family: 4, ssl: url.includes("localhost") ? false : { rejectUnauthorized: false } });
  try {
    await client.connect();
    const { rows } = await client.query(
      "SELECT git_sha, failed FROM edu.migration_log ORDER BY ran_at DESC LIMIT 1",
    );
    const last = rows?.[0];
    return Boolean(last && last.failed === 0 && last.git_sha && last.git_sha === sha);
  } catch {
    return false; // no table yet, no rows, or DB unreachable → run to be safe
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Schemas the app reaches through the Data API (supabase-js, service_role).
 * Kept as one allowlist so the grant pass below can never be pointed at an
 * unexpected schema, and so adding a schema to the platform means adding it
 * here once.
 */
export const DATA_API_SCHEMAS = ["public", "edu", "mgmt", "vouchers", "content"];

/**
 * The grant statements that assert service_role Data API access for a set of
 * schemas: schema USAGE, every table, every sequence (INSERTs need sequence
 * access), and default privileges so tables created by LATER migrations
 * inherit the grant even when their file forgets it. Pure — the security
 * contract ("service_role only, never anon/authenticated") is test-covered.
 */
export function dataApiGrantStatements(schemas) {
  const out = [];
  for (const s of schemas) {
    // Schemas come from the allowlist ∩ pg_namespace, but be defensive
    // anyway: only plain identifiers are ever emitted, anything else is
    // skipped — never interpolated, quoted or not.
    if (!/^[a-z_][a-z0-9_]*$/i.test(String(s))) continue;
    const q = `"${s}"`;
    out.push(`GRANT USAGE ON SCHEMA ${q} TO service_role`);
    out.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${q} TO service_role`);
    out.push(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${q} TO service_role`);
    out.push(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${q} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role`);
    out.push(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${q} GRANT USAGE, SELECT ON SEQUENCES TO service_role`);
  }
  return out;
}

/**
 * Apply the manifest groups. Never throws for per-file SQL failures unless
 * continueOnError is false (default) — matching the original script: the run
 * halts at the first failing file and reports. Returns { applied, failed }.
 */
export async function applyMigrations({ url, groups = ["schema"], continueOnError = false, label = "boot" } = {}) {
  if (!url) throw new Error("A Postgres connection string is required (MIGRATION_DATABASE_URL or DATABASE_URL)");
  const files = manifestFiles(groups);
  const client = new pg.Client({ connectionString: url, family: 4, ssl: url.includes("localhost") ? false : { rejectUnauthorized: false } });

  let applied = 0, failed = 0;
  try {
    await client.connect();
    // Serialize concurrent boots/replicas — two instances must never race DDL.
    await client.query("SELECT pg_advisory_lock(727274)");
    console.log(`[MIGRATIONS:${label}] applying ${files.length} file(s) [${groups.join(",")}]…`);
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      try {
        await client.query(sql);
        applied++;
      } catch (err) {
        failed++;
        console.error(`[MIGRATIONS:${label}] FAILED ${file}: ${err.message}`);
        if (!continueOnError) throw new Error(`Migration halted at ${file}. Fix it and re-run (migrations are idempotent).`);
      }
    }
    // ── Data API grants (Supabase change, 2026-10-30) ────────────────────────
    // Supabase stops auto-granting Data API access to NEW tables in public.
    // Existing tables keep their grants, and this app reaches the database
    // ONLY as service_role (no frontend talks to Supabase directly) — so the
    // exposure is a future migration forgetting a grant. Make the invariant
    // structural instead: every run re-asserts service_role access on every
    // schema the app uses, and default privileges mean a table created by a
    // later migration inherits the grant even if its file forgets it.
    // Deliberately ONLY service_role: granting anon/authenticated would expose
    // the Data API to any client holding the project's public anon key.
    // Best-effort by design (like the log write below): idempotent, re-run on
    // every deploy, loud on failure — a blocked deploy over a grant helps
    // nobody, and the next run self-heals.
    try {
      const { rows: roleRows } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'service_role'");
      if (roleRows.length) {
        const { rows: nsRows } = await client.query(
          "SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[])",
          [DATA_API_SCHEMAS],
        );
        const schemas = nsRows.map((r) => r.nspname);
        for (const stmt of dataApiGrantStatements(schemas)) await client.query(stmt);
        if (schemas.length) {
          console.log(`[MIGRATIONS:${label}] Data API grants asserted (service_role) on: ${schemas.join(", ")}`);
        }
      } else {
        console.log(`[MIGRATIONS:${label}] service_role absent (local Postgres?) — Data API grants skipped`);
      }
    } catch (grantErr) {
      console.error(`[MIGRATIONS:${label}] DATA API GRANT FAILED — if new tables report "permission denied" through the API, run the grants manually: ${grantErr.message}`);
    }
    // Durable record (best-effort — a logging failure never fails the run).
    try {
      await client.query(
        `INSERT INTO edu.migration_log (run_group, applied, failed, files, git_sha)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [groups.join(","), applied, failed, JSON.stringify(files), currentGitSha()],
      );
    } catch (logErr) {
      console.warn(`[MIGRATIONS:${label}] could not write edu.migration_log: ${logErr.message}`);
    }
    console.log(`[MIGRATIONS:${label}] done: ${applied} applied${failed ? `, ${failed} failed` : ""}.`);
  } finally {
    await client.end().catch(() => {});
  }
  return { applied, failed };
}
