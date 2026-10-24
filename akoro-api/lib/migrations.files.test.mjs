// node --test lib/migrations.files.test.mjs — boot migrations run only what changed, and never hold the port.
import "../test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filesToRun, fileHash, clientOptions } from "./migrations.js";

test("only new or changed files run; MIGRATIONS_FULL runs them all", () => {
  const sql = { "a.sql": "select 1", "b.sql": "select 2", "c.sql": "select 3" };
  const known = { "a.sql": fileHash("select 1"), "b.sql": fileHash("old b") };
  assert.deepEqual(filesToRun(Object.keys(sql), (f) => sql[f], known), ["b.sql", "c.sql"]);
  assert.deepEqual(filesToRun(Object.keys(sql), (f) => sql[f], known, { full: true }), ["a.sql", "b.sql", "c.sql"]);
  assert.deepEqual(filesToRun(Object.keys(sql), (f) => sql[f], {}), ["a.sql", "b.sql", "c.sql"], "a fresh database runs everything once");
});

test("a stuck connection fails in seconds; the boot opens its port while a long run finishes", () => {
  assert.equal(clientOptions("postgres://x@db.example/x").connectionTimeoutMillis, 15_000);
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /MIGRATIONS_BOOT_WAIT_MS\) \|\| 60_000/);
  assert.match(app, /await Promise\.race\(\[run, new Promise/);
  const lib = readFileSync(new URL("./migrations.js", import.meta.url), "utf8");
  assert.match(lib, /CREATE TABLE IF NOT EXISTS edu\.migration_files/);
});
