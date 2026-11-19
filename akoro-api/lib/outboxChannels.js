/**
 * lib/outboxChannels.js — what "send" means for each outbox channel (Grand
 * Plan Phase 18 item 5). The senders are imported when first used, so the
 * clock can retry any channel after a restart without loading every
 * provider at boot. The message content is exactly what the caller stored.
 *
 *   push           web push to the learner's devices (notify.js); a device
 *                  already reached is not pushed again on a retry
 *   email          the platform notification email (notify.js)
 *   in_app         the bell row (public.notifications) whose first write failed: written
 *                  with the id chosen at the time (a retry never makes a second row), then
 *                  its live update to the learner's open app
 *   session_email · sms · session_push · whatsapp
 *                  live-session and direct notices (services/notificationService.js)
 *
 * A sender throws to fail an attempt (retried with backoff), or returns
 * { drop: "why" } when trying again can never help.
 */
const retryable = (message, progress) => Object.assign(new Error(message), progress !== undefined ? { progress } : {});

const session = (name) => ({
  async send(payload) {
    const svc = await import("../services/notificationService.js");
    return svc.outboxSessionSend(name, payload);
  },
  async onFinal(row) {
    const svc = await import("../services/notificationService.js");
    return svc.outboxSessionFailed(name, row);
  },
});

let channels = null;
export function outboxChannels() {
  if (channels) return channels;
  channels = new Map([
    ["push", {
      async send(p, { progress }) {
        const { deliverPush, isPushEnabled } = await import("../modules/notifications/webpush.js");
        if (!isPushEnabled()) return { drop: "push is not configured on this server" };
        const done = progress?.done || [];
        const r = await deliverPush(p.userId, { title: p.title, body: p.body, link: p.link, type: p.type, tag: p.tag }, { skipIds: done });
        if (r.none) return { drop: "no device subscribed" };
        const reached = [...done, ...r.sent];
        if (r.failed.length) throw retryable(`${r.failed.length} device(s) failed: ${r.failed[0].error}`, { done: reached });
        return { result: { devices: reached.length, pruned: r.dead.length } };
      },
    }],
    ["email", {
      async send(p) {
        const { sendNotificationEmail } = await import("../modules/auth/index.js");
        await sendNotificationEmail(p);
        return {};
      },
    }],
    ["in_app", {
      async send(p) {
        const { writeInAppRow, emitInApp } = await import("../modules/notify.js");
        const row = await writeInAppRow(p);
        emitInApp(p, row);
        return { result: { id: row.id } };
      },
    }],
    ["session_email", session("session_email")],
    ["sms", session("sms")],
    ["session_push", session("session_push")],
    ["whatsapp", session("whatsapp")],
  ]);
  return channels;
}
