/**
 * modules/admin/reports.js — plan §4.6 #5 (Phase 5): reconciliation +
 * analytics with real numbers, now that a real gateway and real invoices
 * exist.
 *
 * All routes require role=admin. Mounted at /api/admin (modules/admin/index.js).
 *
 *   GET  /api/admin/billing/overview        the Overview panel (prototype
 *         renderOverview) + the revenue metrics that are grounded now:
 *         MRR/ARR from active paid subs, revenue-to-date from paid invoices
 *
 *   GET  /api/admin/billing/reconcile?days=30
 *         Pulls recent subscription transactions from Paystack (through the
 *         shared breaker) and checks each against local state:
 *           charge.success · purpose subscription          → subscription
 *             exists (active/past_due/paused) + first invoice paid
 *           charge.success · purpose subscription_renewal  → invoice paid
 *         Gaps (a dropped webhook, a half-fulfilled replay) come back as
 *         discrepancies with a settle action. Every run is audited.
 *
 *   POST /api/admin/billing/reconcile/settle { reference }
 *         Re-runs webhook fulfillment for one transaction (idempotent by
 *         design) and repairs a missing first invoice when the subscription
 *         already exists. Audited.
 */

import { Router } from "express";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/index.js";
import { paystackGet } from "../../lib/paystackBreaker.js";
import { computeOverview, todayStr } from "../../lib/billingModel.js";
import { fulfillSubscriptionEvent } from "../billing/gateway.js";

const router    = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const ok        = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const PAYSTACK_AUTH = () => ({ headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } });

async function audit(req, action, entityType, entityId, before, after) {
  const { error } = await db.from("admin_audit_log").insert({
    actor: req.user?.id ?? null,
    actor_label: req.user?.full_name || req.user?.email || "admin",
    action, entity_type: entityType, entity_id: entityId,
    before: before ?? null, after: after ?? null,
  });
  if (error) console.error("[admin:reports] audit insert failed:", error.message);
}

/* ═══ GET /billing/overview — the Overview panel ═══════════════════════════ */

router.get("/billing/overview", ...adminOnly, asyncHandler(async (req, res) => {
  const { data: subs, error } = await db.from("subscriptions")
    .select("id, learner_user_id, customer_id, status, price, cycle, next_date, " +
            "tiers(name), users!subscriptions_learner_user_id_fkey(full_name)")
    .order("created_at", { ascending: false }).limit(2000);
  if (error) return res.status(500).json({ success: false, message: error.message });

  // Concluded trials: subscriptions with a "Trial ended" timeline event.
  const { data: endedEvents } = await db.from("subscription_events")
    .select("subscription_id").like("text", "Trial ended%").limit(5000);
  const endedSubIds = new Set((endedEvents ?? []).map((e) => e.subscription_id));

  const rows = (subs ?? []).map((s) => ({
    id: s.id,
    learner_id: s.learner_user_id,
    customer_id: s.customer_id,
    status: s.status,
    price: s.price,
    cycle: s.cycle,
    next_date: s.next_date,
    tier_name: s.tiers?.name ?? "Plan",
    learner_name: s.users?.full_name ?? null,
    trial_ended: endedSubIds.has(s.id),
    ever_paid: (s.price ?? 0) > 0,
  }));

  // Revenue-to-date from paid invoices (Σ line items — the amount actually billed).
  const { data: paidInvoicesRaw } = await db.from("invoices")
    .select("customer_id, invoice_line_items(amount)").eq("status", "paid").limit(5000);
  const paidInvoices = (paidInvoicesRaw ?? []).map((inv) => ({
    customer_id: inv.customer_id,
    amount: (inv.invoice_line_items ?? []).reduce((sum, li) => sum + (li.amount ?? 0), 0),
  }));

  const { count: activePilots } = await db.from("pilot_cohorts")
    .select("id", { count: "exact", head: true })
    .eq("status", "active").eq("archived", false);

  return ok(res, computeOverview({ subs: rows, paidInvoices, activePilots: activePilots ?? 0, today: todayStr() }));
}));

/* ═══ GET /billing/reconcile — gateway ↔ local comparison ══════════════════ */

const isOurs = (tx) =>
  ["subscription", "subscription_renewal"].includes(tx?.metadata?.purpose) ||
  String(tx?.reference ?? "").startsWith("akoro_sub_") ||
  String(tx?.reference ?? "").startsWith("akoro_renewal_");

async function pullSubscriptionTransactions(days) {
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const ours = [];
  let page = 1, total = null;
  do {
    const { data } = await paystackGet(
      `https://api.paystack.co/transaction?perPage=100&page=${page}&from=${from}`,
      PAYSTACK_AUTH()
    );
    const list = data?.data ?? [];
    total = data?.meta?.total ?? list.length;
    ours.push(...list.filter(isOurs));
    page += 1;
  } while (page * 100 < total + 100 && page <= 5); // cap at 500 transactions
  return ours;
}

router.get("/billing/reconcile", ...adminOnly, asyncHandler(async (req, res) => {
  if (!process.env.PAYSTACK_SECRET_KEY)
    return res.status(400).json({ success: false, code: "gateway_not_configured", message: "Paystack is not configured — set PAYSTACK_SECRET_KEY first." });

  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  let transactions;
  try {
    transactions = await pullSubscriptionTransactions(days);
  } catch (e) {
    return res.status(502).json({ success: false, code: "gateway_unavailable", message: "Could not reach Paystack: " + (e.message ?? "unknown error") });
  }

  const successes = transactions.filter((t) => t.status === "success");
  const failedCharges = transactions.filter((t) => t.status === "failed").length;

  /* Bulk-fetch the local state the expectations need (no N+1). */
  const subIds = successes.map((t) => t.metadata?.subscription_id).filter(Boolean);
  const invoiceIds = successes.map((t) => t.metadata?.invoice_id).filter(Boolean);
  const learnerTierPairs = successes
    .filter((t) => t.metadata?.purpose === "subscription")
    .map((t) => `${t.metadata.learner_user_id}|${t.metadata.tier_id}`);

  const { data: subs } = await db.from("subscriptions")
    .select("id, learner_user_id, tier_id, status").limit(5000);
  const { data: invoices } = invoiceIds.length || subIds.length
    ? await db.from("invoices").select("id, subscription_id, status, paid_at").limit(5000)
    : { data: [] };

  const subById = new Map((subs ?? []).map((s) => [s.id, s]));
  const invoiceById = new Map((invoices ?? []).map((i) => [i.id, i]));
  const paidFirstInvoiceSubIds = new Set((invoices ?? []).filter((i) => i.status === "paid").map((i) => i.subscription_id));

  const discrepancies = [];
  let matched = 0;

  for (const tx of successes) {
    const meta = tx.metadata ?? {};
    const amountNaira = Math.round((tx.amount ?? 0) / 100);
    const base = {
      reference: tx.reference,
      amount_naira: amountNaira,
      customer_email: tx.customer?.email ?? null,
      paid_at: tx.paid_at ?? null,
    };

    if (meta.purpose === "subscription") {
      const exists = (subs ?? []).some((s) =>
        s.learner_user_id === meta.learner_user_id && s.tier_id === meta.tier_id &&
        ["active", "past_due", "paused"].includes(s.status));
      if (!exists) {
        discrepancies.push({ ...base, kind: "missing_subscription", settleable: true,
          detail: "Paid on Paystack but no subscription exists locally — the webhook likely never arrived." });
        continue;
      }
      const sub = (subs ?? []).find((s) => s.learner_user_id === meta.learner_user_id && s.tier_id === meta.tier_id);
      if (!paidFirstInvoiceSubIds.has(sub.id)) {
        discrepancies.push({ ...base, kind: "missing_first_invoice", subscription_id: sub.id, settleable: true,
          detail: "Subscription exists but its first invoice is missing or unpaid." });
        continue;
      }
      matched++;
      continue;
    }

    if (meta.purpose === "subscription_renewal") {
      const invoice = meta.invoice_id ? invoiceById.get(meta.invoice_id) : null;
      if (!invoice) {
        discrepancies.push({ ...base, kind: "missing_invoice", subscription_id: meta.subscription_id ?? null, settleable: false,
          detail: "The renewal charged on Paystack, but the local invoice row is gone — regenerate it before settling." });
        continue;
      }
      if (invoice.status !== "paid") {
        discrepancies.push({ ...base, kind: "invoice_open", subscription_id: meta.subscription_id ?? null, invoice_id: invoice.id, settleable: true,
          detail: `Paid on Paystack but the local invoice is still ${invoice.status}.` });
        continue;
      }
      matched++;
      continue;
    }

    // Success on the gateway, our reference, but an unknown purpose — surface it.
    discrepancies.push({ ...base, kind: "unknown_purpose", settleable: false,
      detail: `Recognized reference but unexpected purpose "${meta.purpose ?? "none"}" — review by hand.` });
  }

  const report = {
    days,
    checked: successes.length,
    matched,
    failed_charges: failedCharges,
    discrepancies,
    generated_at: new Date().toISOString(),
  };

  await audit(req, "reconciliation.run", "billing", null, null,
    { days, checked: report.checked, matched, discrepancies: discrepancies.length, failed_charges: failedCharges });
  return ok(res, report);
}));

/* ═══ POST /billing/reconcile/settle — replay fulfillment for one tx ═══════ */

router.post("/billing/reconcile/settle", ...adminOnly, asyncHandler(async (req, res) => {
  const reference = String(req.body?.reference ?? "").trim();
  if (!reference)
    return res.status(400).json({ success: false, code: "missing_reference", message: "Which transaction should be settled?" });
  if (!process.env.PAYSTACK_SECRET_KEY)
    return res.status(400).json({ success: false, code: "gateway_not_configured", message: "Paystack is not configured — set PAYSTACK_SECRET_KEY first." });

  let tx;
  try {
    const { data } = await paystackGet(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, PAYSTACK_AUTH());
    tx = data?.data ?? null;
  } catch (e) {
    return res.status(502).json({ success: false, code: "gateway_unavailable", message: "Could not verify that transaction with Paystack: " + (e.message ?? "unknown error") });
  }
  if (!tx) return res.status(404).json({ success: false, code: "not_found", message: "Paystack has no transaction with that reference." });
  if (tx.status !== "success")
    return res.status(409).json({ success: false, code: "not_successful", message: `That transaction is ${tx.status} on Paystack — only successful charges can be settled.` });

  // Replay the webhook path — fulfillment is idempotent, so already-aligned
  // state is a no-op and gaps close exactly the way the webhook would have.
  let wasOurs = false;
  try {
    wasOurs = await fulfillSubscriptionEvent({ event: "charge.success", data: tx });
  } catch (e) {
    console.error("[admin:reports] settle replay failed:", e.message);
    return res.status(500).json({ success: false, message: "Replaying fulfillment failed: " + e.message });
  }

  // A subscription that exists but never got its first invoice (the webhook
  // died between the two inserts) needs the invoice created directly.
  let outcome = wasOurs ? "replayed" : "ignored";
  const meta = tx.metadata ?? {};
  if (meta.purpose === "subscription" && meta.learner_user_id && meta.tier_id) {
    const { data: sub } = await db.from("subscriptions")
      .select("id, customer_id, tier_id, cycle, price, learner_user_id")
      .eq("learner_user_id", meta.learner_user_id).eq("tier_id", meta.tier_id)
      .in("status", ["active", "past_due", "paused"]).limit(1);
    if (sub?.length) {
      const { data: existing } = await db.from("invoices")
        .select("id").eq("subscription_id", sub[0].id).eq("status", "paid").limit(1);
      if (!existing?.length) {
        const today = todayStr();
        const { data: tier } = await db.from("tiers").select("name").eq("id", meta.tier_id).maybeSingle();
        const { data: learner } = await db.from("users").select("full_name").eq("id", meta.learner_user_id).maybeSingle();
        const amountNaira = Math.round((tx.amount ?? 0) / 100);
        const { error: invErr } = await db.from("invoices").insert({
          customer_id: sub[0].customer_id,
          subscription_id: sub[0].id,
          status: "paid",
          issued_at: today,
          due_at: today,
          paid_at: today,
          invoice_line_items: [{ description: `${tier?.name ?? "Plan"}, ${sub[0].cycle} (${learner?.full_name ?? "learner"})`, amount: amountNaira }],
        });
        if (!invErr) {
          await db.from("subscription_events").insert({ subscription_id: sub[0].id, text: "First invoice recorded via reconciliation" });
          outcome = "invoice_created";
        }
      }
    }
  }

  await audit(req, "reconciliation.settled", "billing", null,
    { reference, status: tx.status },
    { reference, outcome, amount_naira: Math.round((tx.amount ?? 0) / 100) });
  return ok(res, { reference, outcome });
}));

export default router;
