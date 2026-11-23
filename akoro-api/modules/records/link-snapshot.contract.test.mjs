// Links are readable documents now: snapshot on save, shared reader, tools.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = path.join(HERE, "..", "..");
const read = (...p) => readFileSync(path.join(API, ...p), "utf8");
const learner = (...p) => readFileSync(path.join(API, "..", "akoro-learner", "src", ...p), "utf8");

test("the link snapshot schema is registered", () => {
  const manifest = JSON.parse(read("migrations", "manifest.json"));
  assert.ok(manifest.schema.includes("2026-record-link-snapshots.sql"));
  const sql = read("migrations", "2026-record-link-snapshots.sql");
  assert.match(sql, /link_status TEXT/);
  assert.match(sql, /link_title TEXT/);
  assert.match(sql, /link_image TEXT/);
});

test("saving a link fetches, indexes and previews its snapshot", () => {
  const svc = read("modules", "records", "service-records.js");
  assert.match(svc, /link_status: "fetching"/);
  assert.match(svc, /snapshotLinkRecord\(data\)/);
  assert.match(svc, /generatePreviewForRecord\(updated\)/);
  assert.match(svc, /linkStatus: r\.link_status/);
  assert.match(svc, /content: r\.kind === "paste" \|\| \(r\.kind === "link" && r\.content\)/);
  const snap = read("modules", "records", "linkSnapshot.js");
  assert.match(snap, /assertPublicUrl/);
  assert.match(snap, /export function extractReadable/);
  assert.match(snap, /indexRecord\(\{ userId: updated\.user_id/);
});

test("the shared reader renders snapshots and lets a bare link open the original", () => {
  const types = learner("features", "library", "components", "recordFileType.js");
  assert.match(types, /r\.kind === 'link'\) return 'link'/);
  const hook = learner("features", "library", "hooks", "useRecordSession.js");
  assert.match(hook, /record\.kind === 'link'/);
  assert.match(hook, /buildSessionReaderPages\(/);
  assert.match(hook, /record\.kind === 'link' \|\|/);
  const session = learner("features", "library", "components", "RecordTeachSession.jsx");
  assert.match(session, /Open original/);
  assert.match(session, /linkUrl: record\.kind === "link"/);
  const chrome = learner("features", "teaching", "components", "SessionReaderChrome.jsx");
  assert.match(chrome, /aria-label="Open original page"/);
  const data = learner("features", "library", "hooks", "useLibraryData.js");
  assert.match(data, /if \(r\.kind === 'link'\) setViewer\(r\)/);
  const modal = learner("components", "dashboard", "AddRecordModal.jsx");
  assert.match(modal, /kind: 'link', url/);
  assert.match(modal, /setTimeout\(\(\) => \{ void reload\(\); \}, 3000\)/);
});
