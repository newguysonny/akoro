// lib/dbPool.contract.test.mjs
//
// The connection-pool doctrine, enforced (user directive 2026-09-30):
//
//   "Setting your app's max connection pool higher than your database can
//    handle creates a massive bottleneck under load. High connection counts
//    force the database engine to waste RAM and CPU context-switching between
//    competing threads. It is better to keep your pool size surprisingly
//    small and let an external connection proxy handle the traffic spikes."
//
// In this codebase the external proxy is Supabase Supavisor (DATABASE_URL
// points at its transaction pooler), so every direct Postgres pool inside the
// API must be:
//   1. explicit — `new Pool(` without a `max:` option silently gets node's
//      default of 10 and, worse, an unbounded wait when exhausted;
//   2. small — the default max literal must be ≤ 10;
//   3. fail-fast — `connectionTimeoutMillis` set, so pool exhaustion surfaces
//      as a retryable error instead of a hung request;
//   4. actually present — the count is asserted so this test can't pass
//      vacuously after a refactor.
//
// Scope: runtime code only (lib/ + modules/). scripts/ (one-shot golden-path
// and seed tools) and *.test.* files are excluded — they exit before idle
// connections matter.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here       = dirname(fileURLToPath(import.meta.url));
const apiRoot    = join(here, "..");

/** Recursively collect .js files under lib/ and modules/, minus tests. */
function runtimeSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { out.push(...runtimeSources(full)); continue; }
    if (entry.endsWith(".js") && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

/** Every `new Pool(` occurrence with a window of the options object that follows. */
function poolOccurrences() {
  const found = [];
  for (const file of [...runtimeSources(join(apiRoot, "lib")), ...runtimeSources(join(apiRoot, "modules"))]) {
    const src = readFileSync(file, "utf8");
    let idx = 0;
    while ((idx = src.indexOf("new Pool(", idx)) !== -1) {
      found.push({ file, window: src.slice(idx, idx + 600) });
      idx += 9;
    }
  }
  return found;
}

test("the API has at least one runtime Postgres pool (this test must not pass vacuously)", () => {
  const pools = poolOccurrences();
  assert.ok(pools.length >= 1, `expected ≥1 runtime pool, found ${pools.length}`);
});

test("every runtime pool sets an explicit max — node's silent default of 10 is not allowed", () => {
  const pools = poolOccurrences();
  for (const { file, window } of pools) {
    assert.match(window, /max\s*:/, `${file}: new Pool( must set max: explicitly`);
  }
});

test("every runtime pool's default max is surprisingly small (≤ 10)", () => {
  const pools = poolOccurrences();
  for (const { file, window } of pools) {
    // Accept either a small numeric literal or config-driven sizing whose
    // default lives in config/index.js (checked separately below).
    const m = window.match(/max\s*:\s*([^,\n}]+)/);
    assert.ok(m, `${file}: could not read the max option`);
    const value = m[1].trim();
    if (/^\d+$/.test(value)) {
      assert.ok(Number(value) <= 10, `${file}: max ${value} exceeds the doctrine bound of 10`);
    } else {
      assert.match(value, /config\.db\.poolMax/, `${file}: non-literal max must come from config.db.poolMax`);
    }
  }
});

test("every runtime pool fails fast — connectionTimeoutMillis is always set", () => {
  const pools = poolOccurrences();
  for (const { file, window } of pools) {
    assert.match(window, /connectionTimeoutMillis\s*:/, `${file}: pool must set connectionTimeoutMillis (0 = queue forever)`);
  }
});

test("config defaults embody the doctrine: small pool, bounded wait", async () => {
  const { default: config } = await import("../config/index.js");
  assert.ok(config.db.poolMax <= 10, `config.db.poolMax default ${config.db.poolMax} must stay ≤ 10`);
  assert.ok(config.db.poolMax >= 1, "config.db.poolMax must be at least 1");
  assert.ok(config.db.poolConnectMs > 0 && config.db.poolConnectMs <= 30000,
    `config.db.poolConnectMs ${config.db.poolConnectMs} must be a bounded, non-zero wait`);
  assert.ok(config.db.poolIdleMs > 0, "idle connections must be reaped (poolIdleMs > 0)");
});

test("migrations use a single client, not a pool — DDL never parks idle connections", () => {
  const src = readFileSync(join(apiRoot, "lib", "migrations.js"), "utf8");
  assert.ok(!src.includes("new Pool("), "lib/migrations.js must keep using pg.Client, not a Pool");
  assert.match(src, /new pg\.Client\(/, "lib/migrations.js should open one client per run");
});
