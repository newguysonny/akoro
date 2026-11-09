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
import { backgroundQueue, handleBackground } from "../../lib/backgroundQueue.js";
import { addLater, cancelLater } from "../../lib/deferredJobs.js";

import db from "../../db.js";
import { notifyUser } from "../notify.js";
import { workerJob } from "../../lib/workerLog.js";
import { validateFollowUpId, validateFollowUpInput, nextOccurrence } from "./chat-follow-up-validation.js";
import { assertQueueCapacity } from "../../lib/queueGuard.js";
import { appLink } from "../../lib/urls.js";

const STALE_DELIVERY_MS = 5 * 60 * 1000;

// The shared background queue (lib/backgroundQueue.js); a far-off delivery
// waits in Postgres until shortly before it is due (lib/deferredJobs.js).
const chatFollowUpQueue = () => backgroundQueue("chat-follow-ups", {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 500 },
});

/**
 * Schedule a new Agent Chat conversation for the authorised learner. The user
 * is always supplied by the verified gateway capability, never tool arguments.
 */
export async function scheduleChatFollowUp({ userId, input, defaultTimezone, targetSessionId = null }) {
  if (!userId) throw new Error("An authenticated learner is required");
  const validated = validateFollowUpInput(input, { defaultTimezone });
  const id = randomUUID();
  // Into an EXISTING chat of theirs ("send it here", or a chat they named), or
  // a new one. The caller has checked the chat belongs to this learner.
  const chatSessionId = targetSessionId || randomUUID();
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
    // Only when used: a plain one-off never depends on the repeating columns.
    ...(validated.repeat ? { repeat: validated.repeat, repeat_until: validated.repeatUntil, series_id: id } : {}),
    ...(validated.everySeconds ? { every_seconds: validated.everySeconds } : {}),
    ...(validated.runTool ? { run_tool: validated.runTool } : {}),
  };
  await insertAndQueue(row, validated.delayMs);
  return {
    followUpId: id,
    scheduledAt: validated.scheduledAt,
    timezone: validated.timezone,
    title: validated.title,
    ...(validated.repeat ? { repeat: validated.repeat, repeatUntil: validated.repeatUntil } : {}),
    ...(validated.everySeconds ? { everySeconds: validated.everySeconds } : {}),
    ...(validated.runTool ? { runTool: validated.runTool } : {}),
  };
}

/** Save the schedule, then its durable queue job — or neither. */
async function insertAndQueue(row, delayMs) {
  const { error: insertError } = await db.schema("edu").from("scheduled_chat_follow_ups").insert(row);
  if (insertError) throw new Error("Could not save the scheduled chat follow-up");
  try {
    await assertQueueCapacity(chatFollowUpQueue(), { name: "followups" });
    await addLater(chatFollowUpQueue(), "deliver-chat-follow-up", { followUpId: row.id }, {
      jobId: `chat-follow-up-${row.id}`,
      delay: Math.max(0, delayMs),
    });
  } catch (error) {
    // There is no valid schedule without a durable queue job. Deleting the row
    // avoids silently promising a message that no worker can deliver.
    await db.schema("edu").from("scheduled_chat_follow_ups").delete().eq("id", row.id).eq("status", "scheduled");
    throw new Error("Could not schedule the follow-up delivery");
  }
}

/** PURE: a tool's rows as a short plain list for a chat message. */
export function formatToolRows(out, { max = 12 } = {}) {
  const rows = Array.isArray(out?.rows) ? out.rows : [];
  if (!rows.length) return "Nothing to list today.";
  const line = (r) => {
    if (r == null || typeof r !== "object") return `- ${String(r)}`;
    const vals = Object.values(r).filter((v) => v != null && v !== "").map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)));
    return `- ${vals.join(" · ").slice(0, 160)}`;
  };
  const shown = rows.slice(0, max).map(line);
  const more = (out.total || rows.length) - shown.length;
  return [...shown, ...(more > 0 ? [`…and ${more} more.`] : [])].join("\n");
}

/** Run the learner's own read tool for a check-in; null text when it can't run (the message still goes). */
async function freshToolText(followUp) {
  if (!followUp.run_tool) return null;
  try {
    const { runLearnerTool } = await import("../self-tooling/pipeline.js");
    const { selfToolDeps } = await import("./chat.js");
    const out = await runLearnerTool(followUp.run_tool, {}, followUp.user_id, {
      callCapability: selfToolDeps(followUp.user_id).callCapability, conversationId: followUp.chat_session_id, dry: true,
    });
    if (!out || out.error) return `(I couldn't refresh "${followUp.run_tool}" today${out?.error ? `: ${out.error}` : ""}.)`;
    if (out.status || out.action) return null;   // a change tool never runs from a schedule
    return `**${out.tool || "Today"}**\n${formatToolRows(out)}`;
  } catch (e) {
    return `(I couldn't refresh today's list: ${String(e?.message || e).slice(0, 120)}.)`;
  }
}

/** A repeating check-in: schedule the next one in the same chat (idempotent per occurrence). */
async function scheduleNextInSeries(followUp) {
  if (!followUp.repeat) return null;
  const next = nextOccurrence({ scheduledAt: followUp.scheduled_at, repeat: followUp.repeat, repeatUntil: followUp.repeat_until, everySeconds: followUp.every_seconds, timezone: followUp.timezone });
  if (!next) return null;
  const seriesId = followUp.series_id || followUp.id;
  // One pending occurrence per series: a retried delivery must not chain twice.
  const { data: pending } = await db.schema("edu").from("scheduled_chat_follow_ups").select("id")
    .eq("series_id", seriesId).eq("status", "scheduled").limit(1);
  if (pending?.length) return pending[0].id;
  const row = {
    id: randomUUID(), user_id: followUp.user_id, chat_session_id: followUp.chat_session_id, chat_message_id: randomUUID(),
    title: followUp.title, message: followUp.message, timezone: followUp.timezone, scheduled_at: next, status: "scheduled",
    repeat: followUp.repeat, repeat_until: followUp.repeat_until, series_id: seriesId,
    ...(followUp.every_seconds ? { every_seconds: followUp.every_seconds } : {}),
    ...(followUp.run_tool ? { run_tool: followUp.run_tool } : {}),
  };
  await insertAndQueue(row, new Date(next).getTime() - Date.now());
  return row.id;
}

/** Read only future deliveries for the signed-in learner (never another user). */
export async function listChatFollowUps({ userId }) {
  if (!userId) throw new Error("An authenticated learner is required");
  const { data, error } = await db.schema("edu").from("scheduled_chat_follow_ups")
    .select("*")
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
      ...(row.repeat ? { repeat: row.repeat, repeatUntil: row.repeat_until, note: "Repeating: cancelling this one ends the series." } : {}),
      ...(row.run_tool ? { runTool: row.run_tool } : {}),
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
    await cancelLater(chatFollowUpQueue(), `chat-follow-up-${id}`);
    const job = await chatFollowUpQueue().getJob(`chat-follow-up-${id}`);
    if (job) await job.remove();
  } catch (error_) {
    console.warn("[chat-follow-ups] cancelled schedule has a stale queue job:", error_.message);
  }
  return { cancelled: true, followUpId: id, scheduledAt: cancelled.scheduled_at };
}

async function loadScheduledFollowUp(followUpId) {
  const { data, error } = await db.schema("edu").from("scheduled_chat_follow_ups")
    .select("*")
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

  // A check-in with a tool carries today's answer, not a stale copy.
  const fresh = await freshToolText(followUp);
  const text = fresh ? `${followUp.message}\n\n${fresh}` : followUp.message;
  const { error: messageError } = await db.from("chat_messages").upsert({
    id: followUp.chat_message_id,
    session_id: followUp.chat_session_id,
    user_id: followUp.user_id,
    role: "agent",
    text,
    created_at: now,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (messageError) throw new Error("Could not create the follow-up chat message");
  // Delivered into an existing chat: bring it to the top of their list.
  await db.from("chat_sessions").update({ updated_at: now, last_message_at: now }).eq("id", followUp.chat_session_id).eq("user_id", followUp.user_id).then(() => {}, () => {});

  clearAgentActivity(followUp.user_id);
  const { data: delivered, error: statusError } = await db.schema("edu").from("scheduled_chat_follow_ups")
    .update({ status: "delivered", delivered_at: now, updated_at: now, last_error: null })
    .eq("id", followUp.id)
    .eq("status", "delivering")
    .select("id")
    .maybeSingle();
  if (statusError) throw new Error("Could not complete the scheduled chat follow-up");
  if (!delivered) return { skipped: true };

  // Repeating: the next one is scheduled now. A failure here is logged, never undoes this delivery.
  let nextId = null;
  try { nextId = await scheduleNextInSeries(followUp); }
  catch (e) { console.warn("[chat-follow-ups] next in series not scheduled:", e?.message || e); }

  const link = appLink(`tab=agent&sessionId=${encodeURIComponent(followUp.chat_session_id)}`);
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
  return { delivered: true, sessionId: followUp.chat_session_id, ...(nextId ? { nextFollowUpId: nextId } : {}) };
}

let worker;

/** Start once from app.js; workers never run in a browser process. */
export function startChatFollowUpWorker() {
  if (worker) return worker;
  worker = handleBackground("chat-follow-ups", async (job) => {
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
    concurrency: 5,
    onCompleted: (job, result) => {
      console.log(`[chat-follow-ups] delivered job ${job.id}`);
      workerJob("chat-follow-ups", "done", job, { skipped: result?.skipped ?? false, delivered: result?.delivered ?? false });
    },
    onFailed: (job, error) => {
      console.error(`[chat-follow-ups] failed job ${job?.id}:`, error.message);
      workerJob("chat-follow-ups", "failed", job, { error: error?.message });
    },
  });
  return worker;
}
