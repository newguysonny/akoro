// The reindex job is how H1–H3 reach rows written by the old chunker. Guard
// its barrel exports, admin routes and the "never metered" rule.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = path.join(HERE, "..", "..");
const read = (...p) => readFileSync(path.join(API, ...p), "utf8");

test("the job is exported through the records barrel", () => {
  const barrel = read("modules", "records", "index.js");
  for (const name of ["scanStaleChunks", "startChunkReindex", "getChunkReindex"]) {
    assert.match(barrel, new RegExp(`\\b${name}\\b`), `${name} missing from the barrel`);
  }
});

test("the admin console can dry-run, start and poll it", () => {
  const routes = read("modules", "admin", "routes.js");
  assert.match(routes, /post\("\/records\/chunks\/reindex",\s*adminOnly/);
  assert.match(routes, /get\("\/records\/chunks\/reindex\/:jobId",\s*adminOnly/);
  const maintenance = read("modules", "admin", "maintenance.js");
  assert.match(maintenance, /dryRun/);
  assert.match(maintenance, /startChunkReindex/);
});

test("reindexing is bounded, version-aware and unmetered", () => {
  const src = read("modules", "records", "reindexChunks.js");
  assert.match(src, /lt\("index_version", INDEX_VERSION\)/);
  assert.match(src, /bill:\s*false/, "platform work never charges the learner");
  assert.match(src, /stampStale/, "orphaned rows are stamped, not rescanned forever");
  assert.match(src, /MAX_BATCH/);
});
