import { Router } from "express";
import { body, validationResult } from "express-validator";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/index.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const ok     = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const ok201  = (res, data)            => res.status(201).json({ success: true, data });
const err400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const err404 = (res, msg = "Not found") => res.status(404).json({ success: false, message: msg });

const validate = (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) { err400(res, errs.array()[0].msg); return false; }
  return true;
};

const periodStart = (period) => {
  const days = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 }[period] ?? 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
};

const groupByDate = (rows, dateField) => {
  const map = {};
  for (const row of rows) {
    const date = row[dateField]?.slice(0, 10);
    if (!date) continue;
    if (!map[date]) map[date] = [];
    map[date].push(row);
  }
  return map;
};

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get("/analytics/revenue", adminOnly, asyncHandler(async (req, res) => {
  const since = periodStart(req.query.period);

  const [successRes, refundRes] = await Promise.all([
    db.from("payments").select("amount_paid,paid_at").eq("status", "success").gte("paid_at", since),
    db.from("payments").select("amount_paid,paid_at").eq("status", "refunded").gte("paid_at", since),
  ]);
  if (successRes.error) throw successRes.error;
  if (refundRes.error) throw refundRes.error;

  const successRows = successRes.data ?? [];
  const refundRows  = refundRes.data ?? [];

  const total_revenue = successRows.reduce((s, r) => s + (r.amount_paid ?? 0), 0);
  const total_refunds = refundRows.reduce((s, r) => s + (r.amount_paid ?? 0), 0);
  const net_revenue   = total_revenue - total_refunds;

  const successByDate = groupByDate(successRows, "paid_at");
  const refundByDate  = groupByDate(refundRows,  "paid_at");
  const allDates = [...new Set([...Object.keys(successByDate), ...Object.keys(refundByDate)])].sort();

  const by_day = allDates.map((date) => ({
    date,
    revenue: (successByDate[date] ?? []).reduce((s, r) => s + (r.amount_paid ?? 0), 0),
    refunds: (refundByDate[date]  ?? []).reduce((s, r) => s + (r.amount_paid ?? 0), 0),
  }));

  ok(res, { total_revenue, total_refunds, net_revenue, by_day });
}));

router.get("/analytics/enrollments", adminOnly, asyncHandler(async (req, res) => {
  const since = periodStart(req.query.period);

  const { data, error } = await db.from("payments").select("paid_at").eq("status", "success").gte("paid_at", since);
  if (error) throw error;

  const rows = data ?? [];
  const byDate = groupByDate(rows, "paid_at");
  const by_day = Object.keys(byDate).sort().map((date) => ({ date, count: byDate[date].length }));

  ok(res, { total: rows.length, by_day });
}));

router.get("/analytics/users-growth", adminOnly, asyncHandler(async (req, res) => {
  const since = periodStart(req.query.period);

  const { data, error } = await db.from("users").select("created_at").gte("created_at", since);
  if (error) throw error;

  const rows = data ?? [];
  const byDate = groupByDate(rows, "created_at");
  const by_day = Object.keys(byDate).sort().map((date) => ({ date, count: byDate[date].length }));

  ok(res, { total: rows.length, by_day });
}));

router.get("/analytics/top-courses", adminOnly, asyncHandler(async (req, res) => {
  const { data, error } = await db.from("payments").select("course_id").eq("status", "success");
  if (error) throw error;

  const countMap = {};
  for (const row of data ?? []) {
    if (!row.course_id) continue;
    countMap[row.course_id] = (countMap[row.course_id] ?? 0) + 1;
  }

  const top10 = Object.entries(countMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const ids = top10.map(([id]) => id);

  const { data: courses, error: cErr } = await db.from("courses").select("id,title").in("id", ids);
  if (cErr) throw cErr;

  const titleMap = Object.fromEntries((courses ?? []).map((c) => [c.id, c.title]));

  const result = top10.map(([course_id, enrollments]) => ({
    course_id,
    title: titleMap[course_id] ?? null,
    enrollments,
  }));

  ok(res, result);
}));

// ── Payments ──────────────────────────────────────────────────────────────────

const PAYMENT_COLS = [
  "id,amount_paid,currency,status,payment_provider,paid_at,refunded_at,refund_reason",
  "user:users!user_id(email,full_name)",
  "course:courses!course_id(title)",
].join(",");

router.get("/payments", adminOnly, asyncHandler(async (req, res) => {
  const { search = "", status = "", limit = 50, offset = 0 } = req.query;
  const lim = Math.min(Number(limit) || 50, 200);
  const off = Number(offset) || 0;

  let q = db.from("payments")
    .select(PAYMENT_COLS, { count: "exact" })
    .order("paid_at", { ascending: false })
    .range(off, off + lim - 1);

  if (status) q = q.eq("status", status);
  if (search) q = q.eq("user.email", search);

  const { data, count, error } = await q;
  if (error) throw error;
  ok(res, data, { total: count, limit: lim, offset: off });
}));

router.get("/payments/stats", adminOnly, asyncHandler(async (req, res) => {
  const [revenueRes, refundRes, pendingRes, countRes] = await Promise.all([
    db.from("payments").select("amount_paid").eq("status", "success"),
    db.from("payments").select("amount_paid").eq("status", "refunded"),
    db.from("instructor_earnings").select("amount").eq("status", "pending"),
    db.from("payments").select("*", { count: "exact", head: true }).eq("status", "success"),
  ]);

  if (revenueRes.error) throw revenueRes.error;
  if (refundRes.error)  throw refundRes.error;
  if (pendingRes.error) throw pendingRes.error;
  if (countRes.error)   throw countRes.error;

  const total_revenue    = (revenueRes.data ?? []).reduce((s, r) => s + (r.amount_paid ?? 0), 0);
  const refunded_amount  = (refundRes.data  ?? []).reduce((s, r) => s + (r.amount_paid ?? 0), 0);
  const pending_payouts  = (pendingRes.data  ?? []).reduce((s, r) => s + (r.amount ?? 0), 0);

  ok(res, { total_revenue, pending_payouts, refunded_amount, success_count: countRes.count });
}));

router.patch("/payments/:id/refund",
  ...adminOnly,
  body("reason").optional().isString().trim(),
  asyncHandler(async (req, res) => {
    if (!validate(req, res)) return;
    const { reason = "" } = req.body;

    const { data, error } = await db.from("payments")
      .update({ status: "refunded", refunded_at: new Date().toISOString(), refund_reason: reason })
      .eq("id", req.params.id)
      .select(PAYMENT_COLS)
      .maybeSingle();

    if (error) throw error;
    if (!data) return err404(res, "Payment not found");
    ok(res, data);
  })
);

// ── Reviews ───────────────────────────────────────────────────────────────────

const REVIEW_COLS = [
  "id,rating,comment,reported_count,helpful_count,is_verified_purchase,created_at",
  "user:users!user_id(full_name,email)",
  "course:courses!course_id(title)",
].join(",");

router.get("/reviews", adminOnly, asyncHandler(async (req, res) => {
  const { search = "", min_rating, reported, limit = 50, offset = 0 } = req.query;
  const lim = Math.min(Number(limit) || 50, 200);
  const off = Number(offset) || 0;

  let q = db.from("reviews")
    .select(REVIEW_COLS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(off, off + lim - 1);

  if (search)     q = q.ilike("comment", `%${search}%`);
  if (min_rating) q = q.gte("rating", Number(min_rating));
  if (reported === "true") q = q.gt("reported_count", 0);

  const { data, count, error } = await q;
  if (error) throw error;
  ok(res, data, { total: count, limit: lim, offset: off });
}));

router.delete("/reviews/:id", adminOnly, asyncHandler(async (req, res) => {
  const { error } = await db.from("reviews").delete().eq("id", req.params.id);
  if (error) throw error;
  ok(res, { deleted: true });
}));

router.patch("/reviews/:id/clear-reports", adminOnly, asyncHandler(async (req, res) => {
  const { data, error } = await db.from("reviews")
    .update({ reported_count: 0 })
    .eq("id", req.params.id)
    .select(REVIEW_COLS)
    .maybeSingle();
  if (error) throw error;
  if (!data) return err404(res, "Review not found");
  ok(res, data);
}));

// ── Coupons ───────────────────────────────────────────────────────────────────

router.get("/coupons", adminOnly, asyncHandler(async (req, res) => {
  const { search = "", is_active, limit = 50, offset = 0 } = req.query;
  const lim = Math.min(Number(limit) || 50, 200);
  const off = Number(offset) || 0;

  let q = db.from("coupons")
    .select("*,used_count:coupon_uses(count)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(off, off + lim - 1);

  if (search)    q = q.ilike("code", `%${search}%`);
  if (is_active !== undefined && is_active !== "") q = q.eq("is_active", is_active === "true");

  const { data, count, error } = await q;
  if (error) throw error;
  ok(res, data, { total: count, limit: lim, offset: off });
}));

router.post("/coupons",
  ...adminOnly,
  body("code").notEmpty().withMessage("code is required").trim(),
  body("discount_type").isIn(["percent", "fixed"]).withMessage("discount_type must be percent or fixed"),
  body("discount_value").isFloat({ gt: 0 }).withMessage("discount_value must be > 0"),
  asyncHandler(async (req, res) => {
    if (!validate(req, res)) return;

    const { code, discount_type, discount_value, max_uses, course_id, valid_from, valid_until, is_active = true } = req.body;

    const payload = { code: code.toUpperCase(), discount_type, discount_value, is_active };
    if (max_uses    !== undefined) payload.max_uses    = max_uses;
    if (course_id   !== undefined) payload.course_id   = course_id;
    if (valid_from  !== undefined) payload.valid_from  = valid_from;
    if (valid_until !== undefined) payload.valid_until = valid_until;

    const { data, error } = await db.from("coupons").insert(payload).select("*").maybeSingle();
    if (error) throw error;
    ok201(res, data);
  })
);

router.patch("/coupons/:id",
  ...adminOnly,
  body("discount_value").optional().isFloat({ gt: 0 }),
  body("is_active").optional().isBoolean(),
  asyncHandler(async (req, res) => {
    if (!validate(req, res)) return;
    const allowed = ["discount_value", "max_uses", "valid_from", "valid_until", "is_active"];
    const patch = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    if (!Object.keys(patch).length) return err400(res, "No valid fields to update");

    const { data, error } = await db.from("coupons")
      .update(patch)
      .eq("id", req.params.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return err404(res, "Coupon not found");
    ok(res, data);
  })
);

router.delete("/coupons/:id", adminOnly, asyncHandler(async (req, res) => {
  const { error } = await db.from("coupons").delete().eq("id", req.params.id);
  if (error) throw error;
  ok(res, { deleted: true });
}));

router.get("/coupons/:id/uses", adminOnly, asyncHandler(async (req, res) => {
  const { data, error } = await db.from("coupon_uses")
    .select("*,user:users!user_id(email,full_name)")
    .eq("coupon_id", req.params.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  ok(res, data);
}));

// ── Announcements ─────────────────────────────────────────────────────────────

router.post("/announcements/send",
  ...adminOnly,
  body("title").notEmpty().withMessage("title is required").trim(),
  body("message").notEmpty().withMessage("message is required").trim(),
  body("target_role").isIn(["all", "student", "instructor"]).withMessage("target_role must be all, student, or instructor"),
  asyncHandler(async (req, res) => {
    if (!validate(req, res)) return;
    const { title, message, target_role } = req.body;

    let q = db.from("users").select("id");
    if (target_role !== "all") q = q.eq("role", target_role);

    const { data: users, error: uErr } = await q;
    if (uErr) throw uErr;
    if (!users?.length) return ok(res, { sent: 0 });

    const notifications = users.map((u) => ({
      user_id: u.id,
      type: "announcement",
      title,
      content: message,
      is_read: false,
    }));

    const { error: nErr } = await db.from("notifications").insert(notifications);
    if (nErr) throw nErr;

    ok(res, { sent: notifications.length });
  })
);

export default router;
