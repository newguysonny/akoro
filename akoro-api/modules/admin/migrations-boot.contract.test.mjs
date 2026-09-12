import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Migrations must load automatically when the backend deploys — independent
// of the host's release hooks (Railway had them; Render free tiers do not).

const lib = await readFile(new URL("../../lib/migrations.js", import.meta.url), "utf8");
const cli = await readFile(new URL("../../scripts/apply-migrations.mjs", import.meta.url), "utf8");
const appJs = await readFile(new URL("../../app.js", import.meta.url), "utf8");

test("the migration engine is a shared library with boot-safe semantics", () => {
  for (const fn of ["export async function applyMigrations", "export async function migrationsAlreadyApplied", "export function migrationUrl", "export function currentGitSha"]) {
    assert.match(lib, new RegExp(fn.replace(/\(/g, "\\(")));
  }
  // Advisory lock (concurrent boots) + durable run record + deploy SHA.
  assert.match(lib, /pg_advisory_lock\(727274\)/);
  assert.match(lib, /edu\.migration_log/);
  assert.match(lib, /RENDER_GIT_COMMIT/);
  // Skip signal: same SHA with zero failures means "already applied here".
  assert.match(lib, /last\.git_sha === sha/);
  assert.match(lib, /last\.failed === 0/);
});

test("the API self-migrates at boot — schema only, skippable, never crash-looping", () => {
  assert.match(appJs, /MIGRATIONS_ON_BOOT !== "false"/);
  assert.match(appJs, /migrationsAlreadyApplied\(mUrl, mSha\)/);
  assert.match(appJs, /applyMigrations\(\{ url: mUrl, groups: \["schema"\], label: "boot" \}\)/);
  // Demo seeds never run at boot; a failed boot run starts the API anyway
  // (loud log, no crash loop) and is recorded for the next boot to retry.
  assert.match(appJs, /groups: \["schema"\]/);
  assert.doesNotMatch(appJs, /groups: \["demo"\]/);
  assert.match(appJs, /boot run failed — starting anyway/);
  // No connection string configured → one loud, actionable line.
  assert.match(appJs, /no MIGRATION_DATABASE_URL\/DATABASE_URL configured/);
});

test("the CLI is a thin wrapper over the same engine — manual runs still work", () => {
  assert.match(cli, /import\("\.\.\/lib\/migrations\.js"\)/);
  assert.match(cli, /applyMigrations\(\{ url, groups, continueOnError, label: "cli" \}\)/);
  assert.match(cli, /--group=/);
  assert.ok(!/pg_advisory_lock/.test(cli), "no duplicated engine logic in the CLI");
});

test("boot migrations complete before any background worker starts", () => {
  // Workers query tables at startup (learner-autonomy schedule recovery);
  // on the deploy that introduces a table, a later-ordered migration hook
  // loses that race and the boot logs a failure for a healthy deploy.
  const migrationsAt = appJs.indexOf("─── Boot-time migrations");
  assert.ok(migrationsAt > -1, "boot migration block present");
  for (const workerMarker of ['skipJob("battle worker")', 'skipJob("learner-autonomy worker")', 'skipJob("chat follow-ups worker")']) {
    const at = appJs.indexOf(workerMarker);
    assert.ok(at > -1, `worker marker present: ${workerMarker}`);
    assert.ok(migrationsAt < at, `migrations must precede ${workerMarker}`);
  }
});

test("boot failures name the real database cause — never a bare generic message", async () => {
  const autonomy = await readFile(new URL("../adaptive-learning/learner-autonomy.js", import.meta.url), "utf8");
  assert.doesNotMatch(autonomy, /throw new Error\("Could not recover learner autonomy schedules"\)/,
    "schedule recovery must surface the underlying error, not swallow it");
  assert.match(autonomy, /Could not recover learner autonomy schedules — \$\{reason\}/);
});
