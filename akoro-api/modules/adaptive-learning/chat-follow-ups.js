/**
 * Durable, learner-owned agent chat follow-ups.
 *
 * The schedule is persisted before a delayed BullMQ job is created. At delivery
 * the worker creates a *new* persistent Agent Chat session, seeds its agent
 * message, and raises the normal in-app/socket/push notification. Deterministic
 * chat IDs stored on the schedule make a retry safe after a process crash.
 */
import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";

import db from "../../db.js";
import { notifyUser } from "../notify.js";
import { bullRedisOptions } from "../../lib/redisOptions.js";
import { validateFollowUpInput } from "./chat-follow-up-validation.js";

const QUEUE_NAME = "agent-chat-follow-ups";

let redis;
let workerRedis;
let queue;

function redisConnection() {
  if (redis) return redis;
  redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", bullRedisOptions);
  redis.on("error", (error) => console.error("[chat-follow-ups queue Redis]", error.message));
  return redis;
}

function workerRedisConnection() {
  if (workerRedis) return workerRedis;
  workerRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", bullRedisOptions);
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
export async function scheduleChatFollowUp({ userId, input }) {
  if (!userId) throw new Error("An authenticated learner is required");
  const validated = validateFollowUpInput(input);
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

async function loadScheduledFollowUp(followUpId) {
  const { data, error } = await db.schema("edu").from("scheduled_chat_follow_ups")
    .select("id, user_id, chat_session_id, chat_message_id, title, message, scheduled_at, status")
    .eq("id", followUpId)
    .maybeSingle();
  if (error) throw new Error("Could not load the scheduled chat follow-up");
  return data;
}

/** Exported for the worker and testable without a request context. */
export async function deliverChatFollowUp(followUpId) {
  const followUp = await loadScheduledFollowUp(followUpId);
  if (!followUp || followUp.status !== "scheduled") return { skipped: true };

  // These explicit IDs make every write idempotent. A retry can resume after
  // any boundary (session row, message row, or status update) without creating
  // a second chat or sending a second agent message.
  const now = new Date().toISOString();
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

  const { data: delivered, error: statusError } = await db.schema("edu").from("scheduled_chat_follow_ups")
    .update({ status: "delivered", delivered_at: now, updated_at: now, last_error: null })
    .eq("id", followUp.id)
    .eq("status", "scheduled")
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
      if (followUpId && job.attemptsMade + 1 >= Number(job.opts.attempts || 1)) {
        await db.schema("edu").from("scheduled_chat_follow_ups")
          .update({ status: "failed", last_error: String(error.message || "Delivery failed").slice(0, 500), updated_at: new Date().toISOString() })
          .eq("id", followUpId)
          .eq("status", "scheduled");
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
