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
