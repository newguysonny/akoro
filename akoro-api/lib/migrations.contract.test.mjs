// lib/migrations.contract.test.mjs
//
// The Data API grant contract (Supabase's 2026-10-30 change: new public
// tables get no automatic Data API grants):
//   1. For every schema the app uses, the pass asserts schema USAGE, all
//      tables, all sequences, AND default privileges so future tables inherit
//      the grant even if their migration file forgets it.
//   2. SECURITY INVARIANT: grants go to service_role ONLY. The app is
//      API-only — no frontend holds a Supabase key — so granting
//      anon/authenticated would expose the Data API to anyone holding the
//      project's public anon key. This must never regress.
import test from "node:test";
import assert from "node:assert/strict";
import { DATA_API_SCHEMAS, dataApiGrantStatements } from "./migrations.js";

test("every schema the app uses is on the allowlist", () => {
  // public (users, courses, school_profiles…), edu, mgmt, vouchers, content —
  // the five schemas CREATE TABLE appears in across migrations/.
  assert.deepEqual([...DATA_API_SCHEMAS].sort(), ["content", "edu", "mgmt", "public", "vouchers"]);
});

test("the grant pass covers tables, sequences, schema usage AND future tables", () => {
  const stmts = dataApiGrantStatements(["public", "edu"]);
  for (const schema of ["public", "edu"]) {
    assert.ok(stmts.some((s) => s === `GRANT USAGE ON SCHEMA "${schema}" TO service_role`), `${schema}: schema usage`);
    assert.ok(stmts.some((s) => s.includes(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}"`)), `${schema}: all tables`);
    assert.ok(stmts.some((s) => s.includes(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${schema}"`)), `${schema}: all sequences (INSERTs need them)`);
    assert.ok(stmts.some((s) => s.includes(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES`)), `${schema}: default privileges for future tables`);
    assert.ok(stmts.some((s) => s.includes(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT USAGE, SELECT ON SEQUENCES`)), `${schema}: default privileges for future sequences`);
  }
  // Sequences are covered for future tables too — a serial column on a new
  // table must not start failing INSERTs with permission denied.
});

test("SECURITY: grants target service_role only — never anon or authenticated", () => {
  const stmts = dataApiGrantStatements(DATA_API_SCHEMAS);
  assert.ok(stmts.length > 0);
  for (const s of stmts) {
    assert.ok(/TO service_role$/.test(s), `statement must grant to service_role only: ${s}`);
    assert.ok(!/\banon\b|\bauthenticated\b/.test(s), `must never grant to anon/authenticated: ${s}`);
  }
});

test("only plain identifiers are ever emitted — anything else is skipped, not quoted", () => {
  const hostile = ['edu"); DROP TABLE x; --', "public; GRANT ALL TO anon", "a-b-c", "ok_schema"];
  const stmts = dataApiGrantStatements(hostile);
  // The one plain identifier goes through; everything hostile is dropped.
  assert.equal(stmts.length, 5);
  assert.ok(stmts.every((s) => s.includes('"ok_schema"')));
  assert.ok(stmts.every((s) => !/DROP TABLE|GRANT ALL TO anon/i.test(s)), "hostile text must never appear in emitted SQL");
});

test("every migration file on disk is registered in the manifest — an unregistered schema ships no tables", async () => {
  // The 2026-10-01 study-prep outage: 2026-study-prep-sessions-v1.sql was
  // written to manifest standard (fully idempotent) but never added to the
  // schema group, so the boot self-migration never created
  // edu.study_prep_sessions in production. Every study-prep chat tool call
  // failed with "relation does not exist" and surfaced to learners as a
  // generic "issue starting the session". A file on disk that no group runs
  // must be a deliberate, listed exclusion — never an accident.
  const { readdir, readFile: read } = await import("node:fs/promises");
  const manifest = JSON.parse(await read(new URL("../migrations/manifest.json", import.meta.url), "utf8"));
  const registered = new Set([...(manifest.schema || []), ...(manifest.demo || [])]);
  const DELIBERATE_EXCLUSIONS = new Set([
    "2026-run-all.sql",                  // manual copy-paste bundle, duplicates the files below (see manifest "//")
    "2026-teardown-jss11-all-sections.sql", // destructive teardown helper, never part of a deploy
  ]);
  const onDisk = (await readdir(new URL("../migrations", import.meta.url)))
    .filter((f) => f.endsWith(".sql"));
  assert.ok(onDisk.length > 100, "migration files not found — wrong directory?");
  for (const file of onDisk) {
    if (DELIBERATE_EXCLUSIONS.has(file)) continue;
    assert.ok(registered.has(file), `${file} exists in migrations/ but no manifest group runs it`);
  }
  // The incident itself, pinned so it can never silently recur.
  assert.ok((manifest.schema || []).includes("2026-study-prep-sessions-v1.sql"),
    "study-prep sessions schema must run on every deploy");
  // And it must run after the tables it ALTERs.
  const order = manifest.schema;
  assert.ok(order.indexOf("2026-exam-prep-confidence-loop-v1.sql") < order.indexOf("2026-study-prep-sessions-v1.sql"),
    "study-prep ALTERs learner_exam_prep_runs — exam-prep schema must run first");
  assert.ok(order.indexOf("2026-adaptive-workflows-v1.sql") < order.indexOf("2026-study-prep-sessions-v1.sql"),
    "study-prep ALTERs adaptive_workflow_runs — adaptive-workflows schema must run first");
});
