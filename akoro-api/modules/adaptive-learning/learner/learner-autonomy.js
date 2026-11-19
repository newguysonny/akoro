/**
 * Learner-controlled, due-time autonomous task review.
 *
 * “Agent Online” is an explicit, persistent opt-in. The worker never carries
 * out a task or changes its completion state: when a pending task becomes due,
 * it creates one new Agent Chat that helps the learner begin. Switching the
 * header control Offline pauses future reviews immediately at the database
 * boundary; queued jobs remain harmless and exit after their authority check.
 */
import { randomUUID } from "node:crypto";
import { reportAgentActivity, clearAgentActivity } from "../../../lib/agentActivity.js";
import { backgroundQueue, handleBackground } from "../../../lib/backgroundQueue.js";
import { addLater } from "../../../lib/deferredJobs.js";

import db from "../../../db.js";
import { notifyUser } from "../../notify.js";
import { workerJob } from "../../../lib/workerLog.js";
import { buildAutonomyTaskMessage } from "./learner-autonomy-policy.js";
import { assertQueueCapacity } from "../../../lib/queueGuard.js";
import { appLink } from "../../../lib/urls.js";

const STALE_DELIVERY_MS = 5 * 60 * 1000;

let worker;

// The shared background queue (lib/backgroundQueue.js); a check-in due later
// than a few minutes waits in Postgres (lib/deferredJobs.js).
const autonomyQueue = () => backgroundQueue("learner-autonomy", {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 500 },
});

/** Due-task check-ins: the agent Online AND the learner's "Task check-ins" switch (§7.16.7). */
async function enabledFor(userId, { strict = false } = {}) {
  const { data, error } = await db.schema("edu").from("learner_agent_autonomy")
    .select("enabled, checkins, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error && strict) throw new Error("Could not load agent autonomy preference");
  return Boolean(data?.enabled) && data?.checkins !== false;
}

export async function getLearnerAutonomy(userId) {
  if (!userId) throw new Error("An authenticated learner is required");
  // level 1 = due-task check-ins (the original consent); level 2 = the
  // background planner may PROPOSE (docs/learner-full-autonomy-plan.md §6).
  const { data, error } = await db.schema("edu").from("learner_agent_autonomy")
    .select("enabled, level").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Could not load agent autonomy preference");
  return { enabled: Boolean(data?.enabled), level: data?.level ?? 1 };
}

function validDueAt(value) {
  const time = new Date(value || "");
  return Number.isFinite(time.getTime()) ? time : null;
}

async function queueReview(review) {
  const due = validDueAt(review.due_at);
  if (!due) throw new Error("Task has no valid due time");
  await assertQueueCapacity(autonomyQueue(), { name: "autonomy" });
  return addLater(autonomyQueue(), "review-due-task", {
    reviewId: review.id,
    revision: review.revision,
  }, {
    jobId: `learner-task-review-${review.task_id}-${review.revision}`,
    delay: Math.max(0, due.getTime() - Date.now()),
  });
}

/**
 * Schedule one due task only if this learner has explicitly put their agent
 * online. A revision makes off→on reactivation safe even when the old BullMQ
 * job has already completed while the agent was offline.
 */
export async function scheduleAutonomyReviewForTask(task) {
  if (!task?.id || !task?.creator_id || !task?.due_at || task.is_recurring || task.status !== "pending") return null;
  const due = validDueAt(task.due_at);
  if (!due || !await enabledFor(task.creator_id)) return null;

  const { data: existing, error: findError } = await db.schema("edu").from("learner_autonomy_task_reviews")
    .select("id, task_id, status, revision, due_at")
    .eq("task_id", task.id)
    .maybeSingle();
  if (findError) throw new Error("Could not prepare autonomous task review");

  let review;
  if (existing && ["delivering", "delivered"].includes(existing.status)) {
    // A completed task due event has one and only one proactive chat. Editing a
    // delivered task does not silently create another agent-initiated contact.
    return existing;
  }
  if (existing && existing.status === "scheduled" && new Date(existing.due_at).getTime() === due.getTime()) {
    return existing;
  }
  if (existing) {
    // A pending task's due time was edited, or its paused/failed review became
    // eligible after the learner put the agent Online. Advance the revision so
    // any stale BullMQ job cannot deliver at the old time.
    const { data, error } = await db.schema("edu").from("learner_autonomy_task_reviews")
      .update({
        status: "scheduled",
        due_at: due.toISOString(),
        revision: Number(existing.revision || 0) + 1,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error("Could not reactivate autonomous task review");
    review = data;
  } else {
    const row = {
      id: randomUUID(),
      task_id: task.id,
      user_id: task.creator_id,
      due_at: due.toISOString(),
      chat_session_id: randomUUID(),
      chat_message_id: randomUUID(),
      status: "scheduled",
      revision: 1,
    };
    const { data, error } = await db.schema("edu").from("learner_autonomy_task_reviews")
      .insert(row)
      .select("*")
      .single();
    if (error?.code === "23505") return scheduleAutonomyReviewForTask(task);
    if (error) throw new Error("Could not create autonomous task review");
    review = data;
  }

  try {
    await queueReview(review);
  } catch (error) {
    await db.schema("edu").from("learner_autonomy_task_reviews")
      .update({ status: "failed", last_error: String(error.message || "Queue unavailable").slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", review.id)
      .eq("status", "scheduled");
    throw new Error("Could not schedule autonomous task review");
  }
  return review;
}

/** Prevent a removed due time or a manually completed task from waking the agent. */
export async function cancelAutonomyReviewForTask({ taskId, userId }) {
  if (!taskId || !userId) return { cancelled: false };
  const { error } = await db.schema("edu").from("learner_autonomy_task_reviews")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("task_id", taskId)
    .eq("user_id", userId)
    .in("status", ["scheduled", "paused", "failed"]);
  if (error) throw new Error("Could not cancel autonomous task review");
  return { cancelled: true };
}

export async function schedulePendingAutonomyReviews(userId) {
  if (!userId || !await enabledFor(userId)) return { scheduled: 0 };
  const { data: tasks, error } = await db.from("tasks")
    .select("id, creator_id, title, description, priority, status, due_at, is_recurring")
    .eq("creator_id", userId)
    .eq("status", "pending")
    .not("due_at", "is", null);
  if (error) throw new Error("Could not load pending learner tasks");

  let scheduled = 0;
  for (const task of tasks || []) {
    try {
      const review = await scheduleAutonomyReviewForTask(task);
      if (review) scheduled += 1;
    } catch (error_) {
      // One corrupt/past task must not turn a learner's explicit opt-in off.
      console.warn("[learner-autonomy] schedule skipped:", error_.message);
    }
  }
  return { scheduled };
}

export async function setLearnerAutonomy({ userId, enabled, level }) {
  if (!userId || typeof enabled !== "boolean") throw new Error("A boolean enabled value is required");
  const now = new Date().toISOString();
  const patch = { user_id: userId, enabled, updated_at: now };
  if (Number.isInteger(level) && [1, 2].includes(level)) patch.level = level;
  const { error } = await db.schema("edu").from("learner_agent_autonomy").upsert(
    patch, { onConflict: "user_id" });
  if (error) throw new Error("Could not save agent autonomy preference");

  if (!enabled) {
    // The queue is deliberately not the source of truth. A worker which wakes
    // after this transition reads `paused`/the disabled preference and exits.
    await db.schema("edu").from("learner_autonomy_task_reviews")
      .update({ status: "paused", updated_at: now })
      .eq("user_id", userId)
      .eq("status", "scheduled");
    return { enabled: false, scheduled: 0, ...(patch.level && { level: patch.level }) };
  }

  const { scheduled } = await schedulePendingAutonomyReviews(userId);
  return { enabled: true, scheduled, ...(patch.level && { level: patch.level }) };
}

async function loadReview(reviewId) {
  const { data, error } = await db.schema("edu").from("learner_autonomy_task_reviews")
    .select("id, task_id, user_id, due_at, chat_session_id, chat_message_id, status, revision, updated_at")
    .eq("id", reviewId)
    .maybeSingle();
  if (error) throw new Error("Could not load autonomous task review");
  return data;
}

async function pauseReview(reviewId, expectedStatus) {
  await db.schema("edu").from("learner_autonomy_task_reviews")
    .update({ status: "paused", updated_at: new Date().toISOString() })
    .eq("id", reviewId)
    .eq("status", expectedStatus);
}

async function loadDueTask(taskId, userId) {
  const { data, error } = await db.from("tasks")
    .select("id, creator_id, title, description, priority, status, due_at, is_recurring")
    .eq("id", taskId)
    .eq("creator_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not load learner task for autonomous review");
  return data;
}

export async function deliverAutonomyReview({ reviewId, revision }) {
  let review = await loadReview(reviewId);
  if (!review || review.revision !== revision) return { skipped: true };
  if (review.status === "delivering") {
    const ageMs = Date.now() - new Date(review.updated_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs <= STALE_DELIVERY_MS) return { skipped: true };
    const { data: released, error } = await db.schema("edu").from("learner_autonomy_task_reviews")
      .update({ status: "scheduled", updated_at: new Date().toISOString() })
      .eq("id", review.id)
      .eq("status", "delivering")
      .select("id")
      .maybeSingle();
    if (error || !released) return { skipped: true };
    review = await loadReview(reviewId);
  }
  if (!review || review.status !== "scheduled" || !await enabledFor(review.user_id)) {
    if (review?.status === "scheduled") await pauseReview(review.id, "scheduled");
    return { skipped: true };
  }

  const task = await loadDueTask(review.task_id, review.user_id);
  if (!task || task.is_recurring || task.status !== "pending" || !validDueAt(task.due_at) || validDueAt(task.due_at).getTime() > Date.now()) {
    await db.schema("edu").from("learner_autonomy_task_reviews")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", review.id)
      .eq("status", "scheduled");
    return { skipped: true };
  }

  // The header stream: the learner sees what the agent is doing right now.
  reportAgentActivity(review.user_id, "Checking your schedule\u2026");
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await db.schema("edu").from("learner_autonomy_task_reviews")
    .update({ status: "delivering", updated_at: now })
    .eq("id", review.id)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (claimError || !claimed) return { skipped: true };
  if (!await enabledFor(review.user_id)) {
    await pauseReview(review.id, "delivering");
    return { skipped: true };
  }

  const title = `Task due: ${String(task.title || "Study task").slice(0, 60)}`;
  const message = buildAutonomyTaskMessage(task);
  const { error: sessionError } = await db.from("chat_sessions").upsert({
    id: review.chat_session_id,
    user_id: review.user_id,
    title,
    created_at: now,
    updated_at: now,
    last_message_at: now,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (sessionError) throw new Error("Could not create autonomous task chat");

  const { error: messageError } = await db.from("chat_messages").upsert({
    id: review.chat_message_id,
    session_id: review.chat_session_id,
    user_id: review.user_id,
    role: "agent",
    text: message,
    created_at: now,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (messageError) throw new Error("Could not create autonomous task message");

  clearAgentActivity(review.user_id);
  const { data: delivered, error: deliveryError } = await db.schema("edu").from("learner_autonomy_task_reviews")
    .update({ status: "delivered", delivered_at: now, last_error: null, updated_at: now })
    .eq("id", review.id)
    .eq("status", "delivering")
    .select("id")
    .maybeSingle();
  if (deliveryError) throw new Error("Could not complete autonomous task review");
  if (!delivered) return { skipped: true };

  const link = appLink(`tab=agent&sessionId=${encodeURIComponent(review.chat_session_id)}`);
  await notifyUser({
    userId: review.user_id,
    type: "agent_task_due",
    title: "Your agent found a task to start",
    content: message,
    relatedId: task.id,
    link,
  });
  try {
    global.io?.to(`user:${review.user_id}`).emit("agent_autonomy_task_ready", {
      taskId: task.id,
      sessionId: review.chat_session_id,
      title,
    });
  } catch { /* durable notification is the fallback */ }
  return { delivered: true, taskId: task.id, sessionId: review.chat_session_id };
}

export function startLearnerAutonomyWorker() {
  if (worker) return worker;
  worker = handleBackground("learner-autonomy", async (job) => {
    try {
      return await deliverAutonomyReview(job.data || {});
    } catch (error) {
      const reviewId = job.data?.reviewId;
      if (reviewId) {
        const finalAttempt = job.attemptsMade + 1 >= Number(job.opts.attempts || 1);
        await db.schema("edu").from("learner_autonomy_task_reviews")
          .update({
            status: finalAttempt ? "failed" : "scheduled",
            last_error: String(error.message || "Autonomous review failed").slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq("id", reviewId)
          // An identity/task read can fail before the atomic delivery claim;
          // leave an Offline pause untouched, but record retry exhaustion for
          // both pre-claim and in-progress failures.
          .in("status", ["scheduled", "delivering"]);
      }
      throw error;
    }
  }, {
    concurrency: 5,
    onCompleted: (job, result) => {
      console.log(`[learner-autonomy] completed job ${job.id}`);
      workerJob("learner-autonomy", "done", job, { skipped: result?.skipped ?? false, delivered: result?.delivered ?? false });
    },
    onFailed: (job, error) => {
      console.error(`[learner-autonomy] failed job ${job?.id}:`, error.message);
      workerJob("learner-autonomy", "failed", job, { error: error?.message });
    },
  });
  return worker;
}

/** Recover pending due tasks after an API restart without turning autonomy on. */
export async function recoverLearnerAutonomySchedules() {
  const { data, error } = await db.schema("edu").from("learner_agent_autonomy")
    .select("user_id")
    .eq("enabled", true);
  if (error) {
    // The generic message alone once hid the real cause (missing table) for a
    // whole boot cycle — surface the database's own reason verbatim.
    const reason = [error.code, error.message, error.details].filter(Boolean).join(" ") || String(error);
    throw new Error(`Could not recover learner autonomy schedules — ${reason}`);
  }
  let scheduled = 0;
  for (const row of data || []) {
    const result = await schedulePendingAutonomyReviews(row.user_id);
    scheduled += result.scheduled;
  }
  return scheduled;
}
