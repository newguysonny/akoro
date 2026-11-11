/**
 * adaptive-learning/executionLog.js — Phase 22: the durable execution trace
 * (db half). Records the full path a turn takes — model decides → tool is
 * called → backend/DB succeeds or fails (with a classified error) → the loop
 * retries — so a failure or crash is debuggable AFTER the fact, and the
 * failure digest has real outcomes to learn from.
 *
 *   agent_runs        one row per turn (opened at start, closed at end; a crash
 *                     leaves it `running`, which the stale sweep marks
 *                     `incomplete`)
 *   agent_run_steps   one row per tool call (redacted input, status, error
 *                     class, short message, duration, retries)
 *
 * Privacy: OPS data, not learner data. Inputs are redacted/capped; raw results,
 * reasoning, secrets and answer keys are never stored. Writes are best-effort —
 * logging must never break a turn. The pure shaping lives in executionLogCore.js.
 */
import db from "../../db.js";
import { redactInput, stepRow } from "./executionLogCore.js";

export { redactValue, redactInput, classifyError, errorMessage, stepRow } from "./executionLogCore.js";

const edu = () => db.schema("edu");

/** Open a run for a turn. → run id, or null when logging is unavailable. */
export async function startRun({ sessionId = null, userId = null, model = null } = {}) {
  try {
    const { data, error } = await edu().from("agent_runs")
      .insert({ session_id: sessionId, user_id: userId, model: model ? String(model).slice(0, 60) : null, status: "running" })
      .select("id").single();
    if (error) return null;
    return data?.id || null;
  } catch { return null; }
}

/** Append one tool-call step to a run. Accepts raw fields or a shaped row. Best-effort. */
export async function recordStep(runId, step) {
  if (!runId || !step) return false;
  try {
    const row = step.status && step.tool ? step : stepRow({ runId, ...step });
    const { error } = await edu().from("agent_run_steps").insert({ ...row, run_id: runId });
    return !error;
  } catch { return false; }
}

/** Close a run (status ok|failed) and set the final step count. Best-effort. */
export async function finishRun(runId, { status = "ok", errorClass = null } = {}) {
  if (!runId) return false;
  try {
    const { count } = await edu().from("agent_run_steps")
      .select("id", { count: "exact", head: true }).eq("run_id", runId);
    const { error } = await edu().from("agent_runs")
      .update({ status, error_class: errorClass ? String(errorClass).slice(0, 60) : null, step_count: count ?? 0, finished_at: new Date().toISOString() })
      .eq("id", runId).eq("status", "running");
    return !error;
  } catch { return false; }
}

/** Mark runs that never finished (a crash mid-turn) so they are visible. → the affected rows. */
export async function sweepStaleRuns({ olderThanMs = 10 * 60_000 } = {}) {
  try {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const { data } = await edu().from("agent_runs")
      .update({ status: "incomplete", error_class: "crashed", finished_at: new Date().toISOString() })
      .eq("status", "running").lt("started_at", cutoff)
      .select("id, session_id, user_id, step_count");
    return data || [];
  } catch { return []; }
}

/**
 * Crash recovery (Phase 22): a turn that died mid-flight left the learner with
 * no reply and no explanation. Sweep stale runs, then post ONE interrupt notice
 * into the affected chat so the learner knows to retry (the sweep's
 * running→incomplete update returns each row only once, so this never repeats).
 * Best-effort; never throws.
 */
export async function recoverInterruptedRuns({ limit = 20, olderThanMs = 10 * 60_000 } = {}) {
  const stale = await sweepStaleRuns({ olderThanMs });
  if (!stale.length) return { swept: 0, notified: 0 };
  let postIntoChat = null;
  try { ({ postIntoChat } = await import("../self-tooling/escalation.js")); } catch { /* chat unavailable */ }
  let notified = 0;
  for (const r of stale.slice(0, limit)) {
    if (!r?.session_id || !r?.user_id || !postIntoChat) continue;
    try {
      await postIntoChat({
        userId: r.user_id,
        conversationId: r.session_id,
        title: "Your agent",
        text: "That reply was interrupted before it finished. Ask me again and I'll pick it up from there.",
        kind: "agent_interrupted",
      });
      notified += 1;
    } catch { /* best-effort */ }
  }
  return { swept: stale.length, notified };
}

/** One run plus its step path (the LLM → tool → DB trace). */
export async function getAgentRun(runId) {
  try {
    const { data: run } = await edu().from("agent_runs").select("*").eq("id", runId).maybeSingle();
    if (!run) return null;
    const { data: steps } = await edu().from("agent_run_steps").select("*")
      .eq("run_id", runId).order("created_at", { ascending: true }).limit(200);
    return { ...run, steps: steps || [] };
  } catch { return null; }
}

/** Recent runs, newest first (ops). */
export async function listRuns({ limit = 20 } = {}) {
  try {
    const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const { data } = await edu().from("agent_runs").select("*")
      .order("started_at", { ascending: false }).limit(n);
    return data || [];
  } catch { return []; }
}

/** Failed steps in a window — the failure digest's input. */
export async function recentFailures({ sinceMs = 24 * 60 * 60_000, limit = 500 } = {}) {
  try {
    const since = new Date(Date.now() - sinceMs).toISOString();
    const { data } = await edu().from("agent_run_steps")
      .select("tool, error_class, error_message, created_at")
      .eq("status", "failed").gte("created_at", since)
      .order("created_at", { ascending: false }).limit(limit);
    return data || [];
  } catch { return []; }
}

let maintenance = null;

/**
 * Start the background upkeep for the execution log: the stale-run sweep (so a
 * crashed turn becomes a visible `incomplete` row) and the hourly failure digest
 * (recurring failures → reusable lessons). Safe to call once at boot; unref'd so
 * it never holds the process open.
 */
export function startExecutionLogMaintenance({ sweepMs = 5 * 60_000, digestMs = 60 * 60_000 } = {}) {
  if (maintenance) return maintenance;
  let digestAt = 0;
  const tick = async () => {
    try { await recoverInterruptedRuns(); } catch { /* best-effort */ }
    if (Date.now() - digestAt >= digestMs) {
      digestAt = Date.now();
      try {
        const { runFailureDigest } = await import("./failureDigest.js");
        const d = await runFailureDigest();
        if (d?.storedId) console.log(`[execution-log] failure digest stored (${d.failureCount} failures, ${d.clusters.length} clusters)`);
      } catch { /* best-effort */ }
    }
  };
  maintenance = setInterval(tick, sweepMs);
  maintenance.unref?.();
  setTimeout(tick, 20_000).unref?.();
  return maintenance;
}
