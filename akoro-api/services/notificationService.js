/**
 * services/notificationService.js  —  Piabam Notification Dispatcher
 *
 * Dispatches across Email, SMS, Push, and WhatsApp based on user preferences.
 * Called by live-sessions.js, sessionNotifier.js, and qa-announcements.js.
 *
 * Usage:
 *   import { sendSessionNotifications, sendDirectNotification } from "../services/notificationService.js";
 *
 * Environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM_EMAIL
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, DEFAULT_COUNTRY_CODE
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

import nodemailer  from "nodemailer";
import twilio      from "twilio";
import webpush     from "web-push";
import db          from "../db.js";
import { getEmailTemplate } from "../utils/templates.js";
import { createHash } from "node:crypto";
import { outboxSend } from "../lib/outbox.js";
import { idemKey } from "../lib/outboxCore.js";

// ─── Transport setup ──────────────────────────────────────────────────────────

const emailTransporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT ?? "587", 10),
  secure: process.env.SMTP_PORT === "465",
  auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL ?? "admin@akoro.app"}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ─── Channel senders ──────────────────────────────────────────────────────────

const sendEmail = async ({ to, subject, html, text }) => {
  await emailTransporter.sendMail({
    from:    `"Akoro Learning" <${process.env.SMTP_FROM_EMAIL ?? "noreply@akoro.app"}>`,
    to, subject, html, text,
  });
};

const sendSMS = async ({ to, body }) => {
  const formatted = to.startsWith("+") ? to : `+${process.env.DEFAULT_COUNTRY_CODE ?? "234"}${to}`;
  await twilioClient.messages.create({
    body,
    to:   formatted,
    from: process.env.TWILIO_PHONE_NUMBER,
  });
};

const sendPush = async ({ token, title, body, data = {} }) => {
  const payload = JSON.stringify({
    title, body, data,
    icon:  "/icon-192.png",
    badge: "/badge.png",
  });
  await webpush.sendNotification(JSON.parse(token), payload);
};

const sendWhatsApp = async ({ to, body }) => {
  const formatted = to.startsWith("+") ? to : `+${process.env.DEFAULT_COUNTRY_CODE ?? "234"}${to}`;
  await twilioClient.messages.create({
    body,
    to:   `whatsapp:${formatted}`,
    from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
  });
};

// ─── Preference loader ────────────────────────────────────────────────────────

const getUserPreferences = async (userId) => {
  const { data } = await db
    .from("user_notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .single();

  // Default preferences if none found
  return data ?? {
    email_enabled:   true,
    sms_enabled:     false,
    push_enabled:    false,
    whatsapp_enabled: false,
    phone_number:    null,
    whatsapp_number: null,
    push_token:      null,
    notify_session_reminders:   true,
    notify_session_started:     true,
    notify_session_cancelled:   true,
    notify_session_rescheduled: true,
    notify_new_announcements:   true,
    notify_qa_replies:          true,
  };
};

// ─── Notification queue logger ────────────────────────────────────────────────

const logToQueue = async ({ userId, sessionId, notificationType, channel, recipient, subject, body, status }) => {
  try {
    await db.from("notification_queue").insert({
      user_id:           userId,
      session_id:        sessionId ?? null,
      notification_type: notificationType,
      channel,
      recipient,
      subject:           subject ?? null,
      body:              body ?? null,
      status,
    });
  } catch (e) {
    console.warn("[notificationService] Failed to log to queue:", e.message);
  }
};

const logError = async (channel, error, userId, sessionId, type) => {
  console.error(`[notificationService] ❌ ${channel} failed  user=${userId}:`, error.message);
  try {
    await db
      .from("notification_queue")
      .update({ status: "failed", error_message: error.message, retry_count: 1 })
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .eq("channel", channel)
      .eq("notification_type", type)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1);
  } catch {}
};

// ─── Store first, send after (Phase 18 item 5) ───────────────────────────────

const SENDERS = { session_email: sendEmail, sms: sendSMS, session_push: sendPush, whatsapp: sendWhatsApp };
const LABEL = { session_email: "Email", sms: "SMS", session_push: "Push", whatsapp: "WhatsApp" };
const digest = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);

/**
 * One message on one channel, through the outbox (lib/outbox.js). log: the
 * notification_queue row written when it is sent (null: a direct notice, which
 * only warns on failure, as before). The same message to the same person within
 * the hour is one piece of work — a re-run never sends it twice.
 */
function dispatch(channel, who, msg, log) {
  const logRow = log ? { userId: who.userId, sessionId: who.sessionId, notificationType: who.type, ...log } : null;
  const direct = () => SENDERS[channel](msg)
    .then(() => logRow && logToQueue({ ...logRow, status: "sent" }))
    .catch((err) => (logRow ? logError(log.channel, err, who.userId, who.sessionId, who.type) : console.warn(`[notificationService] ${LABEL[channel]} failed:`, err.message)));
  const key = idemKey(who.direct ? "direct" : "session", who.sessionId, who.type, who.userId, channel, digest(msg), new Date().toISOString().slice(0, 13));
  return outboxSend(channel, { orderKey: `${channel}:${who.userId}`, idemKey: key, userId: who.userId, payload: { msg, log: logRow } }, direct)
    .then((r) => r.done);
}

/** The outbox's send for these channels (lib/outboxChannels.js). Throws to retry. */
export async function outboxSessionSend(channel, payload = {}) {
  await SENDERS[channel](payload.msg || {});
  if (payload.log) await logToQueue({ ...payload.log, status: "sent" });
  return {};
}

/** Failed after its tries, or dropped: recorded as before. */
export async function outboxSessionFailed(channel, row) {
  const log = row?.payload?.log;
  const err = new Error(row?.last_error || row?.drop_reason || "failed");
  if (log) return logError(log.channel, err, log.userId, log.sessionId, log.notificationType);
  console.warn(`[notificationService] ${LABEL[channel] || channel} failed:`, err.message);
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

/**
 * sendSessionNotifications
 * Dispatches session-related notifications to a list of participants.
 *
 * @param {object} opts
 *   type           - notification type key (see templates.js)
 *   sessionId      - UUID of the live session
 *   sessionTitle   - display title
 *   courseTitle    - parent course title
 *   meetingUrl     - join URL
 *   recordingUrl   - for recording_available type
 *   instructor     - { name, email }
 *   participants   - array of { user_id, email, full_name, phone?, preferences? }
 */
export const sendSessionNotifications = async ({
  type, sessionId, sessionTitle, courseTitle,
  meetingUrl, recordingUrl, instructor, participants = [],
}) => {
  const dispatches = [];

  for (const participant of participants) {
    const prefs = participant.preferences ?? await getUserPreferences(participant.user_id);
    const content = getEmailTemplate(type, {
      sessionTitle, courseTitle, meetingUrl, recordingUrl,
      instructor, userName: participant.full_name ?? participant.username ?? "Student",
    });

    // Store first, send after (Phase 18 item 5): each channel is written to the
    // outbox before it is tried, retried with backoff in order per recipient,
    // and never sent twice; the message is exactly the template's.
    const who = { userId: participant.user_id, sessionId, type };

    // ── Email ────────────────────────────────────────────────────────────────
    if (prefs.email_enabled && participant.email) {
      dispatches.push(dispatch("session_email", who, { to: participant.email, subject: content.email.subject, html: content.email.html, text: content.email.text },
        { channel: "email", recipient: participant.email, subject: content.email.subject }));
    }

    // ── SMS ──────────────────────────────────────────────────────────────────
    const phone = participant.phone ?? prefs.phone_number;
    if (prefs.sms_enabled && phone) {
      dispatches.push(dispatch("sms", who, { to: phone, body: content.sms.body }, { channel: "sms", recipient: phone }));
    }

    // ── Push ─────────────────────────────────────────────────────────────────
    if (prefs.push_enabled && prefs.push_token) {
      dispatches.push(dispatch("session_push", who, { token: prefs.push_token, title: content.push.title, body: content.push.body, data: { sessionId, type, url: meetingUrl } },
        { channel: "push", recipient: "push_token" }));
    }

    // ── WhatsApp ─────────────────────────────────────────────────────────────
    const waNumber = prefs.whatsapp_number ?? phone;
    if (prefs.whatsapp_enabled && waNumber) {
      dispatches.push(dispatch("whatsapp", who, { to: waNumber, body: content.sms.body }, { channel: "whatsapp", recipient: waNumber }));
    }

    // ── In-app notification ───────────────────────────────────────────────────
    try {
      await db.from("notifications").insert({
        user_id:    participant.user_id,
        type,
        title:      content.push.title,
        content:    content.push.body,
        related_id: sessionId ?? null,
      });
    } catch {}
  }

  await Promise.allSettled(dispatches);
};

/**
 * sendDirectNotification
 * Send a one-off notification to a single user (e.g. Q&A reply, announcement).
 */
export const sendDirectNotification = async ({
  userId, type, title, content, relatedId,
  emailSubject, emailHtml, smsBody,
}) => {
  const prefs = await getUserPreferences(userId);
  const { data: user } = await db.from("users").select("email, full_name, phone").eq("id", userId).single();

  // In-app
  try {
    await db.from("notifications").insert({
      user_id: userId, type, title, content,
      related_id: relatedId ?? null,
    });
  } catch {}

  const who = { userId, sessionId: relatedId ?? null, type, direct: true };
  if (prefs.email_enabled && user?.email && emailSubject && emailHtml) {
    await dispatch("session_email", who, { to: user.email, subject: emailSubject, html: emailHtml, text: content ?? "" }, null);
  }

  if (prefs.sms_enabled && user?.phone && smsBody) {
    await dispatch("sms", who, { to: user.phone, body: smsBody }, null);
  }
};
