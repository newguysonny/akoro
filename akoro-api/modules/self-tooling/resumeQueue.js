/**
 * modules/self-tooling/resumeQueue.js — the durable "resume-tool-request" job
 * (plan §7.11). An admin approval enqueues one job per waiting request; the
 * worker rebuilds the proposed tool as its learner and posts the answer into
 * the original chat. The request row is the authority (an idempotent claim),
 * so a lost or repeated job is harmless; a tick sweeps up waiting requests
 * whose job never ran, and expires requests nobody decided.
 */
import { backgroundQueue, handleBackground } from "../../lib/backgroundQueue.js";

import { workerJob } from "../../lib/workerLog.js";
import cron from "node-cron";
import { registerTick, cronSource } from "../../lib/cronTicks.js";
import { resumeRequest, waitingResumes, expireRequests } from "./escalation.js";
import { agentDeps } from "../../lib/agentDeps.js";

let worker;

// The shared background queue (lib/backgroundQueue.js).
const resumeQueue = () => backgroundQueue("self-tool-resumes", {
  attempts: 3, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: { count: 200 }, removeOnFail: { count: 200 },
});

/**
 * Resume one request: a queue job when this deployment runs the worker, else
 * in this process (AKORO_JOBS_ENABLED may leave the worker off — a resume
 * must still happen). The row's claim makes either path safe to repeat.
 */
export async function enqueueResume(requestId) {
  if (worker) {
    await resumeQueue().add("resume-tool-request", { requestId }, { jobId: `resume-${requestId}-${Date.now()}` });
    return { mode: "queue" };
  }
  setImmediate(() => { runResume(requestId).catch((e) => console.warn("[self-tool-resumes] inline resume failed:", requestId, e.message)); });
  return { mode: "inline" };
}

/** Rebuild with the chat's deps (boot-installed — see lib/agentDeps.js). */
async function runResume(requestId) {
  const [{ createTool }, { selfToolDeps }] = await Promise.all([import("./pipeline.js"), Promise.resolve(agentDeps())]);
  return resumeRequest(requestId, {
    createTool: (args) => createTool({ ...args, ...selfToolDeps(args.learnerId, args.audience === "instructor" ? "instructor" : "student") }),
  });
}

/** Tick: re-queue waiting resumes whose job was lost, and expire old requests. */
export async function sweepResumes() {
  const waiting = await waitingResumes();
  let queued = 0;
  for (const r of waiting) {
    if (r.resume_status === "resuming") {
      // A crashed worker left it claimed; hand it back.
      const { default: db } = await import("../../db.js");
      await db.schema("edu").from("agent_tool_requests").update({ resume_status: "waiting" }).eq("id", r.id).eq("resume_status", "resuming");
    }
    try { await enqueueResume(r.id); queued++; } catch { /* next sweep */ }
  }
  const { expired } = await expireRequests();
  return { queued, expired };
}

let swept = false;
/** Every 15 min: lost resumes re-queued, undecided requests expired. Daily: unused tools archived. */
export function armSweep() {
  if (swept) return;
  swept = true;
  registerTick("self-tool-resume-sweep", sweepResumes);
  // Daily (04:10 UTC): learner tools unused for 60 days are archived (S4).
  const archive = async () => (await import("./pipeline.js")).archiveUnusedTools(Number(process.env.SELF_TOOLING_ARCHIVE_DAYS) || 60);
  registerTick("self-tool-archive", archive);
  // Nightly (21:25 Africa/Lagos, inside the planner window): repeated
  // one-off computations become tool suggestions in the Suggestions list.
  const toolIdeas = async () => (await import("./toolSuggestions.js")).sweepRepeatedComputations();
  registerTick("self-tool-suggestions", toolIdeas);
  // Nightly (21:30 Africa/Lagos): suggest_help sweeps the day's chats; a hit
  // lands as a NEW CHAT (the priority channel), never in the list.
  const helpSweep = async () => (await import("../agent-proposals/index.js")).sweepSuggestHelpChats();
  registerTick("suggest-help-sweep", helpSweep);
  if (cronSource() !== "cloudflare") {
    cron.schedule("*/15 * * * *", () => { sweepResumes().catch((e) => console.warn("[self-tool-resumes] sweep failed:", e.message)); });
    cron.schedule("10 4 * * *", () => { archive().then((r) => r.archived && console.log(`[self-tooling] archived ${r.archived} unused tool(s)`)).catch((e) => console.warn("[self-tooling] archive failed:", e.message)); });
    cron.schedule("25 20 * * *", () => { toolIdeas().then((r) => r.suggested && console.log(`[self-tooling] suggested ${r.suggested} repeated-computation tool(s)`)).catch((e) => console.warn("[self-tooling] tool suggestions failed:", e.message)); });
    cron.schedule("30 20 * * *", () => { helpSweep().then((r) => r.filed && console.log(`[suggest-help-sweep] opened ${r.filed} new chat(s)`)).catch((e) => console.warn("[suggest-help-sweep] sweep failed:", e.message)); });
  }
}

export function startResumeWorker() {
  armSweep();
  if (worker) return worker;
  worker = handleBackground("self-tool-resumes", async (job) => runResume(job.data?.requestId), {
    concurrency: 2,
    onCompleted: (job, result) => workerJob("self-tool-resumes", "done", job, { resumed: result?.resumed ?? false, skipped: result?.skipped ?? false }),
    onFailed: (job, error) => {
      console.error(`[self-tool-resumes] failed job ${job?.id}:`, error.message);
      workerJob("self-tool-resumes", "failed", job, { error: error?.message });
    },
  });
  return worker;
}

export { runResume };
