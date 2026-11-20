/**
 * lib/startWorkers.js — boot-time background workers, crons and timers
 * (Phase 19 step 4).
 *
 * app.js calls startWorkers() exactly where the worker block used to be: after
 * boot migrations and before the HTTP listener, so no worker can query a table
 * before the deploy that creates it has applied. The order inside this file is
 * the original boot order, and the dynamic imports stay lazy.
 *
 * The returned stop function clears the two boot timers this module owns (the
 * record-text backfill and the one-off background-queue migration). Module
 * workers keep their own intervals; they are gated by lib/jobsGate.js and exit
 * with the process.
 */
import { skipJob as sharedSkipJob } from "./jobsGate.js";
import { setBattleQueue, setTaskScheduler } from "./bootHooks.js";
import {
  startChatFollowUpWorker,
  startLearnerAutonomyWorker,
  recoverLearnerAutonomySchedules,
} from "../modules/adaptive-learning/index.js";
import { startRoutineScheduler } from "../modules/self-study/index.js";

/**
 * Start every background worker that runs before the listener. Resolves after
 * the two awaits that were top-level in app.js (agent inbox, autonomy cycle),
 * so their order relative to the rest of boot is unchanged.
 */
export async function startWorkers() {
  const skipJob = sharedSkipJob;
  const bootTimers = new Set();
  const schedule = (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    bootTimers.add(timer);
    return timer;
  };

  // ─── Background jobs kill switch ───────────────────────────────────────────
  // Every recurring job (sweeps, crons, schedulers) burns Redis commands while
  // the process runs — on a metered free tier that can outrun real usage with
  // ZERO users. Three dials, most specific wins:
  //   AKORO_JOBS_ENABLED="chat follow-ups worker,learner-autonomy worker"
  //     → ONLY the named jobs run (each BullMQ worker idles at ~1-2k cmds/month,
  //       so running only the learner-facing two fits the free tier comfortably)
  //   AKORO_JOBS_DISABLED="eval worker,battle worker"
  //     → all jobs EXCEPT the named ones run
  //   AKORO_BACKGROUND_JOBS_ENABLED=false
  //     → the everything switch, unchanged
  // Job names are exactly the strings passed to skipJob below (battle worker,
  // eval worker, chat follow-ups worker, learner-autonomy worker, autonomy
  // cycle worker, embedding sweeper, alert worker, routine scheduler, tenant
  // host refresh). The tasks worker has its own legacy gate (ENABLE_TASK_WORKER).
  // The gate lives in lib/jobsGate.js: module-level crons (live-session
  // scheduler, leaderboard rebuild) must respect the same dials as every
  // worker — they used to register on import with no gate at all.

  // Eagerly start the BullMQ battle worker at boot (it was previously imported
  // lazily on the first enqueue, so battles could stall until some action kicked
  // it). Guarded by REDIS_URL so environments without Redis stay quiet.
  if (process.env.REDIS_URL && !skipJob("battle worker")) {
    import("../modules/battle/worker.js")
      .then(({ battleQueue }) => { setBattleQueue(battleQueue); console.log("[battle] worker started at boot"); })
      .catch((e) => console.error("[battle] worker failed to start:", e.message));

    // Eval runs. Same guard: a suite is minutes of model calls, so it runs on a
    // queue and the admin page polls.
    if (!skipJob("eval worker")) {
      import("./evalWorker.js")
        .then((m) => m.startEvalWorker())
        .catch((e) => console.error("[evals] worker failed to start:", e.message));
    }

    // Learner-requested agent check-ins are durable delayed jobs. Their worker
    // creates the persistent chat and notification at the requested time.
    // Phase 21: agents handle each other's messages on their own lane
    // (a message arriving / the agent coming online wakes it; a 5-min sweep).
    try {
      if (!skipJob("agent inbox worker")) {
        const { startAgentInboxWorker } = await import("../modules/agent-network/index.js");
        startAgentInboxWorker();
        console.log("[agent-inbox] worker started at boot");
      }
    } catch (e) {
      console.error("[agent-inbox] worker failed to start:", e.message);
    }
    try {
      if (!skipJob("chat follow-ups worker")) {
        startChatFollowUpWorker();
        console.log("[chat-follow-ups] worker started at boot");
      }
    } catch (e) {
      console.error("[chat-follow-ups] worker failed to start:", e.message);
    }

    // Study Prep (2026-10-19): an Agent Check starts by itself a minute after its topic (or the teach-back), inside the approved coins.
    if (!skipJob("study prep auto-start")) {
      import("../modules/adaptive-learning/index.js")
        .then((m) => { m.startStudyPrepAutoStart(); console.log("[study-prep] auto-start sweep started at boot"); })
        .catch((e) => console.error("[study-prep] auto-start failed to start:", e.message));
    }

    // Quiet learning (Grand Plan §7.16.6): a settled chat gets one background
    // pass — a real summary and merged memories, platform-paid, consent-gated.
    if (!skipJob("quiet learning worker")) {
      import("../modules/agent-memory/quietLearning.js")
        .then((m) => { m.startQuietLearningWorker(); console.log("[quiet-learning] worker started at boot"); })
        .catch((e) => console.error("[quiet-learning] worker failed to start:", e.message));
    }

    // Self-tooling (S3): an admin approval resumes the learner's tool build in
    // their chat. Durable jobs + a 15-minute sweep for lost ones and expiry.
    // Without the worker, approvals resume in-process (resumeQueue.enqueueResume).
    {
      const withWorker = !skipJob("self-tool resumes worker");
      const withSweep = withWorker || !skipJob("self-tool resume sweep");
      if (withWorker || withSweep) {
        import("../modules/self-tooling/index.js")
          .then((m) => {
            if (withWorker) { m.startResumeWorker(); console.log("[self-tool-resumes] worker started at boot"); }
            else { m.armSweep(); console.log("[self-tool-resumes] sweep only (resumes run in-process)"); }
          })
          .catch((e) => console.error("[self-tool-resumes] failed to start:", e.message));
      }
    }

    // The learner's persisted opt-in, not a browser state, authorizes every
    // autonomous due-task nudge. Recovery only restores delayed due-time jobs;
    // it never enables autonomy for a learner.
    try {
      if (!skipJob("learner-autonomy worker")) {
        startLearnerAutonomyWorker();
        recoverLearnerAutonomySchedules()
          .then((scheduled) => console.log(`[learner-autonomy] recovered ${scheduled ?? 0} due-task review(s)`))
          .catch((e) => console.error("[learner-autonomy] schedule recovery failed:", e.message));
        console.log("[learner-autonomy] worker started at boot");
      }
    } catch (e) {
      console.error("[learner-autonomy] worker failed to start:", e.message);
    }

    // Full Autonomy level 2 (Planner): the background study loop. One env
    // var picks the rhythm — AKORO_AUTONOMY_CYCLE_EVERY=5m / 1h loops the
    // planner at that pace around the clock; unset, it's the nightly cycle
    // (one batch inside the 21:00-22:00 Africa/Lagos window). All knobs:
    // AKORO_AUTONOMY_* in modules/autonomy/cadence.js.
    try {
      if (!skipJob("autonomy cycle worker")) {
        const autonomy = await import("../modules/autonomy/scheduler.js");
        autonomy.startAutonomyCycleWorker();
        console.log("[autonomy] planner worker started at boot");
      }
    } catch (e) {
      console.error("[autonomy] planner worker failed to start:", e.message);
    }
  }

  // Keeps the vector stores current. Rows arrive without embeddings (SQL seeds,
  // a failed inline call) and rows get edited after being embedded; both leave
  // search quietly wrong, and nothing used to report either.
  // Recently deleted (§7.17): chat uploads the learner undid are deleted for good after 30 days.
  if (!skipJob("materials purge")) {
    import("../modules/materials/index.js")
      .then((m) => m.startMaterialsPurge())
      .catch((e) => console.error("[materials-purge] failed to start:", e.message));
  }

  if (!skipJob("embedding sweeper")) {
    import("./embeddingSweeper.js")
      .then((m) => m.startEmbeddingSweeper())
      .catch((e) => console.error("[embeddings] sweeper failed to start:", e.message));
  }

  // Library text backfill — files uploaded before upload-time extraction get
  // their free, server-readable text (PDF text layers, text files, Word /
  // PowerPoint) and pastes their search index. One pass per boot, a few
  // minutes after start; idempotent, so later boots only see what's new.
  // Scans, images and recordings stay on the reader's tap-to-extract offer.
  if (!skipJob("record text backfill")) {
    schedule(() => {
      import("../modules/records/index.js")
        .then((m) => m.backfillRecordText())
        .catch((e) => console.error("[records/text-backfill] failed to start:", e.message));
    }, 3 * 60_000);
  }

  // Alert rules — spend, latency, failures, and work that has silently stopped.
  // Needs no Redis: it reads the telemetry tables on a cron.
  if (!skipJob("alert worker")) {
    import("./alertWorker.js")
      .then((m) => m.startAlertWorker())
      .catch((e) => console.error("[alerts] worker failed to start:", e.message));
  }
  // Far-off queue jobs wait in Postgres and are handed to their queue shortly
  // before they are due (lib/deferredJobs.js) — so no worker polls Redis every
  // 10 s for a job that is days away. Once the workers above have loaded, the
  // boot clean-up moves the old per-module queues' jobs onto the shared
  // background queue and pulls far-off / repeat jobs out of Redis.
  // Live-session reminders (24 h / 1 h / 10 min). Started at boot so its waiting
  // reminders are releasable after a restart, not only once a session is created.
  if (process.env.REDIS_URL && !skipJob("session notifier")) {
    import("../workers/sessionNotifier.js")
      .then((m) => { m.startSessionNotifier(); console.log("[sessionNotifier] worker started at boot"); })
      .catch((e) => console.error("[sessionNotifier] failed to start:", e.message));
  }
  // Store first, send after (Phase 18 item 5): the outbox's clock retries failed
  // sends with backoff and resumes what a restart left. Postgres only — no Redis.
  if (!skipJob("outbox")) {
    import("./outbox.js")
      .then((m) => { m.startOutbox(); console.log("[outbox] clock started (every 15 s)"); })
      .catch((e) => console.error("[outbox] failed to start:", e.message));
  }
  if (process.env.REDIS_URL && !skipJob("deferred jobs")) {
    import("./deferredJobs.js")
      .then((m) => { m.startDeferredRelease(); console.log("[deferred-jobs] release clock started (every minute)"); })
      .catch((e) => console.error("[deferred-jobs] failed to start:", e.message));
    schedule(() => {
      import("./backgroundMigrate.js")
        .then((m) => m.migrateBackgroundQueues())
        .then((r) => console.log("[background-migrate] done", JSON.stringify(r)))
        .catch((e) => console.warn("[background-migrate] failed:", e.message));
    }, 30_000);
  }
  // Phase 22: execution-log upkeep — the stale-run sweep (crash visibility) and
  // the hourly failure digest. DB-only (no Redis), so it runs regardless.
  if (!skipJob("execution log")) {
    import("../modules/adaptive-learning/index.js")
      .then((m) => { m.startExecutionLogMaintenance(); console.log("[execution-log] maintenance started (sweep + digest)"); })
      .catch((e) => console.warn("[execution-log] maintenance failed to start:", e.message));
  }

  return () => {
    for (const timer of bootTimers) clearTimeout(timer);
    bootTimers.clear();
  };
}

/** Weekly routine preparation (drafts only — assignment stays human). */
export function startRoutineSchedulerJob() {
  if (!sharedSkipJob("routine scheduler")) startRoutineScheduler();
}

/** The Anthropic task agent — deliberately after the listener opens. */
export function startTaskWorker() {
  if (process.env.ENABLE_TASK_WORKER !== "false") {
    import("../modules/tasks/worker.js")
      .then(async (m) => { setTaskScheduler({ ...(await import("../modules/tasks/scheduler.js")), runDueTasks: m.runDueTasks }); console.log("[tasks] worker started"); })
      .catch((e) => console.error("[tasks] worker failed to start:", e.message));
  }
}
