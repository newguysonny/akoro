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
const groupArg = (args.find((a) => a.startsWith("--group=")) || "--group=schema").split("=")[1];
const continueOnError = args.includes("--continue-on-error");

const url = process.env.DATABASE_URL || process.env.DB_URL;
if (!url) {
  console.error("ERROR: set DATABASE_URL to your direct Postgres connection string.");
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
  console.log(`→ Connected. Applying ${files.length} migration(s) [${groups.join(", ")}]…\n`);

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    process.stdout.write(`  • ${file} … `);
    try {
      await client.query(sql);
      applied++;
      console.log("ok");
    } catch (err) {
      failed++;
      console.log("FAILED");
      console.error(`      ↳ ${err.message}`);
      if (!continueOnError) {
        throw new Error(`Migration halted at ${file}. Fix it and re-run (migrations are idempotent).`);
      }
    }
  }

  console.log(`\n✅ Done. ${applied} applied${failed ? `, ${failed} failed` : ""}.`);
  if (failed) process.exitCode = 1;
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
