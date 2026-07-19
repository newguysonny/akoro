/**
 * Unified Paystack webhook  —  POST /api/webhooks/paystack
 *
 * Paystack sends every event (course/cart charges, agent & tool charges,
 * instructor payout transfers, refunds) to ONE configured webhook URL. This is
 * that URL. It verifies the signature ONCE against the raw request body, then
 * fans the event out to each domain's fulfillment function.
 *
 * Why raw body: Paystack's HMAC-SHA512 signature is computed over the exact
 * bytes it sent. Re-stringifying a parsed object (JSON.stringify(req.body)) can
 * reorder keys or change whitespace and break verification — so this route is
 * mounted with express.raw() in app.js and hashes the buffer directly.
 *
 * Signing key: Paystack signs webhooks with the account SECRET KEY. There is no
 * separate "webhook secret" — PAYSTACK_WEBHOOK_SECRET, if set, must equal
 * PAYSTACK_SECRET_KEY. We hash with the secret key here.
 *
 * Dispatch is idempotent and cross-domain: for charge.success we hand the event
 * to BOTH the payments (course/cart) and marketplace (agent/tool) fulfillers —
 * each inspects the metadata discriminator and no-ops if it isn't theirs, so
 * replays and cross-posts are safe.
 */

import { Router } from "express";
import crypto from "crypto";
import { fulfillPaymentsCharge } from "../courses/payments.js";
import { fulfillMarketplaceEvent } from "../adaptive-learning/marketplace/routes.js";
import { fulfillTransferEvent } from "../courses/payouts.js";

const router = Router();

// POST /api/webhooks/paystack  (mounted with express.raw — req.body is a Buffer)
router.post("/", async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY ?? "";
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));

    const hash = crypto.createHmac("sha512", secret).update(raw).digest("hex");
    if (hash !== req.headers["x-paystack-signature"]) {
      console.warn("[paystack-webhook] Invalid signature — rejected");
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    const event = JSON.parse(raw.toString("utf8"));
    const { event: type, data } = event;
    console.log(`[paystack-webhook] ${type}  ref=${data?.reference ?? data?.transfer_code ?? "—"}`);

    if (type === "charge.success") {
      // Fan out to every charge domain; each is idempotent and no-ops when the
      // metadata isn't its own. Run sequentially so one failing domain surfaces
      // in logs without masking the others.
      let handled = false;
      try { handled = (await fulfillPaymentsCharge(data)) || handled; }
      catch (e) { console.error("[paystack-webhook] payments fulfillment failed:", e); }
      try { handled = (await fulfillMarketplaceEvent(event)) || handled; }
      catch (e) { console.error("[paystack-webhook] marketplace fulfillment failed:", e); }

      if (!handled) console.warn("[paystack-webhook] charge.success matched no domain:", data?.metadata);
      return res.status(200).json({ received: true });
    }

    if (type === "refund.processed") {
      try { await fulfillMarketplaceEvent(event); }
      catch (e) { console.error("[paystack-webhook] refund fulfillment failed:", e); }
      return res.status(200).json({ received: true });
    }

    if (type?.startsWith("transfer.")) {
      try { await fulfillTransferEvent(type, data); }
      catch (e) { console.error("[paystack-webhook] transfer fulfillment failed:", e); }
      return res.status(200).json({ received: true });
    }

    // Unknown/unhandled event — acknowledge so Paystack stops retrying.
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[paystack-webhook] Error:", err);
    // 200 avoids Paystack retry storms on our own bugs; the error is logged.
    return res.status(200).json({ received: true });
  }
});

export default router;
