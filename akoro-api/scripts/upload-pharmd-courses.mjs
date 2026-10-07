#!/usr/bin/env node
/**
 * upload-pharmd-courses.mjs — CLI front door to the PHARM.D upload
 * engine (modules/pharmd/uploader.js). The engine is shared with the
 * API's admin console (/api/pharmd/admin/upload), so this script and
 * the browser button run byte-for-byte the same code.
 *
 * Usage (from akoro-api/, with the API's .env present):
 *   node scripts/upload-pharmd-courses.mjs
 *   node scripts/upload-pharmd-courses.mjs --dir="/path/to/PHARM.D PILOT PROGRAMME COURSES"
 *   node scripts/upload-pharmd-courses.mjs --only="BIO 111"
 *   node scripts/upload-pharmd-courses.mjs --dry-run
 *
 * Defaults --dir to the repo's reference/PHARM.D PILOT PROGRAMME
 * COURSES/. Idempotent: re-running simply refreshes.
 */
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runPharmdUpload } from "../modules/pharmd/uploader.js";

// Re-exported so existing imports (tests, tooling) keep working.
export { runPharmdUpload, parseTopicFile, topicPath, PHARMD_BUCKET, PROGRAMME_CODE, DEFAULT_DIR } from "../modules/pharmd/uploader.js";

/** Parse CLI args: --dir, --only, --dry-run. */
function readArgs(argv) {
  const arg = (flag) => argv.find((a) => a.startsWith(flag))?.split("=").slice(1).join("=");
  const dir = arg("--dir") || undefined;
  const only = arg("--only") || null;
  const dryRun = argv.includes("--dry-run");
  return { dir, only, dryRun };
}

async function main() {
  const { dir, only, dryRun } = readArgs(process.argv.slice(2));
  const result = await runPharmdUpload({ dryRun, only, dir, onLog: (line) => console.log(line) });
  if (result.failures.length) {
    console.error(`\n${result.failures.length} problem(s):`);
    for (const f of result.failures) console.error(`  • ${f}`);
    process.exitCode = 1;
  }
}

// Run only when executed directly (node scripts/upload-pharmd-courses.mjs).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => { console.error(`[ERROR] ${err.message}`); process.exit(1); });
}
