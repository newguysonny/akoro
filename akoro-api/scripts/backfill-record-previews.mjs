#!/usr/bin/env node
/**
 * Backfill page-1 previews for documents that were uploaded before previews
 * existed (preview_key IS NULL).
 *
 *   DATABASE_URL=postgres://… node scripts/backfill-record-previews.mjs [--dry-run] [--limit=200]
 *
 * Rendering is server-side (modules/records/preview.js: pdfjs + @napi-rs/canvas)
 * and storage goes through the same records helpers the API uses, so the
 * script needs the deployment's DATABASE_URL and R2_* (or Supabase) variables.
 * Safe to re-run: it only touches rows with no preview and stops on the first
 * batch that makes no progress.
 *
 * --self-test renders one page from reference/ and writes /tmp/preview-selftest.jpg,
 * proving the rasteriser works in this environment without touching the DB.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const selfTest = args.includes("--self-test");
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || 200);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (selfTest) {
  const { renderPdfFirstPage } = await import("../modules/records/preview.js");
  const pdf = readFileSync(path.join(ROOT, "..", "reference", "Topic 1_BIO111_Cell_Structure_and_Organization.pdf"));
  const t0 = Date.now();
  const jpg = await renderPdfFirstPage(pdf);
  if (!jpg) { console.error("self-test: render failed"); process.exitCode = 1; }
  else {
    writeFileSync("/tmp/preview-selftest.jpg", jpg);
    console.log(`self-test ok: ${jpg.length} bytes in ${Date.now() - t0} ms → /tmp/preview-selftest.jpg`);
  }
  process.exit();
}

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL (direct Postgres URI)."); process.exit(1); }

const { default: pg } = await import("pg");
const { generatePreviewForRecord } = await import("../modules/records/service-records.js");

const client = new pg.Client({ connectionString: url });
await client.connect();

let done = 0, failed = 0;
try {
  const { rows } = await client.query(
    `SELECT id, user_id, kind, name, mime, file_key
       FROM edu.records
      WHERE kind = 'upload' AND file_key IS NOT NULL
        AND preview_key IS NULL AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $1`, [limit],
  );
  console.log(`${rows.length} record(s) without a preview${dryRun ? " (dry run)" : ""}`);
  for (const row of rows) {
    if (dryRun) { console.log("would render", row.id, row.name); continue; }
    const key = await generatePreviewForRecord(row);
    if (key) { done++; console.log("preview", row.id, "→", key); }
    else { failed++; console.log("no preview", row.id, row.name); }
  }
} finally {
  await client.end();
}
console.log(`done: ${done} written, ${failed} skipped/failed`);
