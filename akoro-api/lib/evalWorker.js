// lib/evalWorker.js
//
// Runs eval suites on a queue.
//
// Not in the request: a suite is a few hundred model calls at seconds each, so
// a synchronous endpoint would hit Railway's proxy timeout long before it
// finished. The /reembed pattern elsewhere in the codebase — do a capped batch,
// return "remaining", press again — works for embeddings at milliseconds each
// and would be miserable here.
//
// So POST enqueues and returns a run id, and the page polls. Results are
// written per case, so it fills in as it goes.

import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import db from "../db.js";
import { bullRedisOptions } from "./redisOptions.js";
import { SUITES, suiteByKey, runSuite } from "./evals/index.js";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", bullRedisOptions);
connection.on("error", (e) => console.error("[evals/redis]", e.message));

export const evalQueue = new Queue("evals", {
  connection,
  defaultJobOptions: {
    // No retries. A rerun costs real money and would silently double the bill
    // for a failure the operator has not seen yet — they can press the button
    // again if they want it.
    attempts: 1,
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 50 },
  },
});

let worker = null;

export function startEvalWorker() {
  if (worker) return worker;
  worker = new Worker("evals", async (job) => {
    const { runId } = job.data;
    const { data: run } = await db.schema("edu").from("eval_runs").select("*").eq("id", runId).maybeSingle();
    if (!run || run.status === "cancelled") return;

    const suite = suiteByKey(run.suite);
    if (!suite) {
      await finish(runId, { status: "failed", error: `Unknown suite "${run.suite}"` });
      return;
    }

    await db.schema("edu").from("eval_runs")
      .update({ status: "running", started_at: new Date().toISOString(), cases_total: suite.cases.length })
      .eq("id", runId);

    try {
      const res = await runSuite({ suite, model: run.model, runId, userId: run.created_by });
      if (res.cancelled) {
        // Already marked cancelled by the endpoint; record what it managed.
        await finish(runId, { cases_passed: res.passed, cases_failed: res.failed, cost_usd: res.costUsd, ms: res.ms });
        console.log(`[evals] run ${runId} cancelled after ${res.passed + res.failed} cases`);
        return;
      }
      await finish(runId, {
        status: "done",
        cases_passed: res.passed, cases_failed: res.failed, cases_total: res.total,
        cost_usd: res.costUsd, ms: res.ms,
        // The bar as it stood for this run. Raising it later must not rewrite
        // history into a string of failures.
        threshold: res.threshold, met_threshold: res.metThreshold,
      });
      console.log(
        `[evals] ${run.suite} on ${run.model}: ${res.passed}/${res.total} passed ` +
        `(${Math.round(res.rate * 100)}%, bar ${Math.round(res.threshold * 100)}%) ` +
        `— ${res.metThreshold ? "MET" : "BELOW BAR"} · $${res.costUsd}`);
    } catch (e) {
      await finish(runId, { status: "failed", error: e.message?.slice(0, 500) });
      console.error(`[evals] run ${runId} failed:`, e.message);
    }
  }, {
    connection,
    // One at a time. Two runs would double the spend and race the same tables,
    // and there is never a reason to want the second one sooner.
    concurrency: 1,
    drainDelay: 30,
  });

  worker.on("error", (e) => console.error("[evals/worker]", e.message));
  console.log(`[evals] worker started (${SUITES.length} suites)`);
  return worker;
}

async function finish(runId, patch) {
  await db.schema("edu").from("eval_runs")
    .update({ finished_at: new Date().toISOString(), ...patch }).eq("id", runId);
}
