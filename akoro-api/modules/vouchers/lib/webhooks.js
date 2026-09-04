/**
 * lib/webhooks.js — outbound webhooks to a startup's own backend.
 *
 * Signed like Stripe's: the header carries a timestamp and an HMAC-SHA256 of
 * `<timestamp>.<raw body>` keyed on the startup's webhook_secret, so the
 * receiver can verify BOTH that we sent it and that it isn't a replay of an
 * old capture. Signing over the timestamp too is the point — signing the body
 * alone would let anyone rebroadcast a captured payload forever.
 *
 * Delivery is queued, never inline: a slow or dead endpoint must not make a
 * customer's redemption hang or fail.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { vdb } from "../db.js";

const TIMEOUT_MS = Math.max(1000, parseInt(process.env.VOUCHER_WEBHOOK_TIMEOUT_MS ?? "8000", 10));

/** Exponential backoff with a ceiling: ~1m, 5m, 25m, 2h, 6h, 6h… */
export function backoffSeconds(attempt) {
  const table = [60, 300, 1500, 7200, 21600];
  return table[Math.min(attempt, table.length) - 1] ?? 21600;
}

export const generateWebhookSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;

export function signPayload({ secret, timestamp, body }) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Constant-time compare — exposed so the docs' verification snippet matches reality. */
export function verifySignature({ secret, header, body, toleranceSecs = 300 }) {
  const parts = Object.fromEntries(String(header || "").split(",").map((kv) => kv.split("=")));
  const t = Number(parts.t), v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSecs) return false;
  const expected = signPayload({ secret, timestamp: t, body });
  const a = Buffer.from(expected, "hex"), b = Buffer.from(v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Queue an event for a startup. No-ops when they haven't configured a URL.
 * Generates a signing secret on first use so a startup that set only a URL
 * still gets verifiable deliveries.
 */
export async function enqueueWebhook(startupId, event, payload) {
  const { data: startup } = await vdb().from("startups")
    .select("id, webhook_url, webhook_secret").eq("id", startupId).maybeSingle();
  if (!startup?.webhook_url) return null;

  if (!startup.webhook_secret) {
    await vdb().from("startups").update({ webhook_secret: generateWebhookSecret() }).eq("id", startupId);
  }

  const { data } = await vdb().from("webhook_deliveries").insert({
    startup_id: startupId, event, url: startup.webhook_url,
    payload: { event, created_at: new Date().toISOString(), data: payload },
  }).select("id").maybeSingle();
  return data?.id || null;
}

/**
 * Attempt one delivery. Never throws — every outcome is recorded on the row.
 * `attempts` was already incremented by claim_webhook_deliveries().
 */
export async function attemptDelivery(row) {
  const { data: startup } = await vdb().from("startups")
    .select("webhook_secret").eq("id", row.startup_id).maybeSingle();

  const body = JSON.stringify(row.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = startup?.webhook_secret
    ? signPayload({ secret: startup.webhook_secret, timestamp, body })
    : null;

  let statusCode = null, errorText = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(row.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Akoro-Vouchers/1.0",
          "X-Akoro-Event": row.event,
          "X-Akoro-Delivery": row.id,
          ...(signature ? { "X-Akoro-Signature": `t=${timestamp},v1=${signature}` } : {}),
        },
        body,
        signal: controller.signal,
      });
    } finally { clearTimeout(timer); }
    statusCode = res.status;
    if (!res.ok) errorText = (await res.text().catch(() => "")).slice(0, 500) || `HTTP ${res.status}`;
  } catch (e) {
    errorText = e.name === "AbortError" ? `Timed out after ${TIMEOUT_MS}ms` : (e.message || "Request failed").slice(0, 500);
  }

  const ok = statusCode != null && statusCode >= 200 && statusCode < 300;
  if (ok) {
    await vdb().from("webhook_deliveries").update({
      status: "delivered", last_status_code: statusCode, last_error: null,
      delivered_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    return { ok: true };
  }

  const exhausted = row.attempts >= row.max_attempts;
  await vdb().from("webhook_deliveries").update({
    status: exhausted ? "failed" : "pending",
    last_status_code: statusCode, last_error: errorText,
    next_attempt_at: new Date(Date.now() + backoffSeconds(row.attempts) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  return { ok: false, exhausted, statusCode, errorText };
}
