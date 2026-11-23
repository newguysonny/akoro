// Catalogue readers (PHARM.D topics) have no records row. Their tools save
// tabs against the content key — exactly one anchor per artifact.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { anchorOf } from "./rules.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = path.join(HERE, "..", "..");
const read = (...p) => readFileSync(path.join(API, ...p), "utf8");
const learner = (...p) => readFileSync(path.join(API, "..", "akoro-learner", "src", ...p), "utf8");

test("anchor precedence: folder, record, then content key", () => {
  assert.deepEqual(anchorOf({ folderId: "f", recordId: "r", contentKey: "c" }), { folderId: "f" });
  assert.deepEqual(anchorOf({ recordId: "r", contentKey: "c" }), { recordId: "r" });
  assert.deepEqual(anchorOf({ contentKey: "c" }), { contentKey: "c" });
});

test("the third anchor is a registered, exclusive column", () => {
  const manifest = JSON.parse(read("migrations", "manifest.json"));
  assert.ok(manifest.schema.includes("2026-record-content-artifact-anchor.sql"));
  const sql = read("migrations", "2026-record-content-artifact-anchor.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS content_key/);
  assert.match(sql, /num_nonnulls\(record_id, folder_id, content_key\) = 1/);
  const store = read("modules", "records", "artifactsLib.js");
  assert.match(store, /contentKey \? q\.eq\("content_key", contentKey\)/);
  assert.match(store, /contentKey \? \{ content_key: contentKey \}/);
});

test("podcasts and the PHARM.D reader use the content anchor", () => {
  const start = read("modules", "records", "study-material-generate.js");
  assert.match(start, /\{ contentKey: target\.contentKey \}/);
  const pharmd = learner("features", "pharmd", "components", "PharmDTopicSession.jsx");
  assert.match(pharmd, /generateRecordTool\(\{ contentKey: readerKey/);
  assert.match(pharmd, /startRecordPodcast\(\{ contentKey: readerKey/);
  assert.match(pharmd, /listRecordArtifacts\(\{ contentKey: readerKey \}\)/);
  assert.match(pharmd, /saveRecordArtifact\(\{ contentKey: readerKey \}/);
});
