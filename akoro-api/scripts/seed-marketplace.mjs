#!/usr/bin/env node
/**
 * seed-marketplace.mjs
 * ─────────────────────────────────────────────────────────────
 * Applies database-seed-marketplace.sql to your Postgres/Supabase DB.
 *
 * Usage (from akoro-api/):
 *   DATABASE_URL=postgres://user:pass@host:5432/db node scripts/seed-marketplace.mjs
 *
 * Notes:
 *   • Use the direct Postgres connection string (not the REST URL).
 *     In Supabase: Project Settings → Database → Connection string (URI).
 *   • The SQL is idempotent (fixed UUIDs + ON CONFLICT), so re-running
 *     is safe.
 *   • If you'd rather not run Node, paste database-seed-marketplace.sql
 *     straight into the Supabase SQL editor instead.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "database-seed-marketplace.sql");

const url = process.env.DATABASE_URL || process.env.DB_URL;
if (!url) {
  console.error("ERROR: set DATABASE_URL to your Postgres connection string.");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log("→ Connected. Applying marketplace seed…");
  await client.query(sql);

  const { rows } = await client.query(
    `SELECT title, subject, price_kobo, total_students, avg_rating, rating_count
     FROM edu.marketplace_summary ORDER BY avg_rating DESC`
  );
  console.log(`✅ Seed applied. ${rows.length} active listing(s):`);
  for (const r of rows) {
    const price = r.price_kobo === 0 ? "Free" : `₦${(r.price_kobo / 100).toLocaleString()}`;
    console.log(
      `   • ${r.title} [${r.subject}] — ${price} · ${r.total_students} learners · ${Number(r.avg_rating).toFixed(2)}★ (${r.rating_count})`
    );
  }
} catch (err) {
  console.error("❌ Seed failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
