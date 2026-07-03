#!/usr/bin/env node
/**
 * apply-migrations.mjs
 * ─────────────────────────────────────────────────────────────
 * Runs the ordered SQL migrations in migrations/manifest.json against
 * DATABASE_URL. Every schema file is idempotent (IF NOT EXISTS / DO $$ /
 * ON CONFLICT), so this is safe to run on every deploy.
 *
 * Usage (from akoro-api/):
 *   DATABASE_URL=postgres://…:6543/postgres node scripts/apply-migrations.mjs
 *   node scripts/apply-migrations.mjs --group=schema     (default; every deploy)
 *   node scripts/apply-migrations.mjs --group=demo       (sample data — never prod)
 *   node scripts/apply-migrations.mjs --group=all
 *   node scripts/apply-migrations.mjs --continue-on-error
 *
 * Notes:
 *   • Use the DIRECT Postgres URI, not the Supabase REST URL. In Supabase:
 *     Project Settings → Database → Connection string (URI). The Transaction
 *     Pooler URL (port 6543) works well for one-off deploy jobs.
 *   • This does NOT run on API boot (npm start) — wire it as the hosting
 *     platform's pre-deploy / release command so it runs once per deploy.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dns from "node:dns";
import pg from "pg";

// Supabase hostnames often resolve to IPv6, which some container hosts
// (e.g. Railway) can't reach — force IPv4 like the rest of the pipeline.
dns.setDefaultResultOrder("ipv4first");

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

const args = process.argv.slice(2);
// Group precedence: --group=… flag → DB_DEPLOY_GROUPS env → 'schema'.
// (DB_DEPLOY_GROUPS=schema on a service opts it out of demo seeds even when
// the npm script asks for 'all'.)
const flagGroup = args.find((a) => a.startsWith("--group="))?.split("=")[1];
const groupArg = process.env.DB_DEPLOY_GROUPS || flagGroup || "schema";
const continueOnError = args.includes("--continue-on-error");

// Prefer a migration-specific URL if set — lets you point migrations at the
// SESSION pooler (port 5432, best for one-off DDL jobs) while the app keeps
// using the TRANSACTION pooler (6543) via DATABASE_URL. Falls back to DATABASE_URL.
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!url) {
  console.error("ERROR: set DATABASE_URL (or MIGRATION_DATABASE_URL) to your Postgres connection string.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(migrationsDir, "manifest.json"), "utf8"));
const groups = groupArg === "all" ? ["schema", "demo"] : [groupArg];
const files = [];
for (const g of groups) {
  if (!Array.isArray(manifest[g])) {
    console.error(`ERROR: unknown migration group "${g}". Valid: schema, demo, all.`);
    process.exit(1);
  }
  files.push(...manifest[g]);
}

const client = new pg.Client({
  connectionString: url,
  family: 4,
  ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
});

let applied = 0;
let failed = 0;

try {
  await client.connect();
  console.log(`Connected. Applying ${files.length} migration(s) [${groups.join(", ")}]...\n`);

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    process.stdout.write(`  - ${file} ... `);
    try {
      await client.query(sql);
      applied++;
      console.log("ok");
    } catch (err) {
      failed++;
      console.log("FAILED");
      console.error(`        ${err.message}`);
      if (!continueOnError) {
        throw new Error(`Migration halted at ${file}. Fix it and re-run (migrations are idempotent).`);
      }
    }
  }

  // Durable record in edu.migration_log (best-effort — a logging failure must
  // never fail the deploy). Reads git SHA from Railway/Render/Vercel env vars.
  try {
    const gitSha =
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.RENDER_GIT_COMMIT ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.GIT_SHA ||
      null;
    await client.query(
      `INSERT INTO edu.migration_log (run_group, applied, failed, files, git_sha)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [groups.join(","), applied, failed, JSON.stringify(files), gitSha]
    );
    console.log("[LOG] Written to edu.migration_log.");
  } catch (logErr) {
    console.warn(`[WARN] Could not write edu.migration_log: ${logErr.message}`);
  }

  console.log(`\n[DONE] ${applied} applied${failed ? `, ${failed} failed` : ""}.`);
  if (failed) process.exitCode = 1;
} catch (err) {
  console.error(`\n[ERROR] ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
