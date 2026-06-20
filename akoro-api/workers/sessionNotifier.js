/**
 * workers/sessionNotifier.js  —  Piabam Session Notification Worker
 *
 * Runs on: Railway (same process as API — lightweight job scheduler)
 *
 * Responsibilities:
 *   - Schedule 24h, 1h, 10min reminder jobs when a session is created
 *   - Process each reminder job → fetch participants → dispatch via notificationService
 *   - Rate-limited to 100 notifications/min to avoid Twilio/SMTP throttling
 *
 * Imported by live-sessions.js (producer) and self-starts the consumer on import.
 *
 * Usage in app.js (auto-started on import via live-sessions.js):
 *   No direct import needed — live-sessions.js imports sessionQueue from here.
 */

import { Queue, Worker, QueueEvents } from "bullmq";
import Redis                          from "ioredis";
import db                             from "../db.js";
import { sendSessionNotifications }   from "../services/notificationService.js";

const redisConn = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

// ─── Queue (producer side — imported by live-sessions.js) ────────────────────

export const sessionQueue = new Queue("session-notifications", {
  connection: redisConn,
  defaultJobOptions: {
    attempts:         3,
    backoff:          { type: "exponential", delay: 60_000 },
    removeOnComplete: { count: 200 },
    removeOnFail:     { count: 500 },
  },
});

/**
 * scheduleSessionReminders
 * Queues 24h, 1h, and 10min reminder jobs with BullMQ delay.
 * Called by live-sessions.js after a session is created.
 */
export const scheduleSessionReminders = async ({
  sessionId, scheduledStart, courseTitle, sessionTitle,
  meetingUrl, participantIds = [],
}) => {
  const start  = new Date(scheduledStart);
  const nowMs  = Date.now();

  const reminders = [
    { type: "reminder_24h",   offset: 24 * 60 * 60 * 1000 },
    { type: "reminder_1h",    offset: 60 * 60 * 1000       },
    { type: "reminder_10min", offset: 10 * 60 * 1000       },
  ];

  for (const { type, offset } of reminders) {
    const sendAt  = start.getTime() - offset;
    const delayMs = sendAt - nowMs;

    if (delayMs > 0) {
      await sessionQueue.add(
        type,
        { type, sessionId, courseTitle, sessionTitle, meetingUrl, participantIds },
        { delay: delayMs, jobId: `${type}-${sessionId}` }   // jobId deduplicates
      );
      console.log(`[sessionNotifier] ⏰ Scheduled ${type} for session=${sessionId} in ${Math.round(delayMs / 60000)} min`);
    }
  }
};

// ─── Worker (consumer side — processes reminder jobs) ────────────────────────

const worker = new Worker(
  "session-notifications",

  async (job) => {
    const { type, sessionId, courseTitle, sessionTitle, meetingUrl, participantIds } = job.data;
    console.log(`[sessionNotifier] 📨 Processing ${type}  session=${sessionId}  participants=${participantIds?.length ?? 0}`);

    // Fetch participant details from Supabase
    const { data: participants, error } = await db
      .from("users")
      .select(`
        id, email, full_name, phone,
        user_notification_preferences (
          email_enabled, sms_enabled, push_enabled, whatsapp_enabled,
          phone_number, whatsapp_number, push_token,
          notify_session_reminders, notify_session_started
        )
      `)
      .in("id", participantIds ?? []);

    if (error) throw new Error(`Failed to fetch participants: ${error.message}`);

    // Filter by preference — skip users who opted out of reminders
    const filtered = (participants ?? []).filter((p) => {
      const prefs = p.user_notification_preferences?.[0];
      if (!prefs) return true;   // default: send
      if (type.startsWith("reminder") && !prefs.notify_session_reminders) return false;
      if (type === "session_started"  && !prefs.notify_session_started)   return false;
      return true;
    }).map((p) => ({
      user_id:     p.id,
      email:       p.email,
      full_name:   p.full_name,
      phone:       p.phone,
      preferences: p.user_notification_preferences?.[0] ?? null,
    }));

    if (!filtered.length) {
      console.log(`[sessionNotifier] ℹ️  No eligible participants for ${type}`);
      return { notified: 0 };
    }

    await sendSessionNotifications({
      type,
      sessionId,
      courseTitle,
      sessionTitle,
      meetingUrl,
      participants: filtered,
    });

    // Mark reminder sent flags on session
    const flagMap = {
      reminder_24h:   { reminder_sent_24h:    true },
      reminder_1h:    { reminder_sent_1h:     true },
      reminder_10min: { reminder_sent_10min:  true },
      session_started:{ started_notification_sent: true },
    };

    if (flagMap[type]) {
      await db
        .from("live_sessions")
        .update({ ...flagMap[type], updated_at: new Date().toISOString() })
        .eq("id", sessionId);
    }

    console.log(`[sessionNotifier] ✅ ${type} sent to ${filtered.length} participants`);
    return { notified: filtered.length };
  },

  {
    connection:  redisConn,
    concurrency: 5,
    limiter:     { max: 100, duration: 60_000 },  // 100 jobs/min rate cap
    // Reduce idle Redis traffic on per-request-billed providers (Upstash).
    drainDelay:  60,
    settings:    { stalledInterval: 300_000 },
  }
);

worker.on("completed", (job, result) =>
  console.log(`[sessionNotifier] ✅ Job ${job.id} complete  notified=${result.notified}`)
);

worker.on("failed", (job, err) =>
  console.error(`[sessionNotifier] ❌ Job ${job?.id} failed:`, err.message)
);

export default worker;
