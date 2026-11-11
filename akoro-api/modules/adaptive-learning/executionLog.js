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
import { redactInput, stepRow, canAutoRetry } from "./executionLogCore.js";

export { redactValue, redactInput, classifyError, errorMessage, stepRow, canAutoRetry } from "./executionLogCore.js";

const API_BASE = process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

const edu = () => db.schema("edu");

/** Open a run for a turn. → run id, or null when logging is unavailable. */
export async function startRun({ sessionId = null, userId = null, model = null, turnId = null } = {}) {
  try {
    const { data, error } = await edu().from("agent_runs")
      .insert({ session_id: sessionId, user_id: userId, model: model ? String(model).slice(0, 60) : null, status: "running",
        ...(turnId ? { turn_id: String(turnId).slice(0, 120) } : {}) })
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
      .select("id, session_id, user_id, step_count, turn_id, auto_retried_at");
    return data || [];
  } catch { return []; }
}

/** Mark a crashed run as auto-retried (once). → true when this call won the claim. */
async function markAutoRetried(runId) {
  try {
    const { data } = await edu().from("agent_runs")
      .update({ auto_retried_at: new Date().toISOString() })
      .eq("id", runId).is("auto_retried_at", null).select("id");
    return (data || []).length > 0;
  } catch { return false; }
}

/** Has this TURN already been auto-retried (by any run)? Prevents a retry loop when the retry itself crashes. */
async function alreadyAutoRetried(turnId) {
  if (!turnId) return false;
  try {
    const { data } = await edu().from("agent_runs").select("id")
      .eq("turn_id", turnId).not("auto_retried_at", "is", null).limit(1);
    return (data || []).length > 0;
  } catch { return true; }   // unknown → do not retry (safe default)
}

/** Re-run a crashed turn in-process (same turnId → the user message is reused, not duplicated). */
async function reRunCrashedTurn({ userId, conversationId, turnId, message }) {
  try {
    const { signInternalAccess } = await import("../auth/routes.js");
    const token = signInternalAccess({ id: userId, role: "student" }, 600);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000); timer.unref?.();
    const res = await fetch(`${API_BASE}/api/adaptive/chat/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message, conversationId, turnId }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    return res.ok;
  } catch { return false; }
}

/**
 * Crash recovery (Phase 22, build #1). For each turn the sweep just marked
 * `incomplete`:
 *   1. if it can be retried safely — the chat + turn ids are known, it has not
 *      been retried, and NO side-effecting step succeeded before the crash —
 *      re-run the SAME turn once in-process (the user message is reused, so it
 *      is not duplicated and no write can double-apply);
 *   2. otherwise post ONE interrupt notice into the chat so the learner can
 *      retry. The sweep's atomic running→incomplete update returns each row
 *      once, so neither happens twice. Best-effort; never throws.
 */
export async function recoverInterruptedRuns({ limit = 20, olderThanMs = 15 * 60_000 } = {}) {
  const stale = await sweepStaleRuns({ olderThanMs });
  if (!stale.length) return { swept: 0, retried: 0, notified: 0 };
  let postIntoChat = null;
  try { ({ postIntoChat } = await import("../self-tooling/escalation.js")); } catch { /* chat unavailable */ }
  let retried = 0, notified = 0;
  for (const run of stale.slice(0, limit)) {
    if (!run?.session_id || !run?.user_id) continue;
    let steps = [];
    try {
      const { data } = await edu().from("agent_run_steps").select("status, side_effecting").eq("run_id", run.id);
      steps = data || [];
    } catch { /* treat as unknown → no auto-retry */ }
    if (canAutoRetry({ run, steps }) && !(await alreadyAutoRetried(run.turn_id))) {
      let userMessage = null;
      try {
        const { data } = await db.from("chat_messages").select("text")
          .eq("session_id", run.session_id).eq("agent_turn_id", run.turn_id).eq("role", "user").maybeSingle();
        userMessage = data?.text || null;
      } catch { /* not persisted */ }
      if (userMessage && await markAutoRetried(run.id)) {
        if (await reRunCrashedTurn({ userId: run.user_id, conversationId: run.session_id, turnId: run.turn_id, message: userMessage })) {
          retried += 1;
          continue;
        }
      }
    }
    if (!postIntoChat) continue;
    try {
      await postIntoChat({
        userId: run.user_id,
        conversationId: run.session_id,
        title: "Your agent",
        text: "That reply was interrupted before it finished. Ask me again and I'll pick it up from there.",
        kind: "agent_interrupted",
      });
      notified += 1;
    } catch { /* best-effort */ }
  }
  return { swept: stale.length, retried, notified };
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
