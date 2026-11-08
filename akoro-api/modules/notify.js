/**
 * notify.js — one place to raise a user notification across channels:
 *   • in-app   → public.notifications row (shown in the app's bell/list)
 *   • realtime → socket.io "notification" event on user:<id>
 *   • email    → optional, via the generic notification template, and only when
 *                the user hasn't disabled email notifications.
 * All channels are best-effort — a failure in one never throws to the caller.
 *
 * The `type` string is the discriminator the frontend maps to an icon/colour
 * (see modules/notifications/events.js for the canonical catalogue). `link` is
 * an optional in-app deep link the bell can navigate to.
 */
import db from "../db.js";
import { sendNotificationEmail } from "./auth/emails.js";
import { isPushEnabled, sendPushToUser } from "./notifications/webpush.js";
import { randomUUID } from "node:crypto";
import { outboxSend } from "../lib/outbox.js";
import { idemKey } from "../lib/outboxCore.js";

// Socket.io is exposed as global.io (app.js) and global._io (websocket.js) —
// historically both aliases were used. Resolve whichever is set.
const io = () => global.io || global._io || null;

/** Insert the bell row with its chosen id; already there (a retry) → the row as it is. Throws on failure. */
export async function writeInAppRow({ id, userId, type, title, content = null, relatedId = null, link = null }) {
  const { data, error } = await db.from("notifications")
    .insert({ id, user_id: userId, type, title, content, related_id: relatedId, link })
    .select("id, created_at").single();
  if (!error) return data;
  if (error.code === "23505" || /duplicate key/i.test(error.message || "")) {
    const { data: had } = await db.from("notifications").select("id, created_at").eq("id", id).maybeSingle();
    if (had) return had;
  }
  throw new Error(error.message);
}

/** The live update for the bell: everything it needs to render the row without a refetch. Never throws. */
export function emitInApp({ userId, type, title, content = null, relatedId = null, link = null }, row) {
  try {
    io()?.to(`user:${userId}`).emit("notification", {
      id: row?.id, type, title, content, related_id: relatedId, link,
      is_read: false, created_at: row?.created_at || new Date().toISOString(),
    });
  } catch { /* no socket: the bell shows the row when it next loads */ }
}

export async function notifyUser({ userId, type, title, content = null, relatedId = null, link = null, email = null }) {
  if (!userId) return;

  // The row's id is chosen here, so a retry can never make a second bell row.
  const id = randomUUID();
  const inApp = { id, userId, type, title, content, relatedId, link };
  let row = null;
  try {
    row = await writeInAppRow(inApp);
  } catch (e) {
    // Store first, send after (Phase 18 item 5): the bell row is retried by the outbox
    // (same id) and its live update sent once it lands — never lost, never twice.
    console.warn("[notify] in-app row not saved now — queued:", e.message);
    outboxSend("in_app", { orderKey: `in_app:${userId}`, idemKey: idemKey("notify", id, "in_app"), userId, payload: inApp }).catch(() => {});
  }
  if (row) emitInApp(inApp, row);

  // Web Push to the user's PWA devices (best-effort; no-op if not subscribed or
  // push is disabled). Push AND email read the one preferences row together —
  // notifyUser used to query user_notification_preferences twice per call.
  let pushEnabled = true;
  let emailEnabled = true;
  try {
    const { data: prefs } = await db
      .from("user_notification_preferences")
      .select("push_enabled, email_enabled").eq("user_id", userId).maybeSingle();
    if (prefs && prefs.push_enabled === false) pushEnabled = false;
    if (prefs && prefs.email_enabled === false) emailEnabled = false;
  } catch { /* default both on */ }
  // Store first, send after (Phase 18 item 5): push and email are written to the
  // outbox before they are tried, retried with backoff in order per recipient,
  // and never sent twice. If the outbox can't take them, the direct send as before.
  const key = id;
  try {
    if (pushEnabled && isPushEnabled()) {
      const push = { title, body: content || title, link, type };
      outboxSend("push", { orderKey: `push:${userId}`, idemKey: idemKey("notify", key, "push"), userId, payload: { userId, ...push } },
        () => sendPushToUser(userId, push)).catch(() => {});
    }
  } catch { /* push best-effort */ }

  if (email?.to) {
    // emailEnabled comes from the shared preferences read above.
    if (emailEnabled) {
      const mail = {
        to: email.to, name: email.name,
        subject: email.subject || title, heading: email.heading || title,
        body: email.body || content || title, ctaUrl: email.ctaUrl || link, ctaLabel: email.ctaLabel,
      };
      outboxSend("email", { orderKey: `email:${userId}`, idemKey: idemKey("notify", key, "email"), userId, payload: mail },
        () => sendNotificationEmail(mail).catch((e) => console.warn("[notify] email failed:", e.message))).catch(() => {});
    }
  }

  return row;
}
