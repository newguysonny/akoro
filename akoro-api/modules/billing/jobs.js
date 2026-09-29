/**
 * modules/billing/jobs.js — the plan §4.3 subscription jobs (Phase 3)
 *
 *   trial-expiry-check   03:15 UTC daily — trial subscriptions past their end
 *                        date move to Freemium (timeline + audit entry)
 *   invoice-generation   03:45 UTC daily — active paid subscriptions due for
 *                        renewal get an open invoice (coupon-discounted), the
 *                        next date advances, and the saved card authorization
 *                        is charged; a failed charge moves the sub to past_due
 *   payment-retry        04:00 UTC daily — past_due subscriptions are retried
 *                        per subscription_lifecycle_settings.retry_attempts;
 *                        once retries are exhausted the grace period runs,
 *                        then the sub auto-downgrades to Freemium
 *
 * All three are idempotent daily sweeps (node-cron, the house pattern). Every
 * transition writes a subscription_events timeline entry and an audit row
 * (system actor). Manual/offline subscriptions without a saved authorization
 * keep their open invoice for an admin to mark paid.
 */

import cron from "node-cron";
import db from "../../db.js";
import { addCycleDays, todayStr } from "../../lib/billingModel.js";
import { discountedPrice } from "../../lib/couponModel.js";
import { chargeSubscription } from "./gateway.js";

const today = () => todayStr();

async function systemAudit(action, entityType, entityId, before, after) {
  const { error } = await db.from("admin_audit_log").insert({
    actor: null, actor_label: "system (billing jobs)",
    action, entity_type: entityType, entity_id: entityId,
    before: before ?? null, after: after ?? null,
  });
  if (error) console.error("[billing:jobs] audit insert failed:", error.message);
}

async function addEvent(subscriptionId, text) {
  const { error } = await db.from("subscription_events").insert({ subscription_id: subscriptionId, text });
  if (error) console.error("[billing:jobs] event insert failed:", error.message);
}

async function freemiumTierId() {
  const { data } = await db.from("tiers").select("id, name")
    .eq("platform", "learner").eq("name", "Freemium").limit(1);
  return data?.[0]?.id ?? null;
}

/* ── trial-expiry-check ────────────────────────────────────────────────────── */
cron.schedule("15 3 * * *", async () => {
  try {
    const t = today();
    const freemium = await freemiumTierId();
    if (!freemium) { console.error("[trial-expiry-check] no learner Freemium tier configured — skipping"); return; }

    const { data: expired } = await db.from("subscriptions")
      .select("id, learner_user_id, tier_id")
      .eq("status", "trial").lt("next_date", t).limit(500);
    if (!expired?.length) return;

    for (const s of expired) {
      const { error } = await db.from("subscriptions").update({
        tier_id: freemium, price: 0, status: "active", next_date: null,
        updated_at: new Date().toISOString(),
      }).eq("id", s.id);
      if (error) { console.error("[trial-expiry-check] update failed:", error.message); continue; }
      await addEvent(s.id, "Trial ended, moved to Freemium");
      await systemAudit("subscription.trial_expired", "subscription", s.id,
        { status: "trial", tier_id: s.tier_id }, { status: "active", tier: "Freemium" });
    }
    console.log(`[trial-expiry-check] moved ${expired.length} expired trial(s) to Freemium`);
  } catch (e) {
    console.error("[trial-expiry-check] failed:", e.message);
  }
});

/* ── invoice-generation ────────────────────────────────────────────────────── */
cron.schedule("45 3 * * *", async () => {
  try {
    const t = today();
    const { data: due } = await db.from("subscriptions")
      .select("id, customer_id, cycle, price, next_date, gateway_authorization, discount_coupon_id, " +
              "tiers(name), users!subscriptions_learner_user_id_fkey(full_name), " +
              "coupons!subscriptions_discount_coupon_id_fkey(id, code, type, value, duration)")
      .eq("status", "active").gt("price", 0).lte("next_date", t).limit(500);
    if (!due?.length) return;

    let generated = 0, charged = 0, failed = 0, awaiting = 0;
    for (const s of due) {
      const coupon = s.coupons ?? null;
      const amount = coupon ? discountedPrice(coupon, s.price) : s.price;
      const cycleWord = s.cycle === "annual" ? "annual" : "monthly";
      const description = `${s.tiers?.name ?? "Plan"}, ${cycleWord} (${s.users?.full_name ?? "learner"})`
        + (coupon && amount < s.price ? ` — coupon ${coupon.code}` : "");

      const { data: invoice, error: invErr } = await db.from("invoices").insert({
        customer_id: s.customer_id,
        subscription_id: s.id,
        status: "open",
        issued_at: t,
        due_at: t,
        invoice_line_items: [{ description, amount }],
      }).select("id").single();
      if (invErr) { console.error("[invoice-generation] insert failed:", invErr.message); continue; }
      generated++;

      // Advance the renewal date so tomorrow's sweep doesn't re-invoice.
      await db.from("subscriptions").update({
        next_date: addCycleDays(t, s.cycle),
        updated_at: new Date().toISOString(),
      }).eq("id", s.id);

      if (s.gateway_authorization) {
        const { ok } = await chargeSubscription(s, invoice.id, amount);
        if (ok) {
          charged++;
          await db.from("invoices").update({ status: "paid", paid_at: t, updated_at: new Date().toISOString() }).eq("id", invoice.id);
          await addEvent(s.id, "Renewal charged successfully");
          await systemAudit("invoice.generated_paid", "invoice", invoice.id, null,
            { subscription: s.id, amount, charged: true });
        } else {
          failed++;
          await db.from("subscriptions").update({
            status: "past_due", past_due_since: t, retry_count: 1,
            updated_at: new Date().toISOString(),
          }).eq("id", s.id);
          await addEvent(s.id, "Renewal payment failed (attempt 1)");
          await systemAudit("invoice.generated_charge_failed", "invoice", invoice.id, null,
            { subscription: s.id, amount, charged: false });
        }
      } else {
        awaiting++;
        await addEvent(s.id, "Renewal invoice generated — awaiting payment");
      }

      // A "once" coupon has now had its effect — detach it.
      if (coupon?.duration === "once") {
        await db.from("subscriptions").update({ discount_coupon_id: null }).eq("id", s.id);
        await db.from("coupon_redemptions").delete().eq("coupon_id", coupon.id).eq("subscription_id", s.id);
      }
    }
    console.log(`[invoice-generation] ${generated} invoice(s): ${charged} charged, ${failed} charge failed, ${awaiting} awaiting payment`);
  } catch (e) {
    console.error("[invoice-generation] failed:", e.message);
  }
});

/* ── payment-retry (dunning) ───────────────────────────────────────────────── */
cron.schedule("0 4 * * *", async () => {
  try {
    const t = today();
    const { data: settings } = await db.from("subscription_lifecycle_settings").select("*").eq("id", true).maybeSingle();
    const maxRetries = settings?.payment_retry_attempts ?? 3;
    const graceDays  = settings?.grace_period_days ?? 5;

    const { data: pastDue } = await db.from("subscriptions")
      .select("id, customer_id, cycle, price, retry_count, past_due_since, gateway_authorization, " +
              "discount_coupon_id, coupons!subscriptions_discount_coupon_id_fkey(id, code, type, value, duration)")
      .eq("status", "past_due").not("gateway_authorization", "is", null).limit(500);
    if (!pastDue?.length) return;

    let recovered = 0, retried = 0, downgraded = 0;
    for (const s of pastDue) {
      // Only subs with an open invoice still to settle.
      const { data: openInvoice } = await db.from("invoices")
        .select("id").eq("subscription_id", s.id).eq("status", "open").order("created_at", { ascending: false }).limit(1);
      if (!openInvoice?.length) continue;

      const coupon = s.coupons ?? null;
      const amount = coupon ? discountedPrice(coupon, s.price) : s.price;

      // Retries exhausted → grace period → downgrade to Freemium.
      const daysPastDue = s.past_due_since
        ? Math.round((new Date(`${t}T00:00:00Z`) - new Date(`${s.past_due_since}T00:00:00Z`)) / 86400000)
        : 0;
      if (s.retry_count >= maxRetries && daysPastDue > graceDays) {
        const freemium = await freemiumTierId();
        if (!freemium) { console.error("[payment-retry] no Freemium tier — cannot downgrade"); continue; }
        const { error } = await db.from("subscriptions").update({
          tier_id: freemium, price: 0, status: "active", next_date: null,
          discount_coupon_id: null, retry_count: 0, past_due_since: null,
          updated_at: new Date().toISOString(),
        }).eq("id", s.id);
        if (error) { console.error("[payment-retry] downgrade failed:", error.message); continue; }
        await addEvent(s.id, `Downgraded to Freemium after ${s.retry_count} failed payment attempt(s) and a ${graceDays}-day grace period`);
        await systemAudit("subscription.downgraded_freemium", "subscription", s.id,
          { status: "past_due", retry_count: s.retry_count }, { status: "active", tier: "Freemium" });
        downgraded++;
        continue;
      }

      const { ok } = await chargeSubscription(s, openInvoice[0].id, amount);
      if (ok) {
        recovered++;
        await db.from("invoices").update({ status: "paid", paid_at: t, updated_at: new Date().toISOString() }).eq("id", openInvoice[0].id);
        await db.from("subscriptions").update({
          status: "active", next_date: addCycleDays(t, s.cycle),
          retry_count: 0, past_due_since: null, updated_at: new Date().toISOString(),
        }).eq("id", s.id);
        await addEvent(s.id, `Payment retry succeeded (attempt ${s.retry_count + 1})`);
        await systemAudit("subscription.payment_retried", "subscription", s.id,
          { status: "past_due", attempt: s.retry_count + 1 }, { status: "active" });
      } else {
        retried++;
        const attempt = s.retry_count + 1;
        await db.from("subscriptions").update({
          retry_count: attempt, updated_at: new Date().toISOString(),
        }).eq("id", s.id);
        await addEvent(s.id, `Payment retry failed (attempt ${attempt} of ${maxRetries})`);
        await systemAudit("subscription.payment_retry_failed", "subscription", s.id,
          { attempt, of: maxRetries }, { attempt: attempt + 1 <= maxRetries ? attempt + 1 : "exhausted" });
      }
    }
    console.log(`[payment-retry] ${recovered} recovered, ${retried} retried, ${downgraded} downgraded`);
  } catch (e) {
    console.error("[payment-retry] failed:", e.message);
  }
});
