/**
 * webpush.js — Web Push (PWA) delivery.
 *
 * Sends browser push notifications to a user's subscribed devices via the
 * VAPID protocol. Configured from env:
 *   VAPID_PUBLIC_KEY   — exposed to the frontend (applicationServerKey)
 *   VAPID_PRIVATE_KEY  — secret
 *   VAPID_EMAIL        — contact mailto for push services (defaults provided)
 *
 * If VAPID keys aren't set, push is silently disabled (in-app + socket + email
 * still work). Dead subscriptions (410 Gone / 404) are pruned automatically.
 */
import webpush from "web-push";
import db from "../../db.js";

const PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY || "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const CONTACT     = process.env.VAPID_EMAIL || "admin@akoro.name.ng";

let enabled = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(
      CONTACT.startsWith("mailto:") ? CONTACT : `mailto:${CONTACT}`,
      PUBLIC_KEY, PRIVATE_KEY,
    );
    enabled = true;
  } catch (e) {
    console.warn("[webpush] VAPID config invalid — push disabled:", e.message);
  }
} else {
  console.warn("[webpush] VAPID keys not set — push notifications disabled.");
}

export const isPushEnabled = () => enabled;
export const getPublicKey  = () => PUBLIC_KEY;

/**
 * Send a push to all of a user's subscribed devices. Best-effort: never throws.
 * @param {string} userId
 * @param {{title:string, body?:string, link?:string, tag?:string, type?:string}} payload
 */
export async function sendPushToUser(userId, payload) {
  if (!enabled || !userId) return;

  let subs = [];
  try {
    const { data } = await db
      .from("web_push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);
    subs = data ?? [];
  } catch (e) { console.warn("[webpush] load subs failed:", e.message); return; }
  if (!subs.length) return;

  // 120 chars is the visible ceiling on most lock screens; the rest is bytes
  // the device never shows. TTL stops offline devices from queuing stale
  // pushes for days; topic lets the push service collapse a burst ("you have
  // 12 new battle results") into one visible notification per tag.
  const body = JSON.stringify({
    title: payload.title || "Akoro",
    body:  String(payload.body || "").slice(0, 120),
    link:  payload.link || "/notifications",
    tag:   payload.tag || payload.type || "akoro",
    type:  payload.type || "system",
  });
  const topic = String(payload.tag || payload.type || "akoro")
    .replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32) || "akoro";

  const dead = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 3600, topic },
      );
    } catch (err) {
      // 404/410 → the subscription is gone; prune it.
      if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.id);
      else console.warn("[webpush] send failed:", err?.statusCode, err?.message);
    }
  }));

  if (dead.length) {
    try { await db.from("web_push_subscriptions").delete().in("id", dead); } catch {}
  }
}
