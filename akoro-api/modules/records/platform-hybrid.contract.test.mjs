// M3 contract: Discover gains the vector arm WITHOUT loosening access. The
// SQL excludes private/deleted/requester/Premium rows, and JavaScript still
// re-verifies every hit against its record.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = path.join(HERE, "..", "..");
const read = (...p) => readFileSync(path.join(API, ...p), "utf8");

test("the platform hybrid migration is registered and access-scoped", () => {
  const manifest = JSON.parse(read("migrations", "manifest.json"));
  assert.ok(manifest.schema.includes("2026-platform-hybrid-search.sql"));
  const sql = read("migrations", "2026-platform-hybrid-search.sql");
  assert.match(sql, /CREATE FUNCTION public\.match_platform_chunks/);
  assert.match(sql, /r\.private = false/);
  assert.match(sql, /r\.deleted_at IS NULL/);
  assert.match(sql, /r\.kind IN \('upload', 'paste'\)/);
  assert.match(sql, /r\.user_id <> p_user_id/);
  assert.match(sql, /p_premium_user_ids/);
  assert.match(sql, /1\.0 \/ \(60 \+ v\.rank\)/, "same RRF as the library");
  assert.match(sql, /WHERE p_query_embedding IS NOT NULL AND f\.embedding IS NOT NULL/);
});

test("platform search calls the RPC and keeps the JS re-verification", () => {
  const src = read("modules", "records", "searchLib.js");
  assert.match(src, /export async function searchPlatformChunks/);
  assert.match(src, /rpc\("match_platform_chunks"/);
  assert.match(src, /p_premium_user_ids:/);
  assert.match(src, /\.neq\("user_id", userId\)/, "never the requester's own chunks");
  assert.match(src, /\.eq\("private", false\)/);
  assert.match(src, /\.in\("kind", \["upload", "paste"\]\)/);
  assert.match(src, /activePremiumUserIds/);
});
