// Redis idle cost (2026-10-23): far-off jobs wait in Postgres, the quiet
// kinds share one worker, idle workers block for 5 minutes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HOLD_MS, nextCronRun, planAdd, releaseJobId, storedOpts } from "./deferredJobsCore.js";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");

test("near-term jobs go straight to Redis; far-off and recurring ones wait in Postgres", () => {
  const now = Date.parse("2026-10-23T10:00:00Z");
  assert.deepEqual(planAdd({}, now), { direct: true });
  assert.deepEqual(planAdd({ delay: 15_000 }, now), { direct: true });          // a battle reveal
  assert.deepEqual(planAdd({ delay: HOLD_MS }, now), { direct: true });
  const far = planAdd({ delay: 48 * 3600_000 }, now);                           // a battle's idle cleanup
  assert.equal(far.direct, false);
  assert.equal(far.dueAt.toISOString(), "2026-10-25T10:00:00.000Z");
  assert.equal(far.repeat, null);
  const cron = planAdd({ repeat: { pattern: "0 7 * * *", tz: "Africa/Lagos" } }, now);
  assert.equal(cron.direct, false);
  assert.equal(cron.dueAt.toISOString(), "2026-10-24T06:00:00.000Z");          // 07:00 Lagos = 06:00 UTC
  assert.deepEqual(cron.repeat, { pattern: "0 7 * * *", tz: "Africa/Lagos" });
});

test("cron: the next run after a release moves on, in the pattern's time zone", () => {
  assert.equal(nextCronRun("*/15 * * * *", "UTC", new Date("2026-10-23T10:07:00Z")).toISOString(), "2026-10-23T10:15:00.000Z");
  assert.equal(nextCronRun("30 9 * * 1", "Africa/Lagos", new Date("2026-10-23T10:00:00Z")).toISOString(), "2026-10-26T08:30:00.000Z");
});

test("stored options drop what the row holds; a recurring row is released under one id per run", () => {
  assert.deepEqual(storedOpts({ delay: 5, repeat: {}, jobId: "x", attempts: 3, backoff: { type: "fixed" } }), { attempts: 3, backoff: { type: "fixed" } });
  assert.equal(releaseJobId({ job_key: "start-b1", repeat: null, due_at: "2026-10-23T10:00:00Z" }), "start-b1");
  assert.equal(releaseJobId({ job_key: "repeat-task-t1", repeat: { pattern: "0 7 * * *" }, due_at: "2026-10-24T06:00:00Z" }),
    `repeat-task-t1-${Date.parse("2026-10-24T06:00:00Z")}`);
  assert.doesNotMatch(releaseJobId({ job_key: "repeat-task-t1", repeat: {}, due_at: "2026-10-24T06:00:00Z" }), /:/);   // BullMQ refuses ":" in ids
});

test("the far-off producers use addLater; the release claims a row before adding it", async () => {
  const [deferred, routes, network, followUps, autonomy, quiet, tasks] = await Promise.all([
    read("./deferredJobs.js"), read("../modules/battle/routes.js"), read("../modules/battle/networkBattle.js"),
    read("../modules/adaptive-learning/chat-follow-ups.js"), read("../modules/adaptive-learning/learner-autonomy.js"),
    read("../modules/agent-memory/quietLearning.js"), read("../modules/tasks/scheduler.js"),
  ]);
  assert.doesNotMatch(routes, /\bq\.add\("(expire|start)-battle"/);
  assert.doesNotMatch(network, /\bq\.add\("(expire|start)-battle"/);
  assert.match(followUps, /addLater\(chatFollowUpQueue\(\), "deliver-chat-follow-up"/);
  assert.match(followUps, /cancelLater\(chatFollowUpQueue\(\), `chat-follow-up-\$\{id\}`\)/);
  assert.match(autonomy, /addLater\(autonomyQueue\(\), "review-due-task"/);
  assert.match(quiet, /addLater\(q, "pass", \{ userId, chatSessionId \}, \{ jobId, delay: QUIET\.SETTLE_MS, replace: true \}\)/);
  assert.doesNotMatch(tasks, /taskQueue\.add\([^)]*repeat:/s);
  assert.match(tasks, /jobId: `repeat-task-\$\{task\.id\}`/);
  assert.match(tasks, /cancelLater\(taskQueue, `repeat-task-\$\{taskId\}`\)/);
  // claimed first (delete / conditional update), so two processes never release a row twice
  assert.match(deferred, /table\(\)\.delete\(\)\.eq\("id", r\.id\)\.select\("id"\)/);
  assert.match(deferred, /\.eq\("id", r\.id\)\.eq\("due_at", r\.due_at\)\.select\("id"\)/);
  assert.match(deferred, /if \(await q\.getJob\(jobId\)\) \{ skipped\+\+; continue; \}/);
});

test("one background worker for the quiet kinds; every idle worker blocks 5 minutes", async () => {
  const [bg, battle, taskWorker, notifier, video, migrate, app] = await Promise.all([
    read("./backgroundQueue.js"), read("../modules/battle/worker.js"), read("../modules/tasks/worker.js"),
    read("../workers/sessionNotifier.js"), read("../worker.js"), read("./backgroundMigrate.js"), read("../app.js"),
  ]);
  for (const kind of ["chat-follow-ups", "learner-autonomy", "quiet-learning", "self-tool-resumes", "evals", "autonomy-cycle"]) {
    assert.ok(bg.includes(`: "${kind}"`) || bg.includes(`${kind}: "${kind}"`), `merged: ${kind}`);
  }
  for (const [name, src] of Object.entries({ bg, battle, taskWorker, notifier, video })) assert.match(src, /drainDelay:\s+300/, name);
  assert.match(bg, /stalledInterval: 300_000/);
  assert.match(bg, /guardWorker\(worker, "background worker"\)/);
  // a kind keeps its own concurrency (evals one at a time)
  assert.match(bg, /while \(h\.running >= h\.concurrency\)/);
  // the old queues' leftovers move over once at boot
  assert.match(migrate, /for \(const \[oldName, kind\] of Object\.entries\(MERGED_QUEUES\)\)/);
  assert.match(app, /m\.startDeferredRelease\(\)/);
  assert.match(app, /m\.migrateBackgroundQueues\(\)/);
});
