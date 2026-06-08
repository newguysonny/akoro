/**
 * modules/tasks/lib/notifications.js
 * Student notification service for task outputs.
 * Uses our existing notificationService for email/SMS,
 * and Socket.io (global.io) for in-app push.
 */

import db from "../../../db.js";

export async function sendBulkNotifications(notifications, channel, metadata = {}) {
  const results = await Promise.allSettled(notifications.map((n) => sendOne(n, channel, metadata)));
  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { studentId: notifications[i].studentId, inApp: false, email: false, error: r.reason?.message };
  });
}

async function sendOne(n, channel, meta) {
  const result = { studentId: n.studentId, inApp: false, email: false };
  const personalised = n.message.replace(/\{name\}/gi, n.studentName?.split(" ")[0] ?? "Student");

  if (channel === "in_app" || channel === "both") {
    try {
      // Insert in-app notification
      await db.from("notifications").insert({
        user_id:    n.studentId,
        type:       "task_notification",
        title:      meta.subject ?? "Message from your teacher",
        content:    personalised,
        related_id: meta.courseId ?? null,
      });
      // Push via Socket.io if student is connected
      global.io?.to(`user:${n.studentId}`).emit("notification", {
        type:       "task_notification",
        title:      meta.subject ?? "Message from your teacher",
        content:    personalised,
        courseId:   meta.courseId,
        sessionUrl: meta.sessionUrl,
        sentAt:     new Date().toISOString(),
      });
      result.inApp = true;
    } catch (err) {
      console.error(`[notifications] In-app push failed for ${n.studentId}:`, err.message);
    }
  }

  if (channel === "email" || channel === "both") {
    try {
      const { sendDirectNotification } = await import("../../../services/notificationService.js");
      await sendDirectNotification({
        userId:       n.studentId,
        type:         "task_notification",
        title:        meta.subject ?? "Message from your teacher",
        content:      personalised,
        relatedId:    meta.courseId ?? null,
        emailSubject: meta.subject ?? "A message from your teacher",
        emailHtml:    `<p>Hi ${n.studentName},</p><p>${personalised}</p>${meta.sessionUrl ? `<p><a href="${meta.sessionUrl}">Join session →</a></p>` : ""}`,
      });
      result.email = true;
    } catch (err) {
      console.error(`[notifications] Email failed for ${n.email}:`, err.message);
    }
  }

  return result;
}
