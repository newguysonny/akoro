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
import { sendPushToUser } from "./notifications/webpush.js";

// Socket.io is exposed as global.io (app.js) and global._io (websocket.js) —
// historically both aliases were used. Resolve whichever is set.
const io = () => global.io || global._io || null;

export async function notifyUser({ userId, type, title, content = null, relatedId = null, link = null, email = null }) {
  if (!userId) return;

  let row = null;
  try {
    const { data } = await db
      .from("notifications")
      .insert({ user_id: userId, type, title, content, related_id: relatedId, link })
      .select("id, created_at")
      .single();
    row = data;
  } catch (e) { console.warn("[notify] insert failed:", e.message); }

  // Realtime push to the user's socket room. Payload carries everything the bell
  // needs to render the row without a refetch, plus a bump signal for the badge.
  try {
    io()?.to(`user:${userId}`).emit("notification", {
      id: row?.id, type, title, content, related_id: relatedId, link,
      is_read: false, created_at: row?.created_at || new Date().toISOString(),
    });
  } catch { /* no socket */ }

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
  try {
    if (pushEnabled) sendPushToUser(userId, { title, body: content || title, link, type });
  } catch { /* push best-effort */ }

  if (email?.to) {
    // emailEnabled comes from the shared preferences read above.
    if (emailEnabled) {
      sendNotificationEmail({
        to: email.to, name: email.name,
        subject: email.subject || title, heading: email.heading || title,
        body: email.body || content || title, ctaUrl: email.ctaUrl || link, ctaLabel: email.ctaLabel,
      }).catch((e) => console.warn("[notify] email failed:", e.message));
    }
  }

  return row;
}
