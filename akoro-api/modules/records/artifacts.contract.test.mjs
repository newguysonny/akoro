import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const { ARTIFACT_KINDS, ARTIFACT_LIMITS, validateArtifactInput, validateArtifactPatch, toApiArtifact } = await import("./artifactsLib.js");
const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const lib = await readFile(new URL("./artifactsLib.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../../migrations/2026-record-artifacts.sql", import.meta.url), "utf8");
const manifest = await readFile(new URL("../../migrations/manifest.json", import.meta.url), "utf8");

test("every reader item kind is accepted; anything else is refused", () => {
  for (const kind of ARTIFACT_KINDS) assert.ok(validateArtifactInput({ kind }).row, kind);
  assert.match(validateArtifactInput({ kind: "virus" }).error, /kind must be one of/);
  const ok = validateArtifactInput({ kind: "quiz", pageNumber: 3, params: { count: "5" }, content: { quizQuestions: [] } });
  assert.deepEqual(ok.row, { kind: "quiz", params: { count: "5" }, content: { quizQuestions: [] }, page_number: 3, open: true });
  assert.equal(validateArtifactInput({ kind: "notes", open: false }).row.open, false);
});

test("sizes, shapes and page numbers are bounded", () => {
  assert.match(validateArtifactInput({ kind: "notes", content: "text" }).error, /content must be an object/);
  assert.match(validateArtifactInput({ kind: "notes", content: [] }).error, /content must be an object/);
  assert.match(validateArtifactInput({ kind: "notes", content: { notesValue: "x".repeat(ARTIFACT_LIMITS.MAX_CONTENT_BYTES) } }).error, /too large/);
  assert.match(validateArtifactInput({ kind: "notes", params: { a: "x".repeat(5000) } }).error, /params/);
  assert.match(validateArtifactInput({ kind: "notes", pageNumber: 0 }).error, /pageNumber/);
  assert.match(validateArtifactInput({ kind: "notes", pageNumber: 2.5 }).error, /pageNumber/);
});

test("updates carry only content / params / open, and stamp updated_at", () => {
  const { patch } = validateArtifactPatch({ content: { notesValue: "hi" }, open: false, kind: "quiz", user_id: "someone-else" });
  assert.deepEqual(Object.keys(patch).sort(), ["content", "open", "updated_at"], "kind and user_id can never be changed");
  assert.match(validateArtifactPatch({}).error, /Nothing to update/);
  assert.match(validateArtifactPatch({ content: "x" }).error, /content must be an object/);
});

test("the API shape is camelCase and never leaks the owner", () => {
  const a = toApiArtifact({ id: "a", kind: "notes", page_number: 2, params: {}, content: { notesValue: "x" }, open: true, user_id: "u", record_id: "r", created_at: "t", updated_at: "t" });
  assert.deepEqual(Object.keys(a).sort(), ["content", "createdAt", "id", "kind", "open", "pageNumber", "params", "updatedAt"]);
});

test("routes: the Ask access rule to list/create, owner-only update/delete, registered before /:id", () => {
  for (const r of ['router.get("/artifacts"', 'router.post("/artifacts"', 'router.patch("/artifacts/:id"', 'router.delete("/artifacts/:id"']) {
    assert.ok(routes.includes(`${r}, authenticateToken`), r);
    assert.ok(routes.indexOf(r) < routes.indexOf('router.patch("/:id"'), `${r} before the generic /:id routes`);
  }
  assert.match(lib, /\.eq\("id", id\)\.eq\("user_id", userId\)/, "updates and deletes are scoped to the owner");
  assert.match(lib, /MAX_PER_DOCUMENT/);
});

test("the table is private per learner and document, and cascades", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS edu\.record_artifacts/);
  assert.match(migration, /user_id\s+UUID NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /record_id\s+UUID NOT NULL REFERENCES edu\.records\(id\) ON DELETE CASCADE/);
  for (const k of ARTIFACT_KINDS) assert.ok(migration.includes(`'${k}'`), `migration allows ${k}`);
  assert.ok(manifest.indexOf('"2026-record-artifacts.sql"') > manifest.indexOf('"2026-record-chat.sql"'));
});
