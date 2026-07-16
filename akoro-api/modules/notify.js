/**
 * notify.js — one place to raise a user notification across channels:
 *   • in-app   → public.notifications row (shown in the app's bell/list)
 *   • realtime → socket.io "notification" event on user:<id>
 *   • email    → optional, via the generic notification template
 * All channels are best-effort — a failure in one never throws to the caller.
 */
import db from "../db.js";
import { sendNotificationEmail } from "./auth/emails.js";

export async function notifyUser({ userId, type, title, content = null, relatedId = null, email = null }) {
  if (!userId) return;
  try {
    await db.from("notifications").insert({ user_id: userId, type, title, content, related_id: relatedId });
  } catch (e) { console.warn("[notify] insert failed:", e.message); }
  try { global.io?.to(`user:${userId}`).emit("notification", { type, title, content }); } catch { /* no socket */ }
  if (email?.to) {
    sendNotificationEmail({
      to: email.to, name: email.name,
      subject: email.subject || title, heading: email.heading || title,
      body: email.body || content || title, ctaUrl: email.ctaUrl, ctaLabel: email.ctaLabel,
    }).catch((e) => console.warn("[notify] email failed:", e.message));
  }
}
