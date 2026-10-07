/**
 * modules/admin/coupons.js — billing coupons (plan §4.6 Phase 3)
 *
 * All routes require role=admin. Mounted at /api/admin (see modules/admin/index.js).
 * Namespaced under /billing/coupons because /api/admin/coupons is the
 * platform's course-coupon surface.
 *
 *   GET    /api/admin/billing/coupons             list (with redemption counts)
 *   POST   /api/admin/billing/coupons             create
 *   PATCH  /api/admin/billing/coupons/:id         { action: pause | resume | end }
 *   GET    /api/admin/billing/coupons/:id         detail + redemptions
 *
 *   POST   /api/admin/subscriptions/:id/apply-coupon   { code }
 *   DELETE /api/admin/subscriptions/:id/coupon
 *
 * Coupons are applied from a subscription's page (admin), not at checkout —
 * same as the prototype. Eligibility/status/discount math lives in
 * lib/couponModel.js (contract-tested). Every mutation is audited.
 */

import { Router } from "express";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { couponStatus, couponText, couponEligibility, validateCouponInput, todayStr } from "../../lib/couponModel.js";

const router    = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const ok        = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function audit(req, action, entityType, entityId, before, after) {
  const { error } = await db.from("admin_audit_log").insert({
    actor: req.user?.id ?? null,
    actor_label: req.user?.full_name || req.user?.email || "admin",
    action, entity_type: entityType, entity_id: entityId,
    before: before ?? null, after: after ?? null,
  });
  if (error) console.error("[admin:coupons] audit insert failed:", error.message);
}

const COUPON_SELECT = "id, code, description, type, value, duration, months, max_redemptions, expires_at, first_time_only, paused, created_at, coupon_redemptions(id)";

const couponView = (row) => ({
  id: row.id,
  code: row.code,
  description: row.description ?? "",
  type: row.type,
  value: row.value,
  duration: row.duration,
  months: row.months,
  max_redemptions: row.max_redemptions,
  expires_at: row.expires_at,
  first_time_only: row.first_time_only,
  paused: row.paused,
  redeemed: (row.coupon_redemptions ?? []).length,
  created_at: row.created_at,
});

/* ── list + create ─────────────────────────────────────────────────────────── */

router.get("/billing/coupons", ...adminOnly, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);
  const { data, error } = await db.from("coupons")
    .select(COUPON_SELECT).order("created_at", { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return ok(res, (data ?? []).map(couponView));
}));

router.post("/billing/coupons", ...adminOnly, asyncHandler(async (req, res) => {
  const { errors, values } = validateCouponInput(req.body ?? {});
  if (Object.keys(errors).length)
    return res.status(400).json({ success: false, code: "invalid_coupon", message: Object.values(errors).join("; "), fields: errors });

  const { data, error } = await db.from("coupons").insert(values).select(COUPON_SELECT).single();
  if (error) {
    if (error.code === "23505") return res.status(409).json({ success: false, code: "duplicate_coupon", message: `Coupon ${values.code} already exists` });
    console.error("[admin:coupons] insert failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not create the coupon." });
  }
  await audit(req, "coupon.created", "coupon", data.id, null, { code: values.code, text: couponText(values) });
  return res.status(201).json({ success: true, data: couponView(data) });
}));

/* ── pause / resume / end ──────────────────────────────────────────────────── */

router.patch("/billing/coupons/:id", ...adminOnly, asyncHandler(async (req, res) => {
  const { action } = req.body ?? {};
  if (!["pause", "resume", "end"].includes(action))
    return res.status(400).json({ success: false, code: "invalid_action", message: "action must be pause, resume, or end" });

  const { data: row } = await db.from("coupons").select(COUPON_SELECT).eq("id", req.params.id).maybeSingle();
  if (!row) return res.status(404).json({ success: false, code: "not_found", message: "Coupon not found." });
  const before = couponView(row);

  const patch = { updated_at: new Date().toISOString() };
  if (action === "pause") patch.paused = true;
  else if (action === "resume") patch.paused = false;
  else {
    // "End coupon now" = expire it as of yesterday (prototype behavior).
    const d = new Date(`${todayStr()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    patch.paused = false;
    patch.expires_at = d.toISOString().slice(0, 10);
  }

  const { data, error } = await db.from("coupons").update(patch).eq("id", req.params.id).select(COUPON_SELECT).single();
  if (error) return res.status(500).json({ success: false, message: error.message });
  const after = couponView(data);

  await audit(req, `coupon.${action}`, "coupon", req.params.id,
    { status: couponStatus(before, before.redeemed) },
    { status: couponStatus(after, after.redeemed), code: after.code });
  return ok(res, after);
}));

/* ── detail + redemptions ──────────────────────────────────────────────────── */

router.get("/billing/coupons/:id", ...adminOnly, asyncHandler(async (req, res) => {
  const { data: row, error } = await db.from("coupons")
    .select(`${COUPON_SELECT}, coupon_redemptions(id, redeemed_at, subscriptions(id, status, customers(id, name), users!subscriptions_learner_user_id_fkey(full_name)))`)
    .eq("id", req.params.id).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: error.message });
  if (!row) return res.status(404).json({ success: false, code: "not_found", message: "Coupon not found." });

  const redemptions = (row.coupon_redemptions ?? []).map((r) => ({
    subscription_id: r.subscriptions?.id ?? null,
    learner: r.subscriptions?.users?.full_name ?? "—",
    customer: r.subscriptions?.customers?.name ?? "—",
    redeemed_at: r.redeemed_at,
  }));
  const view = couponView(row);
  return ok(res, { ...view, redemptions });
}));

/* ── apply / remove on a subscription ─────────────────────────────────────── */

router.post("/subscriptions/:id/apply-coupon", ...adminOnly, asyncHandler(async (req, res) => {
  const code = String(req.body?.code ?? "").trim().toUpperCase();
  if (!code) return res.status(400).json({ success: false, code: "invalid_code", message: "Pick a coupon to apply." });

  const { data: sub } = await db.from("subscriptions")
    .select("id, status, price, customer_id, discount_coupon_id, customers(id, name)")
    .eq("id", req.params.id).maybeSingle();
  if (!sub) return res.status(404).json({ success: false, code: "not_found", message: "Subscription not found." });

  const { data: coupon } = await db.from("coupons").select("*").eq("code", code).maybeSingle();
  if (!coupon) return res.status(404).json({ success: false, code: "not_found", message: `Coupon ${code} not found.` });

  const { count: redeemed } = await db.from("coupon_redemptions").select("id", { count: "exact", head: true }).eq("coupon_id", coupon.id);
  const { count: paidInvoices } = await db.from("invoices").select("id", { count: "exact", head: true })
    .eq("customer_id", sub.customer_id).eq("status", "paid");

  const reason = couponEligibility(coupon, redeemed ?? 0, {
    price: sub.price, status: sub.status,
    discount: sub.discount_coupon_id ? { id: sub.discount_coupon_id } : null,
  }, (paidInvoices ?? 0) > 0);
  if (reason) return res.status(409).json({ success: false, code: "coupon_not_eligible", message: reason });

  const { error: redemptionErr } = await db.from("coupon_redemptions").insert({ coupon_id: coupon.id, subscription_id: sub.id });
  if (redemptionErr) {
    if (redemptionErr.code === "23505") return res.status(409).json({ success: false, code: "coupon_not_eligible", message: "This subscription already has a coupon" });
    return res.status(500).json({ success: false, message: redemptionErr.message });
  }
  const { error: subErr } = await db.from("subscriptions")
    .update({ discount_coupon_id: coupon.id, updated_at: new Date().toISOString() }).eq("id", sub.id);
  if (subErr) return res.status(500).json({ success: false, message: subErr.message });

  const { error: eventErr } = await db.from("subscription_events")
    .insert({ subscription_id: sub.id, text: `Coupon ${coupon.code} applied (${couponText(coupon)})` });
  if (eventErr) console.error("[admin:coupons] event insert failed:", eventErr.message);

  await audit(req, "subscription.coupon_applied", "subscription", sub.id, { coupon: null }, { coupon: coupon.code, text: couponText(coupon) });
  return res.status(201).json({ success: true, data: { code: coupon.code, text: couponText(coupon) } });
}));

router.delete("/subscriptions/:id/coupon", ...adminOnly, asyncHandler(async (req, res) => {
  const { data: sub } = await db.from("subscriptions")
    .select("id, discount_coupon_id, coupons!subscriptions_discount_coupon_id_fkey(code)")
    .eq("id", req.params.id).maybeSingle();
  if (!sub) return res.status(404).json({ success: false, code: "not_found", message: "Subscription not found." });
  if (!sub.discount_coupon_id) return res.status(409).json({ success: false, code: "no_coupon", message: "This subscription has no coupon." });

  await db.from("coupon_redemptions").delete().eq("coupon_id", sub.discount_coupon_id).eq("subscription_id", sub.id);
  const { error } = await db.from("subscriptions")
    .update({ discount_coupon_id: null, updated_at: new Date().toISOString() }).eq("id", sub.id);
  if (error) return res.status(500).json({ success: false, message: error.message });

  const code = sub.coupons?.code ?? "coupon";
  const { error: eventErr } = await db.from("subscription_events")
    .insert({ subscription_id: sub.id, text: `Coupon ${code} removed` });
  if (eventErr) console.error("[admin:coupons] event insert failed:", eventErr.message);

  await audit(req, "subscription.coupon_removed", "subscription", sub.id, { coupon: code }, { coupon: null });
  return ok(res, { removed: code });
}));

export default router;
