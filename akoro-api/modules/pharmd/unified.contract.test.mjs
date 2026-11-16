import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

test("unified migration: additive, idempotent, progress backfilled", async () => {
  const sql = await read("../../migrations/2026-pharmd-unified.sql");
  assert.ok(sql.includes("ADD COLUMN IF NOT EXISTS file_path"), "materials gain file_path");
  assert.ok(sql.includes("ADD COLUMN IF NOT EXISTS file_hash"), "materials gain file_hash");
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS edu.programme_material_progress"), "material-keyed progress table");
  assert.ok(sql.includes("FROM edu.pharmd_topic_progress"), "progress backfilled from the legacy table");
  assert.ok(sql.includes("m.source_topic_id = t.id"), "backfill joins through the source link");
  assert.ok(!/DROP TABLE|DROP COLUMN|DELETE FROM/.test(sql), "nothing destructive");
});

test("pharmd routes: unified read path with legacy fallback", async () => {
  const routes = await read("./routes.js");
  for (const fn of ["serveUnifiedProgramme", "serveUnifiedCourse", "serveUnifiedProgress", "serveUnifiedComplete"]) {
    assert.ok(routes.includes(`async function ${fn}`), `${fn} exists`);
  }
  assert.ok(routes.includes('AKORO_PHARMD_UNIFIED'), "kill switch documented in code");
  assert.ok(routes.includes("programme_material_progress"), "progress reads the unified table");
  assert.ok(routes.includes('eq("source", "pharmd")'), "unified programme found by source link");
  // The legacy handlers stay in place behind the dispatch.
  assert.ok(routes.includes('from("pharmd_topics")'), "legacy course read kept as fallback");
  assert.ok(routes.includes('from("pharmd_topic_progress")'), "legacy progress read kept as fallback");
});

test("uploader writes the unified tables, keeps its exports", async () => {
  const up = await read("./uploader.js");
  assert.ok(up.includes('from("programme_materials")'), "topics land as materials");
  assert.ok(up.includes('from("programme_courses")'), "courses land in programme_courses");
  assert.ok(up.includes("file_path: path, file_hash: fileHash"), "file identity stored on the material");
  for (const name of ["parseTopicFile", "topicPath", "PHARMD_BUCKET", "PROGRAMME_CODE", "DEFAULT_DIR", "runPharmdUpload"]) {
    assert.ok(up.includes(`export`) && up.includes(name), `export ${name} kept`);
  }
});
