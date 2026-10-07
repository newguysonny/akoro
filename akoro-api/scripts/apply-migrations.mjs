#!/usr/bin/env node
/**
 * apply-migrations.mjs — thin CLI over lib/migrations.js (the same engine
 * the API runs at boot). Kept for one-off runs from a laptop, a Render shell,
 * or CI:
 *
 * Usage (from akoro-api/):
 *   DATABASE_URL=postgres://…:6543/postgres node scripts/apply-migrations.mjs
 *   MIGRATION_DATABASE_URL=postgres://…:5432/postgres node scripts/apply-migrations.mjs
 *   node scripts/apply-migrations.mjs --group=schema     (default)
 *   node scripts/apply-migrations.mjs --group=demo       (sample data — never prod)
 *   node scripts/apply-migrations.mjs --group=all
 *   node scripts/apply-migrations.mjs --continue-on-error
 *
 * Notes:
 *   • Use the DIRECT Postgres URI, not the Supabase REST URL. In Supabase:
 *     Project Settings → Database → Connection string (URI). The Transaction
 *     Pooler URL (port 6543) works well for one-off jobs; the SESSION pooler
 *     (5432) is best for DDL.
 *   • Since lib/migrations.js is also wired at API boot, deploys self-migrate
 *     on any host — this script is for running it by hand.
 */

const args = process.argv.slice(2);
// Group precedence: --group=… flag → DB_DEPLOY_GROUPS env → 'schema'.
// (DB_DEPLOY_GROUPS=schema on a service opts it out of demo seeds even when
// the npm script asks for 'all'.)
const flagGroup = args.find((a) => a.startsWith("--group="))?.split("=")[1];
const groupArg = process.env.DB_DEPLOY_GROUPS || flagGroup || "schema";
const continueOnError = args.includes("--continue-on-error");

const { applyMigrations, migrationUrl } = await import("../lib/migrations.js");

const url = migrationUrl();
if (!url) {
  console.error("ERROR: set DATABASE_URL (or MIGRATION_DATABASE_URL) to your Postgres connection string.");
  process.exit(1);
}

const groups = groupArg === "all" ? ["schema", "demo"] : [groupArg];

try {
  const { applied, failed } = await applyMigrations({ url, groups, continueOnError, label: "cli" });
  if (failed) process.exitCode = 1;
  void applied;
} catch (err) {
  console.error(`\n[ERROR] ${err.message}`);
  process.exitCode = 1;
}
