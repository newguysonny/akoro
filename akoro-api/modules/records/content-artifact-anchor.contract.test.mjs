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
  assert.match(pharmd, /generateRecordTool\(\{ contentKey: catalogueKey/);
  assert.match(pharmd, /startRecordPodcast\(\{ contentKey: catalogueKey/);
  assert.match(pharmd, /listRecordArtifacts\(\{ contentKey: catalogueKey \}\)/);
  assert.match(pharmd, /saveRecordArtifact\(\{ contentKey: catalogueKey \}/);
});

test("unified catalogue materials resolve as content keys too", () => {
  const access = read("modules", "records", "access.js");
  assert.match(access, /from\("programme_materials"\)/);
  assert.match(access, /file_path: data\.file_path/);
  const catalogue = read("modules", "records", "catalogueFile.js");
  assert.match(catalogue, /from\("programme_materials"\)/);
  assert.match(catalogue, /pharmd-courses/);
});

test("a catalogue reader can use its own page text without a storage row", () => {
  const access = read("modules", "records", "access.js");
  assert.match(access, /contentKey\.startsWith\("catalogue:"\)/);
  assert.match(access, /id\.synthetic \|\| contentKey\.startsWith\(PHARMD_PREFIX\)/);
  assert.match(access, /synthetic: true/);
  const tools = read("modules", "records", "toolsLib.js");
  assert.match(tools, /Array\.isArray\(pageTexts\) && pageTexts\.length/);
  const pharmd = learner("features", "pharmd", "components", "PharmDTopicSession.jsx");
  assert.match(pharmd, /const catalogueKey = `catalogue:/);
  assert.match(pharmd, /generateRecordTool\(\{ contentKey: catalogueKey/);
  assert.match(pharmd, /pageTexts: allPageTexts/);
  assert.match(pharmd, /listRecordArtifacts\(\{ contentKey: catalogueKey \}\)/);
});
