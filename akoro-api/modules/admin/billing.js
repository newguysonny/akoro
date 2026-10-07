/**
 * modules/admin/billing.js — Subscriptions, Customers, Invoices
 * (plan §4.6 Phase 2: core billing entities, manual/offline payments)
 *
 * All routes require role=admin. Mounted at /api/admin (see modules/admin/index.js).
 *
 *   GET    /api/admin/subscriptions                     list (search + status handled client-side)
 *   GET    /api/admin/subscriptions/:id                 detail + timeline
 *   PATCH  /api/admin/subscriptions/:id                 notes / payment method ref
 *   POST   /api/admin/subscriptions/:id/pause           active   → paused
 *   POST   /api/admin/subscriptions/:id/resume          paused   → active
 *   POST   /api/admin/subscriptions/:id/cancel          billable → canceled (two-click in UI)
 *   POST   /api/admin/subscriptions/:id/reactivate      canceled → active
 *   POST   /api/admin/subscriptions/:id/extend-trial    trial    → +7 days
 *   POST   /api/admin/subscriptions/:id/retry-payment   past_due → active (+ open invoices paid)
 *
 *   GET    /api/admin/customers                         list (with embedded subscriptions)
 *   GET    /api/admin/customers/:id                     detail
 *   PATCH  /api/admin/customers/:id                     contact details / notes
 *
 *   GET    /api/admin/invoices                          list (with line items)
 *   GET    /api/admin/invoices/:id                      detail + derived timeline
 *   POST   /api/admin/invoices/:id/finalize             draft → open
 *   POST   /api/admin/invoices/:id/mark-paid            open   → paid   (manual/offline)
 *   POST   /api/admin/invoices/:id/void                 draft|open → void (two-click in UI)
 *
 * Rows are created by checkout / the gateway (Phase 3) — Phase 2 is the
 * entity + admin surface. Every mutation writes admin_audit_log; lifecycle
 * transitions also write subscription_events (the timeline).
 *
 * State machine + pure logic: lib/billingModel.js (contract-tested).
 */

import { Router } from "express";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import {
  applySubscriptionAction, applyInvoiceAction, invoiceTimeline, todayStr, isDateStr,
} from "../../lib/billingModel.js";
import config from "../../config/index.js";
import { getBillingSettings } from "../billing/delivery.js";

const router    = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const ok        = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ── shared selects ────────────────────────────────────────────────────────── */
const SUB_SELECT =
  "id, customer_id, learner_user_id, tier_id, status, cycle, price, next_date, " +
  "payment_method_ref, notes, retry_count, past_due_since, created_at, updated_at, " +
  "customers(id, name, email, phone, notes), " +
  "tiers(id, name, access, platform), " +
  "users!subscriptions_learner_user_id_fkey(id, full_name, email), " +
  "coupons!subscriptions_discount_coupon_id_fkey(id, code, type, value, duration, months)";
// gateway_authorization is deliberately NOT selected — it's a payment
// credential and never leaves the server.

const INV_SELECT =
  "id, customer_id, subscription_id, status, issued_at, due_at, paid_at, voided_at, created_at, " +
  "customers(id, name, email), " +
  "subscriptions(id, status, cycle, learner_user_id, users!subscriptions_learner_user_id_fkey(full_name)), " +
  "invoice_line_items(id, description, amount)";

/* ── audit + timeline helpers ──────────────────────────────────────────────── */
async function audit(req, action, entityType, entityId, before, after) {
  const { error } = await db.from("admin_audit_log").insert({
    actor: req.user?.id ?? null,
    actor_label: req.user?.full_name || req.user?.email || "admin",
    action, entity_type: entityType, entity_id: entityId,
    before: before ?? null, after: after ?? null,
  });
  if (error) console.error("[admin:billing] audit insert failed:", error.message);
}

async function addEvent(subscriptionId, text) {
  const { error } = await db.from("subscription_events").insert({ subscription_id: subscriptionId, text });
  if (error) console.error("[admin:billing] event insert failed:", error.message);
}

const subView = (row) => ({
  id: row.id,
  customer: row.customers ?? null,
  learner: row.users ? { id: row.users.id, name: row.users.full_name, email: row.users.email } : null,
  tier: row.tiers ? { id: row.tiers.id, name: row.tiers.name, access: row.tiers.access, platform: row.tiers.platform } : null,
  status: row.status,
  cycle: row.cycle,
  price: row.price,
  next_date: row.next_date,
  payment_method_ref: row.payment_method_ref,
  notes: row.notes ?? "",
  discount: row.coupons ? {
    id: row.coupons.id, code: row.coupons.code, type: row.coupons.type,
    value: row.coupons.value, duration: row.coupons.duration, months: row.coupons.months,
  } : null,
  retry_count: row.retry_count ?? 0,
  past_due_since: row.past_due_since ?? null,
  created_at: row.created_at,
});

const invView = (row) => ({
  id: row.id,
  customer: row.customers ? { id: row.customers.id, name: row.customers.name, email: row.customers.email } : null,
  subscription: row.subscriptions
    ? { id: row.subscriptions.id, status: row.subscriptions.status, learner_name: row.subscriptions.users?.full_name ?? null }
    : null,
  status: row.status,
  issued_at: row.issued_at,
  due_at: row.due_at,
  paid_at: row.paid_at,
  voided_at: row.voided_at,
  lines: (row.invoice_line_items ?? []).map((l) => ({ description: l.description, amount: l.amount })),
  created_at: row.created_at,
  timeline: invoiceTimeline({
    status: row.status, issued_at: row.issued_at, due_at: row.due_at,
    paid_at: row.paid_at, voided_at: row.voided_at, created_at: row.created_at,
  }),
});

/* ═══ SUBSCRIPTIONS ═════════════════════════════════════════════════════════ */

router.get("/subscriptions", ...adminOnly, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);
  const { data, error } = await db.from("subscriptions")
    .select(SUB_SELECT).order("created_at", { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return ok(res, (data ?? []).map(subView));
}));

router.get("/subscriptions/:id", ...adminOnly, asyncHandler(async (req, res) => {
  const { data: row, error } = await db.from("subscriptions").select(SUB_SELECT).eq("id", req.params.id).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: error.message });
  if (!row) return res.status(404).json({ success: false, code: "not_found", message: "Subscription not found." });

  const { data: events } = await db.from("subscription_events")
    .select("id, at, text").eq("subscription_id", req.params.id).order("at", { ascending: false }).limit(200);
  return ok(res, { ...subView(row), timeline: events ?? [] });
}));

router.patch("/subscriptions/:id", ...adminOnly, asyncHandler(async (req, res) => {
  const { data: row } = await db.from("subscriptions").select(SUB_SELECT).eq("id", req.params.id).maybeSingle();
  if (!row) return res.status(404).json({ success: false, code: "not_found", message: "Subscription not found." });

  const patch = {};
  if (req.body.notes !== undefined) {
    if (typeof req.body.notes !== "string" || req.body.notes.length > 5000)
      return res.status(400).json({ success: false, code: "invalid_notes", message: "Notes must be text (5000 max)." });
    patch.notes = req.body.notes;
  }
  if (req.body.payment_method_ref !== undefined) {
    if (typeof req.body.payment_method_ref !== "string" || req.body.payment_method_ref.length > 120)
      return res.status(400).json({ success: false, code: "invalid_method", message: "Payment method reference must be text (120 max)." });
    patch.payment_method_ref = req.body.payment_method_ref || null;
  }
  if (!Object.keys(patch).length) return ok(res, subView(row), { unchanged: true });

  patch.updated_at = new Date().toISOString();
  const { data, error } = await db.from("subscriptions").update(patch).eq("id", req.params.id).select(SUB_SELECT).single();
  if (error) return res.status(500).json({ success: false, message: error.message });

  await audit(req, "subscription.updated", "subscription", req.params.id,
    { notes: row.notes, payment_method_ref: row.payment_method_ref },
    { notes: data.notes, payment_method_ref: data.payment_method_ref });
  return ok(res, subView(data));
}));

/* Lifecycle action endpoint factory: POST /subscriptions/:id/<action> */
function subscriptionActionEndpoint(action) {
  return asyncHandler(async (req, res) => {
    const { data: row } = await db.from("subscriptions").select(SUB_SELECT).eq("id", req.params.id).maybeSingle();
    if (!row) return res.status(404).json({ success: false, code: "not_found", message: "Subscription not found." });

    const sub = { ...subView(row), tier_access: row.tiers?.access };
    const { patch, event, error } = applySubscriptionAction(action, sub);
    if (error) return res.status(409).json({ success: false, code: error.code, message: error.message });

    patch.updated_at = new Date().toISOString();
    const { data, error: updateErr } = await db.from("subscriptions").update(patch).eq("id", req.params.id).select(SUB_SELECT).single();
    if (updateErr) return res.status(500).json({ success: false, message: updateErr.message });

    if (event) await addEvent(req.params.id, event);

    // A successful payment retry also settles the subscription's open invoices.
    if (action === "retry-payment") {
      const { data: open } = await db.from("invoices").select("id").eq("subscription_id", req.params.id).eq("status", "open");
      for (const inv of open ?? []) {
        const today = todayStr();
        const { error: markErr } = await db.from("invoices")
          .update({ status: "paid", paid_at: today, updated_at: new Date().toISOString() }).eq("id", inv.id);
        if (!markErr) await audit(req, "invoice.marked_paid", "invoice", inv.id, { status: "open" }, { status: "paid", paid_at: today, via: "payment retry" });
      }
    }

    await audit(req, `subscription.${action.replace(/-/g, "_")}`, "subscription", req.params.id,
      { status: row.status, next_date: row.next_date },
      { status: data.status, next_date: data.next_date });
    return ok(res, subView(data));
  });
}
for (const action of ["pause", "resume", "cancel", "reactivate", "extend-trial", "retry-payment"]) {
  router.post(`/subscriptions/:id/${action}`, ...adminOnly, subscriptionActionEndpoint(action));
}

/* ═══ CUSTOMERS ═════════════════════════════════════════════════════════════ */

router.get("/customers", ...adminOnly, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);
  const { data, error } = await db.from("customers")
    .select(`id, name, email, phone, notes, created_at, subscriptions(${SUB_SELECT})`)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ success: false, message: error.message });

  const out = (data ?? []).map((c) => ({
    id: c.id, name: c.name, email: c.email, phone: c.phone ?? "", notes: c.notes ?? "", created_at: c.created_at,
    subscriptions: (c.subscriptions ?? []).map(subView),
  }));
  return ok(res, out);
}));

router.get("/customers/:id", ...adminOnly, asyncHandler(async (req, res) => {
  const { data: c, error } = await db.from("customers")
    .select(`id, name, email, phone, notes, created_at, subscriptions(${SUB_SELECT})`)
    .eq("id", req.params.id).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: error.message });
  if (!c) return res.status(404).json({ success: false, code: "not_found", message: "Customer not found." });
  return ok(res, {
    id: c.id, name: c.name, email: c.email, phone: c.phone ?? "", notes: c.notes ?? "", created_at: c.created_at,
    subscriptions: (c.subscriptions ?? []).map(subView),
  });
}));

router.patch("/customers/:id", ...adminOnly, asyncHandler(async (req, res) => {
  const { data: c } = await db.from("customers").select("*").eq("id", req.params.id).maybeSingle();
  if (!c) return res.status(404).json({ success: false, code: "not_found", message: "Customer not found." });

  const patch = {};
  const errors = {};
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) errors.name = "Name cannot be empty";
    else if (name.length > 200) errors.name = "Name is too long (200 max)";
    else patch.name = name;
  }
  if (req.body.email !== undefined) {
    const email = String(req.body.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address";
    else patch.email = email;
  }
  if (req.body.phone !== undefined) {
    const phone = String(req.body.phone).trim();
    if (phone.length > 30) errors.phone = "Phone is too long (30 max)";
    else patch.phone = phone || null;
  }
  if (req.body.notes !== undefined) {
    if (typeof req.body.notes !== "string" || req.body.notes.length > 5000) errors.notes = "Notes must be text (5000 max).";
    else patch.notes = req.body.notes;
  }
  if (Object.keys(errors).length)
    return res.status(400).json({ success: false, code: "invalid_customer_fields", message: Object.values(errors).join("; "), fields: errors });
  if (!Object.keys(patch).length) return ok(res, c, { unchanged: true });

  patch.updated_at = new Date().toISOString();
  const { data, error } = await db.from("customers").update(patch).eq("id", req.params.id).select().single();
  if (error) {
    if (error.code === "23505") return res.status(409).json({ success: false, code: "duplicate_customer", message: "Another customer already uses that email." });
    return res.status(500).json({ success: false, message: error.message });
  }

  await audit(req, "customer.updated", "customer", req.params.id,
    { name: c.name, email: c.email, phone: c.phone, notes: c.notes },
    { name: data.name, email: data.email, phone: data.phone, notes: data.notes });
  return ok(res, data);
}));

/* ═══ INVOICES ══════════════════════════════════════════════════════════════ */

router.get("/invoices", ...adminOnly, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);
  const { data, error } = await db.from("invoices")
    .select(INV_SELECT).order("created_at", { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return ok(res, (data ?? []).map(invView));
}));

router.get("/invoices/:id", ...adminOnly, asyncHandler(async (req, res) => {
  const { data: row, error } = await db.from("invoices").select(INV_SELECT).eq("id", req.params.id).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: error.message });
  if (!row) return res.status(404).json({ success: false, code: "not_found", message: "Invoice not found." });
  return ok(res, invView(row));
}));

/* Invoice action endpoint factory: POST /invoices/:id/<action> */
function invoiceActionEndpoint(action) {
  return asyncHandler(async (req, res) => {
    const { data: row } = await db.from("invoices").select(INV_SELECT).eq("id", req.params.id).maybeSingle();
    if (!row) return res.status(404).json({ success: false, code: "not_found", message: "Invoice not found." });

    const { patch, error } = applyInvoiceAction(action, row.status);
    if (error) return res.status(409).json({ success: false, code: error.code, message: error.message });

    // Finalize stamps issued/due with today when unset (first finalize).
    const today = todayStr();
    if (action === "finalize") {
      if (!isDateStr(row.issued_at)) patch.issued_at = today;
      if (!isDateStr(row.due_at)) patch.due_at = today;
    }
    patch.updated_at = new Date().toISOString();

    const { data, error: updateErr } = await db.from("invoices").update(patch).eq("id", req.params.id).select(INV_SELECT).single();
    if (updateErr) return res.status(500).json({ success: false, message: updateErr.message });

    await audit(req, `invoice.${action.replace(/-/g, "_")}`, "invoice", req.params.id,
      { status: row.status }, { status: data.status, paid_at: data.paid_at ?? null, voided_at: data.voided_at ?? null });
    return ok(res, invView(data));
  });
}
for (const action of ["finalize", "mark-paid", "void"]) {
  router.post(`/invoices/:id/${action}`, ...adminOnly, invoiceActionEndpoint(action));
}

/* ═══ BILLING SETTINGS (plan §4.6 #4 — gateway/notification/branding) ═══════ */

const SETTINGS_DEFAULTS = {
  email_from_name: "Akoro",
  email_from_address: process.env.RESEND_FROM_EMAIL || "noreply@akoro.app",
  support_email: null,
  notify_payment_failed: true,
  notify_trial_ending: true,
  notify_pilot_ending: true,
};

const gatewayStatus = () => {
  const sk = config.paystack?.secretKey ?? null;
  return {
    paystack_mode:             sk ? (sk.startsWith("sk_live_") ? "live" : "test") : "not_configured",
    paystack_public_key:       Boolean(config.paystack?.publicKey),
    paystack_secret_key:       Boolean(sk),
    webhook_url:               `${config.apiBaseUrl?.replace(/\/$/, "") ?? ""}/api/webhooks/paystack`,
    email_provider_configured: Boolean(process.env.RESEND_API_KEY),
    sms_provider_configured:   Boolean(config.twilio?.accountSid && config.twilio?.authToken && config.twilio?.phoneNumber),
  };
};

router.get("/billing-settings", ...adminOnly, asyncHandler(async (req, res) => {
  const settings = await getBillingSettings();
  return ok(res, { settings, gateway: gatewayStatus() });
}));

router.patch("/billing-settings", ...adminOnly, asyncHandler(async (req, res) => {
  const current = await getBillingSettings();
  const patch = {};
  const errors = {};

  if (req.body.email_from_name !== undefined) {
    const v = String(req.body.email_from_name).trim();
    if (!v || v.length > 80) errors.email_from_name = "Sender name must be 1–80 characters.";
    else patch.email_from_name = v;
  }
  if (req.body.email_from_address !== undefined) {
    const v = String(req.body.email_from_address).trim().toLowerCase();
    if (!EMAIL_RE.test(v)) errors.email_from_address = "Enter a valid from address.";
    else patch.email_from_address = v;
  }
  if (req.body.support_email !== undefined) {
    const v = String(req.body.support_email ?? "").trim().toLowerCase();
    if (v && !EMAIL_RE.test(v)) errors.support_email = "Enter a valid support address.";
    else patch.support_email = v || null;
  }
  for (const flag of ["notify_payment_failed", "notify_trial_ending", "notify_pilot_ending"]) {
    if (req.body[flag] !== undefined) {
      if (typeof req.body[flag] !== "boolean") errors[flag] = "Must be true or false.";
      else patch[flag] = req.body[flag];
    }
  }
  if (Object.keys(errors).length)
    return res.status(400).json({ success: false, code: "invalid_billing_settings", message: Object.values(errors).join("; "), fields: errors });
  if (!Object.keys(patch).length) return ok(res, { settings: current, gateway: gatewayStatus(), unchanged: true });

  patch.updated_at = new Date().toISOString();
  const { data, error } = await db.from("billing_settings").update(patch).eq("id", true).select().single();
  if (error) return res.status(500).json({ success: false, message: error.message });

  await audit(req, "billing_settings.updated", "billing_settings", true,
    { ...SETTINGS_DEFAULTS, ...current }, { ...SETTINGS_DEFAULTS, ...data });
  return ok(res, { settings: data, gateway: gatewayStatus() });
}));

export default router;
