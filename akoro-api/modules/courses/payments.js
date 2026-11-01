/**
 * payments.js  —  Piabam Payments, Coupons, Commission & Transaction History
 *
 * Every sale automatically:
 *   1. Calculates platform commission from PLATFORM_COMMISSION_PERCENT env var
 *   2. Creates an instructor_earnings record (immutable audit trail)
 *   3. Snapshots commission % so future rate changes never alter old records
 *
 * Usage in app.js:
 *   app.use("/api/payments", paymentsRouter);
 *   app.use("/api",          paymentsRouter);
 */

import { Router }                         from "express";
import axios                              from "axios";
import { paystackPost, paystackGet }            from "../../lib/paystackBreaker.js";
import crypto                             from "crypto";
import { body, validationResult }         from "express-validator";
import db                                 from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { businessConfig }                 from "../../config/index.js";
import { cartHandlers }                   from "./cart.js";
import { recordPaymentItems, logPaymentEvent } from "../webhooks/paymentAudit.js";
import { notify }                           from "../notifications/events.js";
import { paystackSignatureValid } from "../../lib/safeCompare.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const res403 = (res, msg)             => res.status(403).json({ success: false, message: msg });
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

const now = () => new Date().toISOString();

/**
 * Fulfil a Paystack `charge.success` for course / cart payments.
 * Idempotent: enrollment upserts + earnings upsert onConflict + payment update
 * is gated on status='pending', so replays are safe. Returns true if this
 * charge belonged to a payments-ledger transaction (course or cart), else false
 * so a shared dispatcher can hand it to another domain.
 *
 * Exported so the unified /api/webhooks/paystack dispatcher can reuse the exact
 * same fulfillment logic after verifying the signature once from the raw body.
 */
export async function fulfillPaymentsCharge(data) {
  const { payment_id, course_id, user_id, coupon_id, is_cart_checkout, cart_course_ids, cart_listing_ids } = data?.metadata ?? {};
  if (!payment_id || !user_id) return false;

  // Atomically flip pending → success and ONLY proceed if this call won the
  // flip. Without this gate every Paystack retry (and the webhook-vs-verify
  // race) re-ran enrollment/earnings/counter/notify — resurrecting refunded
  // purchases and double-counting students/coupon uses. 0 rows updated means
  // it was already fulfilled (or refunded): idempotent no-op.
  const { data: won } = await db.from("payments")
    .update({ status: "success", paid_at: now(), provider_response: data })
    .eq("id", payment_id).eq("status", "pending")
    .select("id").maybeSingle();
  if (!won) return true;

  // Cart checkout — a single payment covers many items (courses and/or agent
  // teaching-guides). Fulfil the whole cart (previously the webhook enrolled
  // only the first course, so the rest were paid-for but never granted).
  const cartCourses  = Array.isArray(cart_course_ids)  ? cart_course_ids  : [];
  const cartListings = Array.isArray(cart_listing_ids) ? cart_listing_ids : [];
  if (is_cart_checkout && (cartCourses.length || cartListings.length)) {
    await cartHandlers.enrollFromCartWebhook({
      paymentId:      payment_id,
      userId:         user_id,
      cartCourseIds:  cartCourses,
      cartListingIds: cartListings,
      couponId:       coupon_id ?? null,
    });
    return true;
  }

  // Single-course checkout below.
  if (!course_id) return true;

  // Activate enrollment
  await db.from("enrollments").upsert(
    { user_id, course_id, payment_id, status: "active" }, { onConflict: "user_id,course_id" }
  );
  await db.rpc("increment_course_students", { course_id_input: course_id });

  // ── Instructor earnings record (immutable audit trail) ────────────────
  const { data: course }  = await db.from("courses").select("instructor_id, currency, title").eq("id", course_id).single();
  const { data: payment } = await db.from("payments").select("amount_paid").eq("id", payment_id).single();

  if (course?.instructor_id && payment?.amount_paid) {
    const split = calculateCommission(payment.amount_paid);
    await db.from("instructor_earnings").upsert({
      instructor_id:      course.instructor_id,
      course_id, payment_id, student_id: user_id,
      gross_amount:       payment.amount_paid,
      commission_percent: split.commissionPercent,
      commission_amount:  split.commissionAmount,
      net_amount:         split.netAmount,
      currency:           course.currency ?? "NGN",
      status:             "pending",
    }, { onConflict: "payment_id" });
    // Notify the instructor of the sale.
    notify.newSale({ instructorId: course.instructor_id, courseTitle: course.title, netNgn: split.netAmount / 100 });
  }

  // Notify the buyer that their purchase went through.
  notify.purchaseSuccess({ userId: user_id, itemTitle: course?.title || "your course", amountNgn: (payment?.amount_paid ?? 0) / 100 });

  // Record coupon use
  if (coupon_id) {
    try { await db.from("coupon_uses").insert({ coupon_id, user_id, payment_id }); } catch {}
    try { await db.rpc("increment_coupon_uses", { coupon_id_input: coupon_id }); } catch {}
  }

  // Direct (non-cart) course purchase — if it was also in the cart, remove it so
  // it doesn't linger there after being bought.
  try { await db.from("cart_items").delete().eq("user_id", user_id).eq("course_id", course_id); } catch {}

  console.log(`[payments] ✅ Enrolled user=${user_id}  course=${course_id}  net=₦${(payment?.amount_paid ?? 0) / 100}`);
  return true;
}

// ─── Commission helper ────────────────────────────────────────────────────────
// Reads from env — changing PLATFORM_COMMISSION_PERCENT only affects
// future purchases, never existing earnings records.

const calculateCommission = (grossKobo) => {
  const pct              = businessConfig.commissionPercent;
  const commissionAmount = Math.round(grossKobo * (pct / 100));
  const netAmount        = grossKobo - commissionAmount;
  return { commissionPercent: pct, commissionAmount, netAmount };
};

// ─── Coupon helpers ───────────────────────────────────────────────────────────

const validateCoupon = async (code, courseId, userId) => {
  const { data: coupon } = await db
    .from("coupons")
    .select("*")
    .eq("code", code.toUpperCase().trim())
    .eq("is_active", true)
    .single();

  if (!coupon) throw new Error("Invalid or expired coupon code");

  const nowDate = new Date();
  if (new Date(coupon.valid_from) > nowDate)      throw new Error("Coupon is not yet active");
  if (coupon.valid_until && new Date(coupon.valid_until) < nowDate) throw new Error("Coupon has expired");
  if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) throw new Error("Coupon usage limit reached");
  if (coupon.course_id && coupon.course_id !== courseId) throw new Error("Coupon is not valid for this course");

  const { data: used } = await db
    .from("coupon_uses")
    .select("id")
    .eq("coupon_id", coupon.id)
    .eq("user_id", userId)
    .single();
  if (used) throw new Error("You have already used this coupon");

  return coupon;
};

const applyCoupon = (coupon, originalKobo) => {
  if (coupon.discount_type === "percent")
    return Math.max(0, originalKobo - Math.round(originalKobo * (coupon.discount_value / 100)));
  return Math.max(0, originalKobo - coupon.discount_value);
};

// ─── Payment handlers ─────────────────────────────────────────────────────────

const paymentHandlers = {

  // POST /api/payments/initiate
  initiate: asyncHandler(async (req, res) => {
    const { course_id, coupon_code } = req.body;
    const userId = req.user.id;

    const { data: course } = await db
      .from("courses")
      .select("id, slug, title, price, discount_price, discount_expires_at, is_free, currency, instructor_id, is_published")
      .eq("id", course_id).single();

    if (!course)           return res404(res, "Course not found");
    if (!course.is_published) return res400(res, "Course is not yet available");

    const { data: existing } = await db
      .from("enrollments").select("id, status")
      .eq("user_id", userId).eq("course_id", course_id).single();
    if (existing?.status === "active") return res400(res, "Already enrolled");

    // Free course — enrol directly
    if (course.is_free || course.price === 0) {
      const { data: enrollment } = await db
        .from("enrollments")
        .upsert({ user_id: userId, course_id, status: "active" }, { onConflict: "user_id,course_id" })
        .select().single();
      await db.rpc("increment_course_students", { course_id_input: course_id });
      // Record a zero-amount success payment so the free course shows in history.
      try {
        const { data: freePayment } = await db.from("payments").insert({
          user_id: userId, course_id, amount_paid: 0, currency: course.currency ?? "NGN",
          payment_provider: "free", status: "success", paid_at: now(),
        }).select("id").single();
        if (freePayment?.id) await recordPaymentItems(freePayment.id, [{ item_type: "course", course_id, title: course.title, unit_price_kobo: 0, currency: course.currency ?? "NGN" }]);
      } catch { /* history record is best-effort */ }
      // If this course was sitting in the cart, drop it — it's now owned.
      try { await db.from("cart_items").delete().eq("user_id", userId).eq("course_id", course_id); } catch {}
      notify.enrolled({ userId, courseTitle: course.title });
      return res201(res, { free: true, enrollment });
    }

    // Effective price
    const nowDate        = new Date();
    const discountActive = course.discount_price &&
      (!course.discount_expires_at || new Date(course.discount_expires_at) > nowDate);
    let finalKobo        = discountActive ? course.discount_price : course.price;
    let couponRecord     = null;
    let discountKobo     = 0;

    if (coupon_code) {
      try {
        couponRecord = await validateCoupon(coupon_code, course_id, userId);
        const orig   = finalKobo;
        finalKobo    = applyCoupon(couponRecord, orig);
        discountKobo = orig - finalKobo;
      } catch (e) { return res400(res, e.message); }
    }

    const { data: user } = await db.from("users").select("email, full_name").eq("id", userId).single();
    const split          = calculateCommission(finalKobo);

    const { data: payment } = await db.from("payments").insert({
      user_id:          userId, course_id,
      amount_paid:      finalKobo,
      currency:         course.currency ?? "NGN",
      payment_provider: "paystack",
      status:           "pending",
      provider_response: {
        original_price: course.price, discount_applied: discountKobo,
        coupon_code: coupon_code ?? null,
        commission_percent: split.commissionPercent,
        commission_amount:  split.commissionAmount,
        instructor_net:     split.netAmount,
      },
    }).select().single();

    // Snapshot the single line item at init so the order is on record.
    await recordPaymentItems(payment.id, [{ item_type: "course", course_id, title: course.title, unit_price_kobo: finalKobo, currency: course.currency ?? "NGN" }]);

    const { data: psData } = await paystackPost(
      "https://api.paystack.co/transaction/initialize",
      {
        email:        user.email,
        amount:       finalKobo,
        currency:     course.currency ?? "NGN",
        reference:    `akoro_${payment.id}_${Date.now()}`,
        metadata:     { payment_id: payment.id, course_id, user_id: userId, course_title: course.title, coupon_id: couponRecord?.id ?? null },
        // Where Paystack redirects the learner's browser after payment. Must be
        // a frontend page (the webhook POST /api/payments/verify handles the
        // enrolment server-side). The course page re-checks access on ?payment.
        callback_url: `${process.env.FRONTEND_URL || "https://akoro.app"}/course/${course.slug}?payment=success`,
      },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    await db.from("payments").update({ provider_reference: psData.data.reference }).eq("id", payment.id);

    res201(res, {
      checkout_url: psData.data.authorization_url,
      reference:    psData.data.reference,
      payment_id:   payment.id,
      price_breakdown: {
        original_ngn:      course.price / 100,
        discount_ngn:      discountKobo / 100,
        final_ngn:         finalKobo / 100,
        coupon_applied:    coupon_code ?? null,
        commission_pct:    split.commissionPercent,
        platform_fee_ngn:  split.commissionAmount / 100,
        instructor_ngn:    split.netAmount / 100,
      },
    });
  }),

  // POST /api/payments/verify  (Paystack webhook — no JWT)
  verifyWebhook: asyncHandler(async (req, res) => {
    if (!paystackSignatureValid(JSON.stringify(req.body), req.headers["x-paystack-signature"]))
      return res.status(400).json({ success: false, message: "Invalid signature" });

    const { event, data } = req.body;
    if (event !== "charge.success") return res.status(200).json({ received: true });

    await fulfillPaymentsCharge(data);
    res.status(200).json({ success: true });
  }),

  // GET /api/payments/history
  history: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("payments")
      .select(`
        id, amount_paid, currency, payment_provider, provider_reference,
        status, paid_at, refunded_at, refund_reason, provider_response, created_at,
        courses ( id, title, cover_image_url,
          users!courses_instructor_id_fkey ( full_name ) )
      `)
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),

  // POST /api/payments/:paymentId/refund
  refund: asyncHandler(async (req, res) => {
    const { reason } = req.body;
    const userId = req.user.id;
    const { data: payment } = await db
      .from("payments")
      .select("id, user_id, course_id, amount_paid, paid_at, status, provider_response, courses(refund_window_days)")
      .eq("id", req.params.paymentId).single();

    if (!payment)                      return res404(res, "Payment not found");
    if (payment.user_id !== userId)      return res403(res, "Not authorised");
    if (payment.status !== "success")    return res400(res, `Cannot refund: status is ${payment.status}`);

    const windowDays = (payment.provider_response?.is_cart_checkout) ? 30 : (payment.courses?.refund_window_days ?? 30);
    const daysSince  = (Date.now() - new Date(payment.paid_at).getTime()) / 86_400_000;
    if (windowDays > 0 && daysSince > windowDays)
      return res400(res, `Refund window of ${windowDays} days has expired`);

    await performRefund(payment, { reason, byUserId: userId, isAdmin: false });
    res200(res, { message: "Refund processed" });
  }),
};

/**
 * Execute a refund on an already-loaded payment: flip status, mark earnings
 * refunded, revoke access for every covered item (cart-aware), and log the
 * transition. Shared by the learner self-service refund and the admin refund.
 */
export async function performRefund(payment, { reason = null, byUserId = null, isAdmin = false } = {}) {
  const meta    = payment.provider_response || {};
  const isCart  = !!meta.is_cart_checkout;
  const ownerId = payment.user_id;

  await db.from("payments").update({ status: "refunded", refunded_at: now(), refund_reason: reason ?? null }).eq("id", payment.id);
  await db.from("instructor_earnings").update({ status: "refunded" }).eq("payment_id", payment.id);
  await logPaymentEvent({
    eventType: "status_change", source: "refund", paymentId: payment.id,
    outcome: "refunded", detail: { from: "success", to: "refunded", reason: reason ?? null, by: byUserId, admin: isAdmin, is_cart: isCart },
  });
  notify.refundProcessed({ userId: ownerId, itemTitle: isCart ? "your order" : "your course", amountNgn: (payment.amount_paid || 0) / 100 });

  // Revoke access for every item the payment covered.
  const courseIds  = isCart ? (meta.course_ids  || []) : (payment.course_id ? [payment.course_id] : []);
  const listingIds = isCart ? (meta.listing_ids || []) : [];

  if (courseIds.length)
    await db.from("enrollments").update({ status: "refunded" }).eq("user_id", ownerId).in("course_id", courseIds);

  for (const listingId of listingIds) {
    try {
      const { data: listing } = await db.schema("edu").from("marketplace_listings").select("agent_id").eq("id", listingId).single();
      await db.schema("edu").from("agent_purchases").update({ access_granted: false, paystack_status: "refunded" })
        .eq("student_id", ownerId).eq("listing_id", listingId);
      if (listing?.agent_id) {
        const { data: prefs } = await db.schema("edu").from("user_agent_preferences").select("purchased_agents").eq("user_id", ownerId).single();
        const kept = (prefs?.purchased_agents || []).filter((a) => a !== listing.agent_id);
        await db.schema("edu").from("user_agent_preferences").update({ purchased_agents: kept }).eq("user_id", ownerId);
      }
    } catch { /* best-effort per item */ }
  }
}

// ─── Coupon handlers ──────────────────────────────────────────────────────────

const couponHandlers = {

  // POST /api/coupons
  create: asyncHandler(async (req, res) => {
    const { code, description, discount_type = "percent", discount_value, max_uses = null, course_id = null, valid_from = now(), valid_until = null } = req.body;

    if (!discount_value || discount_value <= 0) return res400(res, "discount_value must be > 0");
    if (discount_type === "percent" && discount_value > 100) return res400(res, "Percent cannot exceed 100");

    if (course_id && req.user.role !== "admin") {
      const { data: course } = await db.from("courses").select("instructor_id").eq("id", course_id).single();
      if (!course || course.instructor_id !== req.user.id)
        return res403(res, "You can only create coupons for your own courses");
    }

    const { data, error } = await db.from("coupons").insert({
      code: code.toUpperCase().trim(), description: description ?? null,
      discount_type, discount_value, max_uses,
      course_id: course_id ?? null,
      instructor_id: req.user.id,
      valid_from, valid_until: valid_until ?? null,
    }).select().single();

    if (error) {
      if (error.message.includes("unique")) return res400(res, "Coupon code already exists");
      throw new Error(error.message);
    }
    res201(res, data);
  }),

  // GET /api/coupons
  list: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("coupons")
      .select("*, courses ( id, title )")
      .eq("instructor_id", req.user.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),

  // POST /api/coupons/validate
  validate: asyncHandler(async (req, res) => {
    const { code, course_id } = req.body;
    try {
      const coupon = await validateCoupon(code, course_id, req.user.id);
      const { data: course } = await db.from("courses")
        .select("price, discount_price, discount_expires_at, currency").eq("id", course_id).single();
      const nowDate    = new Date();
      const baseKobo   = (course?.discount_price && (!course.discount_expires_at || new Date(course.discount_expires_at) > nowDate))
        ? course.discount_price : (course?.price ?? 0);
      const finalKobo  = applyCoupon(coupon, baseKobo);
      res200(res, {
        valid:           true, coupon_code: coupon.code,
        discount_type:   coupon.discount_type, discount_value: coupon.discount_value,
        original_ngn:    baseKobo / 100, final_ngn: finalKobo / 100, savings_ngn: (baseKobo - finalKobo) / 100,
      });
    } catch (e) { res200(res, { valid: false, message: e.message }); }
  }),

  // PATCH /api/coupons/:couponId
  toggle: asyncHandler(async (req, res) => {
    const { data: coupon } = await db.from("coupons").select("id, is_active, instructor_id").eq("id", req.params.couponId).single();
    if (!coupon) return res404(res, "Coupon not found");
    if (coupon.instructor_id !== req.user.id && req.user.role !== "admin") return res403(res, "Not authorised");
    const { data } = await db.from("coupons").update({ is_active: !coupon.is_active }).eq("id", coupon.id).select().single();
    res200(res, data);
  }),
};

// ─── Enrollment handlers ──────────────────────────────────────────────────────

const enrollmentHandlers = {
  listMine: asyncHandler(async (req, res) => {
    const { data, error } = await db.from("enrollments")
      .select(`id, status, progress, enrolled_at, expires_at,
        courses ( id, title, slug, cover_image_url, course_type, price, currency, is_free, total_hours,
          users!courses_instructor_id_fkey ( full_name, avatar_url ) )`)
      .eq("user_id", req.user.id).eq("status", "active").order("enrolled_at", { ascending: false });
    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),

  checkAccess: asyncHandler(async (req, res) => {
    // Access requires an ACTIVE enrollment — consistent with the content gate
    // and the Library, so a non-active enrollment is neither watchable nor listed.
    const { data } = await db.from("enrollments").select("id, status, progress, enrolled_at")
      .eq("user_id", req.user.id).eq("course_id", req.params.courseId).eq("status", "active").single();
    if (!data) return res404(res, "Not enrolled");
    res200(res, data);
  }),

  listStudents: asyncHandler(async (req, res) => {
    const { data, error } = await db.from("enrollments")
      .select("id, status, progress, enrolled_at, users ( id, full_name, username, email, avatar_url )")
      .eq("course_id", req.params.courseId).eq("status", "active").order("enrolled_at", { ascending: false });
    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),
};

// ─── Transaction history handlers ─────────────────────────────────────────────

const transactionHandlers = {

  // GET /api/transactions
  list: asyncHandler(async (req, res) => {
    const { limit = 50, offset = 0, status } = req.query;
    const userId = req.user.id;
    const role   = req.user.role;

    let q = db.from("payments")
      .select(`
        id, amount_paid, currency, payment_provider, provider_reference,
        status, paid_at, refunded_at, refund_reason, provider_response, created_at,
        users!payments_user_id_fkey ( id, full_name, username, email ),
        courses ( id, title, instructor_id,
          users!courses_instructor_id_fkey ( full_name ) )
      `, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status) q = q.eq("status", status);

    if (role === "student") {
      q = q.eq("user_id", userId);
    } else if (role === "instructor") {
      const { data: myCourses } = await db.from("courses").select("id").eq("instructor_id", userId);
      const ids = (myCourses ?? []).map((c) => c.id);
      if (!ids.length) return res200(res, [], { total: 0 });
      q = q.in("course_id", ids);
    }

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);

    const enriched = (data ?? []).map((p) => {
      const split = calculateCommission(p.amount_paid);
      return {
        ...p,
        commission_breakdown: {
          gross_ngn:      p.amount_paid / 100,
          commission_pct: split.commissionPercent,
          platform_ngn:   split.commissionAmount / 100,
          instructor_ngn: split.netAmount / 100,
        },
      };
    });

    res200(res, enriched, { total: count ?? 0 });
  }),

  // GET /api/transactions/summary
  summary: asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const role   = req.user.role;

    let q = db.from("payments").select("amount_paid, status, created_at, course_id");
    if (role === "student") {
      q = q.eq("user_id", userId);
    } else if (role === "instructor") {
      const { data: myCourses } = await db.from("courses").select("id").eq("instructor_id", userId);
      const ids = (myCourses ?? []).map((c) => c.id);
      if (!ids.length) return res200(res, { total_revenue_ngn: 0, total_orders: 0 });
      q = q.in("course_id", ids);
    }

    const { data: payments } = await q.eq("status", "success");
    const grossKobo = (payments ?? []).reduce((s, p) => s + p.amount_paid, 0);
    const split     = calculateCommission(grossKobo);

    res200(res, {
      total_orders:       payments?.length ?? 0,
      gross_revenue_ngn:  grossKobo / 100,
      platform_fee_ngn:   split.commissionAmount / 100,
      net_revenue_ngn:    split.netAmount / 100,
      commission_percent: businessConfig.commissionPercent,
    });
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

// Payments
router.post("/payments/initiate",             authenticateToken, [body("course_id").notEmpty()], runValidation, paymentHandlers.initiate);
router.post("/payments/verify",                                  paymentHandlers.verifyWebhook);
// The router used to be mounted twice (/api and /api/payments), so this webhook also answered at
// /api/payments/payments/verify. Kept only in case the Paystack dashboard points there; it says so in the log.
router.post("/payments/payments/verify", (req, _res, next) => { console.warn("[payments] Paystack webhook hit the old /api/payments/payments/verify — point the dashboard at /api/payments/verify"); next(); }, paymentHandlers.verifyWebhook);
router.get ("/payments/history",              authenticateToken, paymentHandlers.history);
router.post("/payments/:paymentId/refund",    authenticateToken, paymentHandlers.refund);

// Coupons
router.post  ("/coupons",                     authenticateToken, requireRole(["instructor", "admin"]), [body("code").notEmpty(), body("discount_value").isNumeric()], runValidation, couponHandlers.create);
router.get   ("/coupons",                     authenticateToken, requireRole(["instructor", "admin"]), couponHandlers.list);
router.post  ("/coupons/validate",            authenticateToken, [body("code").notEmpty(), body("course_id").notEmpty()], runValidation, couponHandlers.validate);
router.patch ("/coupons/:couponId",           authenticateToken, requireRole(["instructor", "admin"]), couponHandlers.toggle);

// Enrollments
router.get("/user/enrollments",               authenticateToken, enrollmentHandlers.listMine);
router.get("/courses/:courseId/students",     authenticateToken, requireRole(["instructor", "admin"]), enrollmentHandlers.listStudents);

// Transaction history
router.get("/transactions",                   authenticateToken, transactionHandlers.list);
router.get("/transactions/summary",           authenticateToken, transactionHandlers.summary);

export default router;
