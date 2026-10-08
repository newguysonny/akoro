// media-worker/src/jobs.js
//
// The in-container job registry. One instance runs few jobs at a time on
// purpose: a CPU-bound ffmpeg lane is worth serializing, and Cloudflare
// scales by adding CONTAINER instances (the edge wrapper fans out), not
// by packing one box. Each job: 202-accepted, runs async, snapshot-able.

import { randomUUID } from "node:crypto";

export const MAX_CONCURRENT_JOBS = Math.max(1, parseInt(process.env.MAX_CONCURRENT_JOBS ?? "1", 10));
const JOB_TTL_MS = 60 * 60 * 1000;   // finished jobs linger an hour for inspection
const MAX_RETAINED = 50;

const jobs = new Map();   // id → { id, kind, state, createdAt, startedAt, finishedAt, log[], result, error }

const snapshot = (j) => j && ({
  id: j.id, kind: j.kind, state: j.state,
  createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt,
  log: j.log.slice(-80), result: j.result, error: j.error,
});

function prune() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, j] of jobs) {
    if (j.state !== "running" && j.finishedAt && Date.parse(j.finishedAt) < cutoff) jobs.delete(id);
  }
  while (jobs.size > MAX_RETAINED) {
    const oldest = [...jobs.values()].filter((j) => j.state !== "running").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
    if (!oldest) break;
    jobs.delete(oldest.id);
  }
}

export function runningCount() {
  return [...jobs.values()].filter((j) => j.state === "running").length;
}

/** Can another job start? 409-shaped answer when the lane is full. */
export function tryClaimSlot() {
  if (runningCount() >= MAX_CONCURRENT_JOBS) return null;
  const id = randomUUID();
  jobs.set(id, { id, state: "running", createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), log: [], result: null, error: null });
  prune();
  return id;
}

/**
 * Start a job. runner receives ({ onLog, onProgress }) and returns the
 * result object; a throw records state=failed with the message.
 */
export function startJob(kind, runner) {
  const id = tryClaimSlot();
  if (!id) return { id: null, busy: [...jobs.values()].filter((j) => j.state === "running").map((j) => j.id) };
  const job = jobs.get(id);
  Promise.resolve()
    .then(() => runner({
      onLog: (line) => job.log.push(String(line).slice(0, 300)),
      onProgress: async (pct) => { job.progress = Math.max(0, Math.min(100, Number(pct) || 0)); },
    }))
    .then((result) => { job.result = result ?? {}; job.state = "done"; })
    .catch((err) => {
      job.log.push(`FAILED: ${String(err?.message || err).slice(0, 300)}`);
      job.error = String(err?.message || err).slice(0, 300);
      job.state = "failed";
    })
    .finally(() => { job.finishedAt = new Date().toISOString(); });
  return { id, busy: null };
}

export const getJob = (id) => snapshot(jobs.get(String(id || "")));
export const listJobs = () => [...jobs.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 20).map(snapshot);
