/**
 * Durable, learner-owned agent chat follow-ups.
 *
 * The schedule is persisted before a delayed BullMQ job is created. At delivery
 * the worker creates a *new* persistent Agent Chat session, seeds its agent
 * message, and raises the normal in-app/socket/push notification. Deterministic
 * chat IDs stored on the schedule make a retry safe after a process crash.
 */
import { randomUUID } from "node:crypto";
import { reportAgentActivity, clearAgentActivity } from "../../lib/agentActivity.js";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";

import db from "../../db.js";
import { notifyUser } from "../notify.js";
import { redisConnectionOptions } from "../../lib/redisOptions.js";
import { validateFollowUpId, validateFollowUpInput } from "./chat-follow-up-validation.js";

const QUEUE_NAME = "agent-chat-follow-ups";
const STALE_DELIVERY_MS = 5 * 60 * 1000;

let redis;
let workerRedis;
let queue;

function redisConnection() {
  if (redis) return redis;
  redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label: "chat-follow-ups" }));
  redis.on("error", (error) => console.error("[chat-follow-ups queue Redis]", error.message));
  return redis;
}

function workerRedisConnection() {
  if (workerRedis) return workerRedis;
  workerRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label: "chat-follow-ups" }));
  workerRedis.on("error", (error) => console.error("[chat-follow-ups worker Redis]", error.message));
  return workerRedis;
}

function chatFollowUpQueue() {
  if (queue) return queue;
  queue = new Queue(QUEUE_NAME, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  });
  return queue;
}

/**
 * Schedule a new Agent Chat conversation for the authorised learner. The user
 * is always supplied by the verified gateway capability, never tool arguments.
 */
export async function scheduleChatFollowUp({ userId, input, defaultTimezone }) {
  if (!userId) throw new Error("An authenticated learner is required");
  const validated = validateFollowUpInput(input, { defaultTimezone });
  const id = randomUUID();
  const chatSessionId = randomUUID();
  const chatMessageId = randomUUID();
  const row = {
    id,
    user_id: userId,
    chat_session_id: chatSessionId,
    chat_message_id: chatMessageId,
    title: validated.title,
    message: validated.message,
    timezone: validated.timezone,
    scheduled_at: validated.scheduledAt,
    status: "scheduled",
  };
  const { error: insertError } = await db.schema("edu").from("scheduled_chat_follow_ups").insert(row);
  if (insertError) throw new Error("Could not save the scheduled chat follow-up");

  try {
    await chatFollowUpQueue().add("deliver-chat-follow-up", { followUpId: id }, {
      jobId: `chat-follow-up-${id}`,
      delay: validated.delayMs,
    });
  } catch (error) {
    // There is no valid schedule without a durable queue job. Deleting the row
    // avoids silently promising a message that no worker can deliver.
    await db.schema("edu").from("scheduled_chat_follow_ups").delete().eq("id", id).eq("status", "scheduled");
    throw new Error("Could not schedule the follow-up delivery");
  }

  return {
    followUpId: id,
    scheduledAt: validated.scheduledAt,
    timezone: validated.timezone,
    title: validated.title,
  };
}

/** Read only future deliveries for the signed-in learner (never another user). */
export async function listChatFollowUps({ userId }) {
  if (!userId) throw new Error("An authenticated learner is required");
  const { data, error } = await db.schema("edu").from("scheduled_chat_follow_ups")
    .select("id, title, message, timezone, scheduled_at, status, created_at")
    .eq("user_id", userId)
    .in("status", ["scheduled", "delivering"])
    .order("scheduled_at", { ascending: true })
    .limit(20);
  if (error) throw new Error("Could not load scheduled chat follow-ups");
  return {
    followUps: (data || []).map((row) => ({
      followUpId: row.id,
      title: row.title,
      message: row.message,
      timezone: row.timezone,
      scheduledAt: row.scheduled_at,
      status: row.status,
      createdAt: row.created_at,
    })),
  };
}

/**
 * Cancel a pending delivery. The status update wins the race against a worker
 * claim; once a job has moved to `delivering`, it is intentionally no longer
 * reported as cancelled because a chat may already have been created.
 */
export async function cancelChatFollowUp({ userId, followUpId }) {
  if (!userId) throw new Error("An authenticated learner is required");
  const id = validateFollowUpId(followUpId);
  const now = new Date().toISOString();
  const { data: cancelled, error } = await db.schema("edu").from("scheduled_chat_follow_ups")
    .update({ status: "cancelled", updated_at: now })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .select("id, scheduled_at")
    .maybeSingle();
  if (error) throw new Error("Could not cancel the scheduled chat follow-up");
  if (!cancelled) {
    const { data: existing, error: lookupError } = await db.schema("edu").from("scheduled_chat_follow_ups")
      .select("status")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (lookupError) throw new Error("Could not cancel the scheduled chat follow-up");
    if (!existing) throw new Error("Scheduled chat follow-up was not found");
    if (existing.status === "cancelled") return { cancelled: true, alreadyCancelled: true, followUpId: id };
    throw new Error("This scheduled chat is already being delivered or has been delivered");
  }

  // Removing the delayed job saves queue work, but the database status is the
  // authority: if Redis is briefly unavailable, the worker will still skip it.
  try {
    const job = await chatFollowUpQueue().getJob(`chat-follow-up-${id}`);
    if (job) await job.remove();
  } catch (error_) {
    console.warn("[chat-follow-ups] cancelled schedule has a stale queue job:", error_.message);
  }
  return { cancelled: true, followUpId: id, scheduledAt: cancelled.scheduled_at };
}

async function loadScheduledFollowUp(followUpId) {
  const { data, error } = await db.schema("edu").from("scheduled_chat_follow_ups")
    .select("id, user_id, chat_session_id, chat_message_id, title, message, scheduled_at, status, updated_at")
    .eq("id", followUpId)
    .maybeSingle();
  if (error) throw new Error("Could not load the scheduled chat follow-up");
  return data;
}

/** Exported for the worker and testable without a request context. */
export async function deliverChatFollowUp(followUpId) {
  let followUp = await loadScheduledFollowUp(followUpId);
  if (!followUp) return { skipped: true };
  if (followUp.status === "delivering") {
    const ageMs = Date.now() - new Date(followUp.updated_at).getTime();
    if (Number.isFinite(ageMs) && ageMs > STALE_DELIVERY_MS) {
      const { data: released, error } = await db.schema("edu").from("scheduled_chat_follow_ups")
        .update({ status: "scheduled", updated_at: new Date().toISOString() })
        .eq("id", followUp.id)
        .eq("status", "delivering")
        .select("id")
        .maybeSingle();
      if (error) throw new Error("Could not recover the scheduled chat follow-up");
      if (!released) return { skipped: true };
      followUp = await loadScheduledFollowUp(followUpId);
    } else {
      return { skipped: true };
    }
  }
  if (followUp?.status !== "scheduled") return { skipped: true };

  // Atomically claim the row before writing a chat. Cancellation races this
  // same `scheduled` condition, so exactly one operation wins.
  // The header stream: the learner sees what the agent is doing right now.
  reportAgentActivity(followUp.user_id, "Preparing a check-in for you\u2026");
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await db.schema("edu").from("scheduled_chat_follow_ups")
    .update({ status: "delivering", updated_at: now })
    .eq("id", followUp.id)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error("Could not claim the scheduled chat follow-up");
  if (!claimed) return { skipped: true };

  // These explicit IDs make every write idempotent. A retry can resume after
  // any boundary (session row, message row, or status update) without creating
  // a second chat or sending a second agent message.
  const { error: sessionError } = await db.from("chat_sessions").upsert({
    id: followUp.chat_session_id,
    user_id: followUp.user_id,
    title: followUp.title,
    created_at: now,
    updated_at: now,
    last_message_at: now,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (sessionError) throw new Error("Could not create the follow-up chat session");

  const { error: messageError } = await db.from("chat_messages").upsert({
    id: followUp.chat_message_id,
    session_id: followUp.chat_session_id,
    user_id: followUp.user_id,
    role: "agent",
    text: followUp.message,
    created_at: now,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (messageError) throw new Error("Could not create the follow-up chat message");

  clearAgentActivity(followUp.user_id);
  const { data: delivered, error: statusError } = await db.schema("edu").from("scheduled_chat_follow_ups")
    .update({ status: "delivered", delivered_at: now, updated_at: now, last_error: null })
    .eq("id", followUp.id)
    .eq("status", "delivering")
    .select("id")
    .maybeSingle();
  if (statusError) throw new Error("Could not complete the scheduled chat follow-up");
  if (!delivered) return { skipped: true };

  const link = `/app?tab=agent&sessionId=${encodeURIComponent(followUp.chat_session_id)}`;
  await notifyUser({
    userId: followUp.user_id,
    type: "agent_follow_up",
    title: followUp.title,
    content: followUp.message,
    relatedId: followUp.chat_session_id,
    link,
  });
  try {
    global.io?.to(`user:${followUp.user_id}`).emit("chat_follow_up_ready", {
      followUpId: followUp.id,
      sessionId: followUp.chat_session_id,
      title: followUp.title,
    });
  } catch { /* notification already provides the durable delivery path */ }
  return { delivered: true, sessionId: followUp.chat_session_id };
}

let worker;

/** Start once from app.js; workers never run in a browser process. */
export function startChatFollowUpWorker() {
  if (worker) return worker;
  worker = new Worker(QUEUE_NAME, async (job) => {
    try {
      return await deliverChatFollowUp(job.data?.followUpId);
    } catch (error) {
      const followUpId = job.data?.followUpId;
      if (followUpId) {
        const finalAttempt = job.attemptsMade + 1 >= Number(job.opts.attempts || 1);
        await db.schema("edu").from("scheduled_chat_follow_ups")
          .update({
            status: finalAttempt ? "failed" : "scheduled",
            last_error: String(error.message || "Delivery failed").slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq("id", followUpId)
          .eq("status", "delivering");
      }
      throw error;
    }
  }, {
    connection: workerRedisConnection(),
    concurrency: 5,
    drainDelay: 60,
    settings: { stalledInterval: 300_000 },
  });
  worker.on("completed", (job) => console.log(`[chat-follow-ups] delivered job ${job.id}`));
  worker.on("failed", (job, error) => console.error(`[chat-follow-ups] failed job ${job?.id}:`, error.message));
  return worker;
}
