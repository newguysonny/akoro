/**
 * The test admin for gate eval runs (tester90): no usable password, and the
 * gate lets it reach /api/admin/evals and nothing else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the seed: an admin with a discarded password, applied on every deploy", () => {
  const sql = read("../../migrations/2026-seed-admin-tester.sql");
  assert.match(sql, /'tester90@demo\.akoro\.app', 'tester90', v_locked, 'Eval Tester', 'admin'/);
  assert.doesNotMatch(sql, /HKzqNJTCBHeB0uWSWhf7PeLIOMrlEw2/, "never the shared Password123! hash");
  assert.match(sql, /UPDATE public\.users SET password_hash = v_locked, role = 'admin'/, "re-locked on every deploy");
  assert.match(read("../../migrations/manifest.json"), /"2026-seed-admin-tester\.sql"/);
});

test("the gate keeps the test admin to the evals", () => {
  const ctx = read("./context.js");
  assert.match(ctx, /acct\.role === "admin" && !\/\^\\\/api\\\/admin\\\/evals/);
  assert.match(ctx, /role === "admin" && acct\.role !== "admin"/);
});

test("evals.run and evals.result are registered", async () => {
  const { evalsRun, evalsResult } = await import("./scenarios/evals.js");
  assert.equal(evalsRun.risk, "write");
  assert.equal(evalsResult.risk, "read");
  assert.equal(evalsRun.params.model.default, "deepseek");
  assert.match(read("./scenarios/index.js"), /\.\.\.SELFTOOL_CHANGES, evalsRun, evalsResult\]/);
});
