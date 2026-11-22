// H4/H5 wiring contract: coverage is computed for Ask answers, retrieval and
// generation events are written from the hot paths, and the admin console can
// read them. If one of these silently disappears, the plan loses its baseline.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = path.join(HERE, "..", "..");
const read = (...p) => readFileSync(path.join(API, ...p), "utf8");

test("the telemetry migration is registered", () => {
  const manifest = JSON.parse(read("migrations", "manifest.json"));
  assert.ok(manifest.schema.includes("2026-retrieval-telemetry.sql"));
  const sql = read("migrations", "2026-retrieval-telemetry.sql");
  assert.match(sql, /retrieval_events/);
  assert.match(sql, /zero_result/);
  assert.match(sql, /coverage/);
});

test("search writes retrieval events and Ask writes generation coverage", () => {
  const search = read("modules", "records", "searchLib.js");
  assert.match(search, /recordRetrieval\(/);
  assert.match(search, /phase:\s*"retrieval"/);
  assert.match(search, /zeroResult:/);
  const ask = read("modules", "records", "service-ask.js");
  assert.match(ask, /citationCoverage\(/);
  assert.match(ask, /phase:\s*"generation"/);
  assert.match(ask, /coverage:\s*coverage\.coverage/);
});

test("the admin console can read the baseline", () => {
  const routes = read("modules", "admin", "routes.js");
  assert.match(routes, /get\("\/retrieval\/events",\s*adminOnly/);
  const maintenance = read("modules", "admin", "maintenance.js");
  assert.match(maintenance, /readRetrievalEvents/);
});
