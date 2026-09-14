/**
 * jobs-gate.contract.test.mjs — per-worker Redis-budget dials.
 *
 * Upstash free = 500k commands/MONTH; each BullMQ worker idles at a
 * blocking-poll floor (~1-2k cmds/month) plus deploy-day boot bursts. The
 * three dials (AKORO_JOBS_ENABLED / AKORO_JOBS_DISABLED /
 * AKORO_BACKGROUND_JOBS_ENABLED) let a deployment run only the
 * learner-facing workers and still fit the free tier. Source-pinned: app.js
 * boots on import, so behaviour lives in the options contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appJs = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "app.js"), "utf8");

test("jobs gate · specific wins over general; both selection envs exist", () => {
  // most-specific-first order: ONLY list, then DISABLED list, then the flag
  const skip = appJs.indexOf("const skipJob");
  const only = appJs.indexOf("JOBS_ONLY.length && !JOBS_ONLY.includes(name)");
  const disabled = appJs.indexOf("JOBS_DISABLED.includes(name)");
  const flag = appJs.indexOf("if (backgroundJobsEnabled) return false;", skip);
  assert.ok(only > skip && disabled > only && flag > disabled, "dial precedence must be ONLY → DISABLED → global flag");
  assert.match(appJs, /AKORO_JOBS_ENABLED \?\? ""/);
  assert.match(appJs, /AKORO_JOBS_DISABLED \?\? ""/);
  // the dial is documented with the exact skipJob names
  assert.match(appJs, /chat follow-ups worker,learner-autonomy worker/);
  // every worker that burns a blocking-poll floor is behind skipJob
  for (const name of ["battle worker", "eval worker", "chat follow-ups worker",
    "learner-autonomy worker", "autonomy cycle worker"]) {
    assert.match(appJs, new RegExp(`skipJob\\("${name}"\\)`), `${name} is not behind the gate`);
  }
  // the legacy tasks-worker gate still stands
  assert.match(appJs, /ENABLE_TASK_WORKER !== "false"/);
});
