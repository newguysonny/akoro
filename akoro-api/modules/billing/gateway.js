/**
 * modules/billing/gateway.js — Paystack checkout + fulfillment (Phase 3)
 *
 * Learner checkout:
 *   POST /api/subscriptions/checkout   { cycle: 'monthly' | 'annual' }  (learner-auth)
 *   Initializes a Paystack transaction for the learner Premium tier and
 *   returns { authorization_url }. The unified webhook
 *   (POST /api/webhooks/paystack) fulfills the charge:
 *
 * Webhook fulfillment (fulfillSubscriptionEvent — idempotent, no-ops when the
 * metadata discriminator isn't ours):
 *   charge.success · purpose 'subscription'          → find-or-create customer,
 *     create the subscription (active, authorization saved for renewals),
 *     a PAID invoice, timeline event, audit entry
 *   charge.success · purpose 'subscription_renewal'  → invoice paid, next_date
 *     advanced, sub back to active
 *   charge.failed  · purpose 'subscription_renewal'  → sub past_due (the
 *     payment-retry job takes it from there per lifecycle settings)
 *
 * Renewal charging (chargeSubscription): invoice-generation / payment-retry
 * jobs charge the saved authorization directly; the webhook's idempotency
 * makes the resulting duplicate events harmless.
 *
 * Prices are naira; Paystack is charged in kobe (×100).
 */

import { Router } from "express";
import db from "../../db.js";
import { authenticateToken } from "../auth/index.js";
import { paystackPost } from "../../lib/paystackBreaker.js";
import { addCycleDays, todayStr } from "../../lib/billingModel.js";
import { urlFor } from "../../lib/urls.js";

const router = Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ── audit + timeline (system actor) ───────────────────────────────────────── */
async function systemAudit(action, entityType, entityId, before, after) {
  const { error } = await db.from("admin_audit_log").insert({
    actor: null, actor_label: "system (paystack)",
    action, entity_type: entityType, entity_id: entityId,
    before: before ?? null, after: after ?? null,
  });
  if (error) console.error("[billing:gateway] audit insert failed:", error.message);
}

async function addEvent(subscriptionId, text) {
  const { error } = await db.from("subscription_events").insert({ subscription_id: subscriptionId, text });
  if (error) console.error("[billing:gateway] event insert failed:", error.message);
}

/* ── helpers ───────────────────────────────────────────────────────────────── */
async function learnerPremiumTier() {
  const { data } = await db.from("tiers")
    .select("id, name, price_monthly, price_annual")
    .eq("platform", "learner").eq("access", "paid").eq("name", "Premium").limit(1);
  return data?.[0] ?? null;
}

async function findOrCreateCustomer(email, name) {
  const { data: existing } = await db.from("customers").select("*").eq("email", email).maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await db.from("customers").insert({ name: name || email, email }).select().single();
  if (error) {
    if (error.code === "23505") {
      const { data: retry } = await db.from("customers").select("*").eq("email", email).maybeSingle();
      if (retry) return retry;
    }
    throw error;
  }
  return created;
}

const tierPriceFor = (tier, cycle) => (cycle === "annual" ? tier.price_annual : tier.price_monthly);

/* ═══ Learner checkout ══════════════════════════════════════════════════════ */

router.post("/checkout", authenticateToken, asyncHandler(async (req, res) => {
  const cycle = req.body?.cycle === "annual" ? "annual" : "monthly";
  const userId = req.user?.id ?? req.user?.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Sign in to upgrade." });

  const tier = await learnerPremiumTier();
  if (!tier) return res.status(500).json({ success: false, message: "No Premium tier is configured." });

  const basePrice = tierPriceFor(tier, cycle);
  if (!(basePrice > 0)) return res.status(400).json({ success: false, code: "not_purchasable", message: "That plan isn't purchasable yet." });

  const { data: user } = await db.from("users").select("email, full_name").eq("id", userId).maybeSingle();
  if (!user?.email) return res.status(400).json({ success: false, message: "Your account has no email on file." });

  // Coupon discount applies to the first charge when one is already attached
  // to a pending... — coupons are applied by admins after subscription, so the
  // first charge is the full tier price.
  const amountKobo = basePrice * 100;
  const reference = `akoro_sub_${userId}_${Date.now()}`;

  let psData;
  try {
    ({ data: psData } = await paystackPost("https://api.paystack.co/transaction/initialize", {
      email: user.email,
      amount: amountKobo,
      currency: "NGN",
      reference,
      metadata: {
        purpose: "subscription",
        learner_user_id: userId,
        tier_id: tier.id,
        cycle,
      },
      callback_url: `${urlFor("FRONTEND_URL")}/upgrade?payment=return`,
    }));
  } catch (e) {
    console.error("[billing:gateway] initialize failed:", e.message);
    return res.status(502).json({ success: false, code: "gateway_unavailable", message: "Could not reach the payment gateway. Please try again." });
  }

  if (!psData?.authorization_url) {
    console.error("[billing:gateway] initialize returned no URL:", JSON.stringify(psData).slice(0, 300));
    return res.status(502).json({ success: false, code: "gateway_error", message: "The payment gateway did not return a checkout URL." });
  }

  return res.json({
    success: true,
    data: {
      authorization_url: psData.authorization_url,
      access_code: psData.access_code ?? null,
      reference,
      amount: basePrice,
      cycle,
      tier: tier.name,
    },
  });
}));

/* ═══ Webhook fulfillment ═══════════════════════════════════════════════════ */

/**
 * Called by the unified Paystack webhook for charge.success / charge.failed.
 * Returns true when the event was ours (so the webhook logs a match).
 * Idempotent: replays no-op on already-fulfilled state.
 */
export async function fulfillSubscriptionEvent(event) {
  const type = event?.event;
  const data = event?.data ?? {};
  const meta = data?.metadata ?? {};

  if (type === "charge.success" && meta.purpose === "subscription") return fulfillNewSubscription(data, meta);
  if (type === "charge.success" && meta.purpose === "subscription_renewal") return fulfillRenewalCharge(data, meta);
  if (type === "charge.failed" && meta.purpose === "subscription_renewal") return fulfillRenewalFailure(data, meta);
  return false;
}

async function fulfillNewSubscription(data, meta) {
  const { learner_user_id, tier_id, cycle } = meta;
  if (!learner_user_id || !tier_id) return false;

  const today = todayStr();

  // Idempotency: an active subscription for this learner + tier is already fulfilled.
  const { data: existing } = await db.from("subscriptions")
    .select("id").eq("learner_user_id", learner_user_id).eq("tier_id", tier_id)
    .in("status", ["active", "past_due", "paused"]).limit(1);
  if (existing?.length) return true;

  const { data: tier } = await db.from("tiers").select("id, name, price_monthly, price_annual").eq("id", tier_id).maybeSingle();
  if (!tier) { console.error("[billing:gateway] webhook for unknown tier", tier_id); return false; }

  const { data: learner } = await db.from("users").select("id, full_name, email").eq("id", learner_user_id).maybeSingle();
  const email = data?.customer?.email || learner?.email;
  if (!email) { console.error("[billing:gateway] no email to bill for learner", learner_user_id); return false; }

  const customer = await findOrCreateCustomer(email, learner?.full_name || undefined);
  const price = tierPriceFor(tier, cycle === "annual" ? "annual" : "monthly");
  const auth = data?.authorization ?? {};
  const methodRef = auth.last4 ? `Card •••• ${auth.last4}` : "Card on file";

  const { data: sub, error: subErr } = await db.from("subscriptions").insert({
    customer_id: customer.id,
    learner_user_id,
    tier_id: tier.id,
    status: "active",
    cycle: cycle === "annual" ? "annual" : "monthly",
    price,
    next_date: addCycleDays(today, cycle === "annual" ? "annual" : "monthly"),
    payment_method_ref: methodRef,
    gateway_authorization: auth.authorization_code ?? null,
  }).select("id").single();
  if (subErr) {
    console.error("[billing:gateway] subscription insert failed:", subErr.message);
    return false;
  }

  const { error: invErr } = await db.from("invoices").insert({
    customer_id: customer.id,
    subscription_id: sub.id,
    status: "paid",
    issued_at: today,
    due_at: today,
    paid_at: today,
    invoice_line_items: [{ description: `${tier.name}, ${cycle === "annual" ? "annual" : "monthly"} (${learner?.full_name ?? "learner"})`, amount: price }],
  });
  if (invErr) console.error("[billing:gateway] invoice insert failed:", invErr.message);

  await addEvent(sub.id, `Subscribed ${cycle === "annual" ? "annually" : "monthly"} via Paystack`);
  await systemAudit("subscription.created_gateway", "subscription", sub.id, null,
    { customer: customer.email, learner: learner?.full_name ?? learner_user_id, tier: tier.name, cycle, price, method: methodRef });
  console.log(`[billing:gateway] subscription created for learner ${learner_user_id} (${tier.name}, ${cycle})`);
  return true;
}

async function fulfillRenewalCharge(data, meta) {
  const { subscription_id, invoice_id } = meta;
  if (!subscription_id) return false;

  const { data: invoice } = invoice_id
    ? await db.from("invoices").select("id, status").eq("id", invoice_id).maybeSingle()
    : null;
  if (invoice?.status === "paid") return true; // already settled (replay / sync + webhook double)

  const today = todayStr();
  const { data: sub } = await db.from("subscriptions")
    .select("id, cycle").eq("id", subscription_id).maybeSingle();
  if (!sub) return false;

  if (invoice_id) {
    await db.from("invoices").update({ status: "paid", paid_at: today, updated_at: new Date().toISOString() }).eq("id", invoice_id);
  }
  await db.from("subscriptions").update({
    status: "active",
    next_date: addCycleDays(today, sub.cycle),
    retry_count: 0,
    past_due_since: null,
    updated_at: new Date().toISOString(),
  }).eq("id", subscription_id);

  await addEvent(subscription_id, "Renewal payment succeeded");
  await systemAudit("subscription.renewal_paid", "subscription", subscription_id,
    { status: "past_due" }, { status: "active", invoice: invoice_id });
  return true;
}

async function fulfillRenewalFailure(data, meta) {
  const { subscription_id } = meta;
  if (!subscription_id) return false;

  const { data: sub } = await db.from("subscriptions")
    .select("id, retry_count").eq("id", subscription_id).maybeSingle();
  if (!sub) return false;

  await db.from("subscriptions").update({
    status: "past_due",
    past_due_since: todayStr(),
    updated_at: new Date().toISOString(),
  }).eq("id", subscription_id);

  await addEvent(subscription_id, "Renewal payment failed");
  await systemAudit("subscription.renewal_failed", "subscription", subscription_id,
    { status: "active" }, { status: "past_due" });
  return true;
}

/* ═══ Direct charge (renewal jobs) ══════════════════════════════════════════ */

/**
 * Charge a subscription's saved authorization. Returns { ok: boolean, status }.
 * The Paystack response carries the outcome synchronously; the webhook event
 * that follows is handled idempotently.
 */
export async function chargeSubscription(sub, invoiceId, amountNaira) {
  const { data: customer } = await db.from("customers").select("email").eq("id", sub.customer_id).maybeSingle();
  try {
    const { data } = await paystackPost("https://api.paystack.co/transaction/charge_authorization", {
      authorization_code: sub.gateway_authorization,
      email: customer?.email,
      amount: amountNaira * 100,
      currency: "NGN",
      metadata: { purpose: "subscription_renewal", subscription_id: sub.id, invoice_id: invoiceId ?? null },
      reference: `akoro_renewal_${sub.id}_${Date.now()}`,
    });
    const status = data?.status;
    return { ok: status === "success", status };
  } catch (e) {
    console.error("[billing:gateway] charge_authorization failed:", e.message);
    return { ok: false, status: "error" };
  }
}

export default router;
