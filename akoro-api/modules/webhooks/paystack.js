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
 * separate "webhook secret", so we hash with PAYSTACK_SECRET_KEY here.
 *
 * URL: the route path is derived in app.js from PAYSTACK_WEBHOOK_URL (its path
 * component), so this endpoint and the Paystack dashboard stay in sync via one
 * env var. Defaults to /api/webhooks/paystack.
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
import { fulfillCoinTopup } from "../wallet/routes.js";
import { fulfillVoucherWalletTopup } from "../vouchers/index.js";
import { fulfillVoucherTransferEvent } from "../vouchers/transferEvents.js";
import { logPaymentEvent } from "./paymentAudit.js";

const router = Router();

// POST /api/webhooks/paystack  (mounted with express.raw — req.body is a Buffer)
router.post("/", async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY ?? "";
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));

    const hash = crypto.createHmac("sha512", secret).update(raw).digest("hex");
    const signatureValid = hash === req.headers["x-paystack-signature"];

    // Log the raw event first — even a bad-signature attempt is worth a durable
    // record. We can't trust the body if the signature is invalid, so keep it in
    // `detail` only and don't act on it.
    let event = null;
    try { event = JSON.parse(raw.toString("utf8")); } catch { /* non-JSON body */ }
    const type      = event?.event ?? "unparseable";
    const data      = event?.data ?? {};
    const reference = data?.reference ?? data?.transfer_code ?? null;

    if (!signatureValid) {
      await logPaymentEvent({
        eventType: type, reference, source: "paystack_webhook",
        signatureValid: false, outcome: "ignored",
        detail: { reason: "invalid_signature", body: raw.toString("utf8").slice(0, 2000) },
      });
      console.warn("[paystack-webhook] Invalid signature — rejected");
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    console.log(`[paystack-webhook] ${type}  ref=${reference ?? "—"}`);
    const paymentId = data?.metadata?.payment_id ?? null;
    await logPaymentEvent({
      eventType: type, reference, paymentId, source: "paystack_webhook",
      signatureValid: true, detail: { metadata: data?.metadata ?? null, amount: data?.amount, status: data?.status },
    });

    if (type === "charge.success") {
      // Fan out to every charge domain; each is idempotent and no-ops when the
      // metadata isn't its own. Run sequentially so one failing domain surfaces
      // in logs without masking the others.
      let handled = false, errored = false;
      try { handled = (await fulfillPaymentsCharge(data)) || handled; }
      catch (e) { errored = true; console.error("[paystack-webhook] payments fulfillment failed:", e); }
      try { handled = (await fulfillMarketplaceEvent(event)) || handled; }
      catch (e) { errored = true; console.error("[paystack-webhook] marketplace fulfillment failed:", e); }
      try { handled = (await fulfillCoinTopup(data)) || handled; }
      catch (e) { errored = true; console.error("[paystack-webhook] coin top-up fulfillment failed:", e); }
      try { handled = (await fulfillVoucherWalletTopup(data)) || handled; }
      catch (e) { errored = true; console.error("[paystack-webhook] voucher wallet fulfillment failed:", e); }

      if (!handled) console.warn("[paystack-webhook] charge.success matched no domain:", data?.metadata);
      await logPaymentEvent({
        eventType: "charge.fulfillment", reference, paymentId, source: "paystack_webhook",
        matched: handled, outcome: errored ? "error" : (handled ? "fulfilled" : "no_match"),
      });
      return res.status(200).json({ received: true });
    }

    if (type === "refund.processed") {
      let outcome = "ignored";
      try { outcome = (await fulfillMarketplaceEvent(event)) ? "fulfilled" : "no_match"; }
      catch (e) { outcome = "error"; console.error("[paystack-webhook] refund fulfillment failed:", e); }
      await logPaymentEvent({ eventType: "refund.fulfillment", reference, source: "refund", outcome });
      return res.status(200).json({ received: true });
    }

    if (type?.startsWith("transfer.")) {
      let outcome = "ignored";
      // Two INDEPENDENT handlers — they own different tables. They must not
      // share a try: a throw in one would skip the other entirely, and since
      // we still return 200 Paystack would never retry, silently dropping
      // that payout. Each failure is isolated and logged.
      let voucherHandled = false;
      try { voucherHandled = await fulfillVoucherTransferEvent(type, data); }
      catch (e) { outcome = "error"; console.error("[paystack-webhook] voucher transfer fulfilment failed:", e); }

      let payoutHandled = false;
      if (!voucherHandled) {
        try { payoutHandled = await fulfillTransferEvent(type, data); }
        catch (e) { outcome = "error"; console.error("[paystack-webhook] instructor payout fulfilment failed:", e); }
      }
      if (outcome !== "error") outcome = (voucherHandled || payoutHandled) ? "fulfilled" : "no_match";
      await logPaymentEvent({ eventType: `${type}.fulfillment`, reference, source: "paystack_webhook", outcome });
      return res.status(200).json({ received: true });
    }

    // Unknown/unhandled event — acknowledge so Paystack stops retrying.
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[paystack-webhook] Error:", err);
    await logPaymentEvent({ eventType: "webhook_error", source: "system", outcome: "error", detail: { message: err?.message } });
    // 200 avoids Paystack retry storms on our own bugs; the error is logged.
    return res.status(200).json({ received: true });
  }
});

export default router;
