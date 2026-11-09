/**
 * workers/sessionNotifier.js — live-session reminders (24 h, 1 h, 10 min).
 *
 *   scheduleSessionReminders({ sessionId, scheduledStart, … })   when a session
 *     is created or moved. A reminder due more than 10 minutes out waits in
 *     Postgres and is released shortly before it is due (lib/deferredJobs.js),
 *     so no worker polls Redis for a reminder a day away.
 *   cancelSessionReminders(sessionId)   when a session is cancelled or deleted.
 *   startSessionNotifier()              once at boot (app.js): the worker.
 *
 * When a reminder fires, the session is read again: a cancelled, ended or
 * rescheduled session sends nothing (a moved session has its own, newer
 * reminders), and the recipients are the course's learners as they are now —
 * someone who enrolled after the session was scheduled is reminded too.
 */
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import db from "../db.js";
import { sendSessionNotifications } from "../services/notificationService.js";
import { redisConnectionOptions } from "../lib/redisOptions.js";
import { traceRedis } from "../lib/redisTrace.js";
import { guardWorker } from "../lib/redisQuotaGuard.js";
import { workerJob } from "../lib/workerLog.js";
import { addLater, registerDeferredQueue } from "../lib/deferredJobs.js";
import { reminderPlan, staleReason } from "./sessionReminders.js";

const QUEUE_NAME = "session-notifications";
let queueRedis, workerRedis, queue, worker;

const connection = (label) => {
  const r = traceRedis(new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label })), label);
  r.on("error", (err) => console.error(`[${label} Redis]`, err.message));
  return r;
};

export function sessionQueue() {
  if (queue) return queue;
  queueRedis ||= connection("session-notifier");
  queue = new Queue(QUEUE_NAME, {
    connection: queueRedis,
    defaultJobOptions: {
      attempts:         3,
      backoff:          { type: "exponential", delay: 60_000 },
      removeOnComplete: { count: 20 },
      removeOnFail:     { count: 500 },
    },
  });
  registerDeferredQueue(queue);
  return queue;
}

/** Queue the reminders still ahead for a session. Never throws: a reminder is not worth failing the request over. → number queued */
export async function scheduleSessionReminders({ sessionId, scheduledStart, courseTitle = null, sessionTitle = null, meetingUrl = null }) {
  let n = 0;
  for (const r of reminderPlan(sessionId, scheduledStart)) {
    try {
      await addLater(sessionQueue(), r.type,
        { type: r.type, sessionId, scheduledStart, courseTitle, sessionTitle, meetingUrl },
        { delay: r.delayMs, jobId: r.jobId });   // the id carries the start time: one reminder per type per start
      n++;
    } catch (e) {
      console.warn(`[sessionNotifier] could not schedule ${r.type} for session ${sessionId}:`, e.message);
    }
  }
  if (n) console.log(`[sessionNotifier] scheduled ${n} reminder(s) for session ${sessionId}`);
  return n;
}

/** Drop a session's waiting reminders (any already in Redis skip themselves: the session is no longer scheduled). */
export async function cancelSessionReminders(sessionId) {
  if (!sessionId) return 0;
  const { data, error } = await db.schema("edu").from("deferred_jobs").delete()
    .eq("queue", QUEUE_NAME).like("job_key", `%-${sessionId}-%`).select("id");
  if (error) console.warn("[sessionNotifier] cancel failed:", error.message);
  return (data || []).length;
}

/** The learners a reminder goes to now: the course's active enrolments. */
async function recipientIds(session, fallback = []) {
  if (!session.course_id) return fallback;
  const { data } = await db.from("enrollments").select("user_id").eq("course_id", session.course_id).eq("status", "active");
  const ids = (data ?? []).map((e) => e.user_id);
  return ids.length ? ids : fallback;
}

async function deliver(job) {
  const { type, sessionId, scheduledStart } = job.data;
  const { data: session } = await db.from("live_sessions")
    .select("id, title, status, scheduled_start, course_id, meeting_url")
    .eq("id", sessionId).maybeSingle();
  const stale = staleReason(session, scheduledStart);
  if (stale) return { notified: 0, skipped: stale };

  const ids = await recipientIds(session, job.data.participantIds ?? []);
  const { data: participants, error } = ids.length
    ? await db.from("users")
      .select(`
        id, email, full_name, phone,
        user_notification_preferences (
          email_enabled, sms_enabled, push_enabled, whatsapp_enabled,
          phone_number, whatsapp_number, push_token,
          notify_session_reminders, notify_session_started
        )
      `)
      .in("id", ids)
    : { data: [], error: null };
  if (error) throw new Error(`Failed to fetch participants: ${error.message}`);

  // Users who switched session reminders off are skipped.
  const filtered = (participants ?? []).filter((p) => {
    const prefs = p.user_notification_preferences?.[0];
    if (!prefs) return true;
    if (type.startsWith("reminder") && !prefs.notify_session_reminders) return false;
    if (type === "session_started" && !prefs.notify_session_started) return false;
    return true;
  }).map((p) => ({
    user_id:     p.id,
    email:       p.email,
    full_name:   p.full_name,
    phone:       p.phone,
    preferences: p.user_notification_preferences?.[0] ?? null,
  }));
  if (!filtered.length) return { notified: 0, skipped: "no_recipients" };

  let courseTitle = job.data.courseTitle;
  if (!courseTitle && session.course_id) {
    const { data: c } = await db.from("courses").select("title").eq("id", session.course_id).maybeSingle();
    courseTitle = c?.title ?? null;
  }
  await sendSessionNotifications({
    type,
    sessionId,
    courseTitle,
    sessionTitle: session.title ?? job.data.sessionTitle,
    meetingUrl:   session.meeting_url ?? job.data.meetingUrl,
    participants: filtered,
  });

  const flag = {
    reminder_24h:    { reminder_sent_24h: true },
    reminder_1h:     { reminder_sent_1h: true },
    reminder_10min:  { reminder_sent_10min: true },
    session_started: { started_notification_sent: true },
  }[type];
  if (flag) await db.from("live_sessions").update({ ...flag, updated_at: new Date().toISOString() }).eq("id", sessionId);
  return { notified: filtered.length };
}

/** Start the worker once (app.js at boot). */
export function startSessionNotifier() {
  if (worker) return worker;
  sessionQueue();   // registered for deferred releases from boot, not from the first new session
  workerRedis ||= connection("session-notifier-worker");
  worker = new Worker(QUEUE_NAME, deliver, {
    connection:  workerRedis,
    concurrency: 5,
    limiter:     { max: 100, duration: 60_000 },   // 100 jobs/min: email/SMS providers throttle
    drainDelay:  300,
    stalledInterval: 300_000,   // top level — BullMQ ignores it inside `settings`
  });
  guardWorker(worker, "session notifier");
  worker.on("completed", (job, result) => workerJob("session-notifier", "done", job, { notified: result?.notified ?? 0, skipped: result?.skipped ?? null }));
  worker.on("failed", (job, err) => {
    console.error(`[sessionNotifier] job ${job?.id} failed:`, err.message);
    workerJob("session-notifier", "failed", job, { error: err?.message });
  });
  return worker;
}
