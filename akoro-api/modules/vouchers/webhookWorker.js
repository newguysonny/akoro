/**
 * webhookWorker.js — drains the voucher webhook queue.
 *
 * Runs every minute. Rows are claimed via vouchers.claim_webhook_deliveries()
 * (FOR UPDATE SKIP LOCKED), so running this on every app replica is safe —
 * each delivery goes to exactly one worker.
 *
 * Env:
 *   VOUCHER_WEBHOOKS=off            disable the worker
 *   VOUCHER_WEBHOOK_BATCH           deliveries claimed per tick (default 20)
 *   VOUCHER_WEBHOOK_TIMEOUT_MS      per-request timeout (default 8000)
 */
import cron from "node-cron";
import { vdb } from "./db.js";
import { attemptDelivery } from "./lib/webhooks.js";

const BATCH = Math.max(1, parseInt(process.env.VOUCHER_WEBHOOK_BATCH ?? "20", 10));
const STALE_MINUTES = Math.max(2, parseInt(process.env.VOUCHER_WEBHOOK_STALE_MINS ?? "10", 10));

export async function drainWebhookQueue() {
  // Reclaim anything a crashed/redeployed worker left mid-flight before
  // claiming new work — otherwise those rows are lost silently.
  await vdb().rpc("requeue_stuck_webhooks", { p_stale_minutes: STALE_MINUTES })
    .then(({ data }) => { if (data) console.warn(`[vouchers/webhooks] requeued ${data} stuck delivery(s)`); }, () => {});

  const { data: rows, error } = await vdb().rpc("claim_webhook_deliveries", { p_limit: BATCH });
  if (error) { console.error("[vouchers/webhooks] claim failed:", error.message); return 0; }
  if (!rows?.length) return 0;

  // Deliver concurrently — one slow endpoint shouldn't hold up the batch.
  await Promise.all(rows.map((r) => attemptDelivery(r).catch((e) => {
    console.error("[vouchers/webhooks] delivery crashed for", r.id, e.message);
  })));
  return rows.length;
}

if (process.env.VOUCHER_WEBHOOKS !== "off") {
  cron.schedule("* * * * *", () => { drainWebhookQueue().catch(() => {}); });
  console.log("[vouchers/webhooks] delivery worker scheduled (every minute)");
}
