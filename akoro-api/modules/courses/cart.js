/**
 * modules/courses/cart.js  —  Akoro Cart & Checkout
 *
 * Supports two purchase flows:
 *   A. Direct purchase  →  POST /api/payments/initiate  (existing)
 *   B. Cart checkout    →  POST /api/cart/checkout      (this file)
 *
 * Cart is stored in Supabase cart_items table (not Redis — persists across devices).
 * One Paystack transaction covers all cart items.
 * On webhook success: enrols student in every course + creates per-instructor
 * earnings records with correct commission split.
 */

import { Router }                         from "express";
import axios                              from "axios";
import crypto                             from "crypto";
import { body, validationResult }         from "express-validator";
import db                                 from "../../db.js";
import { authenticateToken }              from "../auth/routes.js";
import { businessConfig }                 from "../../config/index.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

const now = () => new Date().toISOString();

// ─── Commission helper ────────────────────────────────────────────────────────

const calcCommission = (grossKobo) => {
  const pct    = businessConfig.commissionPercent;
  const fee    = Math.round(grossKobo * (pct / 100));
  return { commissionPercent: pct, commissionAmount: fee, netAmount: grossKobo - fee };
};

// ─── Cart helpers ─────────────────────────────────────────────────────────────

/**
 * getCartWithPrices
 * Fetches all cart items for a user, resolves current prices,
 * and returns line items + totals.
 */
const getCartWithPrices = async (userId) => {
  const { data: items, error } = await db
    .from("cart_items")
    .select(`
      id, added_at,
      courses (
        id, title, slug, cover_image_url, course_type,
        price, discount_price, discount_expires_at,
        currency, is_free, is_published,
        users!courses_instructor_id_fkey ( id, full_name, avatar_url )
      )
    `)
    .eq("user_id", userId)
    .order("added_at", { ascending: true });

  if (error) throw new Error(error.message);

  const nowDate = new Date();
  let subtotalKobo = 0;

  const lineItems = (items ?? []).map((item) => {
    const course   = item.courses;
    if (!course) return null;

    const discActive  = course.discount_price &&
      (!course.discount_expires_at || new Date(course.discount_expires_at) > nowDate);
    const priceKobo   = course.is_free ? 0 : (discActive ? course.discount_price : course.price);
    subtotalKobo     += priceKobo;

    return {
      cart_item_id:     item.id,
      course_id:        course.id,
      title:            course.title,
      slug:             course.slug,
      cover_image_url:  course.cover_image_url,
      course_type:      course.course_type,
      instructor:       course.users,
      original_price_ngn: course.price / 100,
      discount_active:  discActive,
      price_ngn:        priceKobo / 100,
      price_kobo:       priceKobo,
      is_free:          course.is_free,
      currency:         course.currency ?? "NGN",
      added_at:         item.added_at,
    };
  }).filter(Boolean);

  const split = calcCommission(subtotalKobo);

  return {
    items: lineItems,
    item_count:     lineItems.length,
    subtotal_ngn:   subtotalKobo / 100,
    subtotal_kobo:  subtotalKobo,
    commission_pct: split.commissionPercent,
  };
};

// ─── Handlers ─────────────────────────────────────────────────────────────────

const handlers = {

  /**
   * GET /api/cart
   * View current cart with resolved prices and totals.
   */
  get: asyncHandler(async (req, res) => {
    const cart = await getCartWithPrices(req.user.id);
    res200(res, cart);
  }),

  /**
   * POST /api/cart
   * Add a course to the cart.
   * Silently skips if already in cart or already enrolled.
   */
  add: asyncHandler(async (req, res) => {
    const { course_id } = req.body;
    const userId        = req.user.id;

    // Verify course exists and is published
    const { data: course } = await db
      .from("courses")
      .select("id, title, is_published, is_free")
      .eq("id", course_id)
      .single();

    if (!course)             return res404(res, "Course not found");
    if (!course.is_published) return res400(res, "Course is not available");

    // Skip if already enrolled
    const { data: enrolled } = await db
      .from("enrollments")
      .select("id")
      .eq("user_id", userId)
      .eq("course_id", course_id)
      .eq("status", "active")
      .single();

    if (enrolled) return res400(res, "You are already enrolled in this course");

    // Skip if already in cart
    const { data: inCart } = await db
      .from("cart_items")
      .select("id")
      .eq("user_id", userId)
      .eq("course_id", course_id)
      .single();

    if (inCart) return res200(res, { already_in_cart: true, message: "Course already in cart" });

    // Add to cart
    const { data, error } = await db
      .from("cart_items")
      .insert({ user_id: userId, course_id })
      .select()
      .single();

    if (error) throw new Error(error.message);

    const cart = await getCartWithPrices(userId);
    res201(res, { added: true, course_title: course.title, cart_summary: { item_count: cart.item_count, subtotal_ngn: cart.subtotal_ngn } });
  }),

  /**
   * DELETE /api/cart/:courseId
   * Remove a specific course from the cart.
   */
  remove: asyncHandler(async (req, res) => {
    const { error } = await db
      .from("cart_items")
      .delete()
      .eq("user_id", req.user.id)
      .eq("course_id", req.params.courseId);

    if (error) throw new Error(error.message);
    res200(res, { removed: true });
  }),

  /**
   * DELETE /api/cart
   * Clear the entire cart.
   */
  clear: asyncHandler(async (req, res) => {
    await db.from("cart_items").delete().eq("user_id", req.user.id);
    res200(res, { cleared: true });
  }),

  /**
   * POST /api/cart/move-from-wishlist
   * Move a course from wishlist → cart.
   * Removes from wishlist and adds to cart in one operation.
   */
  moveFromWishlist: asyncHandler(async (req, res) => {
    const { course_id } = req.body;
    const userId        = req.user.id;

    // Remove from wishlist
    await db.from("wishlists")
      .delete()
      .eq("user_id", userId)
      .eq("course_id", course_id);

    // Add to cart (upsert — safe if already there)
    const { data: course } = await db
      .from("courses").select("id, title, is_published").eq("id", course_id).single();

    if (!course || !course.is_published)
      return res400(res, "Course not available");

    await db.from("cart_items")
      .upsert({ user_id: userId, course_id }, { onConflict: "user_id,course_id" });

    const cart = await getCartWithPrices(userId);
    res200(res, {
      moved: true,
      course_title: course.title,
      cart_summary: { item_count: cart.item_count, subtotal_ngn: cart.subtotal_ngn },
    });
  }),

  /**
   * POST /api/cart/apply-coupon
   * Preview a coupon discount on the full cart total.
   * Does not save — just returns the discounted total for display.
   */
  applyCoupon: asyncHandler(async (req, res) => {
    const { coupon_code } = req.body;
    const userId          = req.user.id;

    const cart = await getCartWithPrices(userId);
    if (!cart.items.length) return res400(res, "Cart is empty");

    const { data: coupon } = await db
      .from("coupons")
      .select("*")
      .eq("code", coupon_code.toUpperCase().trim())
      .eq("is_active", true)
      .single();

    if (!coupon) return res400(res, "Invalid or expired coupon code");

    const nowDate = new Date();
    if (coupon.valid_until && new Date(coupon.valid_until) < nowDate)
      return res400(res, "Coupon has expired");
    if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses)
      return res400(res, "Coupon usage limit reached");

    // Coupon applies to specific course only — check if that course is in cart
    if (coupon.course_id) {
      const inCart = cart.items.find((i) => i.course_id === coupon.course_id);
      if (!inCart) return res400(res, "This coupon is not valid for any item in your cart");
    }

    // Calculate discount
    let discountKobo = 0;
    const originalKobo = cart.subtotal_kobo;

    if (coupon.discount_type === "percent") {
      discountKobo = Math.round(originalKobo * (coupon.discount_value / 100));
    } else {
      discountKobo = Math.min(coupon.discount_value, originalKobo);
    }

    const finalKobo = originalKobo - discountKobo;

    res200(res, {
      valid:             true,
      coupon_code:       coupon.code,
      discount_type:     coupon.discount_type,
      discount_value:    coupon.discount_value,
      original_ngn:      originalKobo / 100,
      discount_ngn:      discountKobo / 100,
      final_ngn:         finalKobo / 100,
      savings_ngn:       discountKobo / 100,
      item_count:        cart.items.length,
    });
  }),

  /**
   * POST /api/cart/checkout
   * Checkout the entire cart in one Paystack transaction.
   * On webhook success: enrolls student in all courses + creates per-instructor earnings.
   *
   * Optional body: { coupon_code }
   */
  checkout: asyncHandler(async (req, res) => {
    const { coupon_code } = req.body;
    const userId          = req.user.id;

    const cart = await getCartWithPrices(userId);
    if (!cart.items.length) return res400(res, "Cart is empty");

    // Filter out already-enrolled courses (edge case — user enrolled elsewhere)
    const courseIds        = cart.items.map((i) => i.course_id);
    const { data: enrolled } = await db
      .from("enrollments")
      .select("course_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .in("course_id", courseIds);

    const enrolledIds   = (enrolled ?? []).map((e) => e.course_id);
    const checkoutItems = cart.items.filter((i) => !enrolledIds.includes(i.course_id));

    if (!checkoutItems.length)
      return res400(res, "You are already enrolled in all courses in your cart");

    if (enrolledIds.length) {
      // Remove already-enrolled items from cart silently
      await db.from("cart_items")
        .delete()
        .eq("user_id", userId)
        .in("course_id", enrolledIds);
    }

    let totalKobo    = checkoutItems.reduce((s, i) => s + i.price_kobo, 0);
    let discountKobo = 0;
    let couponRecord = null;

    // Apply coupon if provided
    if (coupon_code) {
      const { data: coupon } = await db
        .from("coupons")
        .select("*")
        .eq("code", coupon_code.toUpperCase().trim())
        .eq("is_active", true)
        .single();

      if (coupon) {
        const nowDate = new Date();
        const valid   = (!coupon.valid_until || new Date(coupon.valid_until) > nowDate) &&
                        (coupon.max_uses === null || coupon.used_count < coupon.max_uses);
        if (valid) {
          couponRecord = coupon;
          if (coupon.discount_type === "percent") {
            discountKobo = Math.round(totalKobo * (coupon.discount_value / 100));
          } else {
            discountKobo = Math.min(coupon.discount_value, totalKobo);
          }
          totalKobo -= discountKobo;
        }
      }
    }

    // Free cart — enrol directly without Paystack
    if (totalKobo === 0) {
      for (const item of checkoutItems) {
        await db.from("enrollments").upsert(
          { user_id: userId, course_id: item.course_id, status: "active" },
          { onConflict: "user_id,course_id" }
        );
        await db.rpc("increment_course_students", { course_id_input: item.course_id }).catch(() => {});
      }
      await db.from("cart_items").delete().eq("user_id", userId);
      return res200(res, { free: true, enrolled_count: checkoutItems.length, message: "Enrolled in all free courses" });
    }

    const { data: user } = await db.from("users").select("email, full_name").eq("id", userId).single();

    // Create a single payment record for the cart
    const { data: payment, error: payErr } = await db
      .from("payments")
      .insert({
        user_id:          userId,
        course_id:        checkoutItems[0].course_id,    // primary FK — covers all via metadata
        amount_paid:      totalKobo,
        currency:         "NGN",
        payment_provider: "paystack",
        status:           "pending",
        provider_response: {
          is_cart_checkout: true,
          course_ids:       checkoutItems.map((i) => i.course_id),
          coupon_code:      coupon_code ?? null,
          discount_applied: discountKobo,
          item_count:       checkoutItems.length,
        },
      })
      .select()
      .single();

    if (payErr) throw new Error(payErr.message);

    // Paystack transaction
    const { data: psData } = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email:     user.email,
        amount:    totalKobo,
        currency:  "NGN",
        reference: `akoro_cart_${payment.id}_${Date.now()}`,
        metadata: {
          payment_id:       payment.id,
          course_id:        checkoutItems[0].course_id,
          user_id:          userId,
          is_cart_checkout: true,
          cart_course_ids:  checkoutItems.map((i) => i.course_id),
          coupon_id:        couponRecord?.id ?? null,
        },
        callback_url: `${process.env.APP_URL}/api/payments/verify`,
      },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    await db.from("payments").update({ provider_reference: psData.data.reference }).eq("id", payment.id);

    res201(res, {
      checkout_url:   psData.data.authorization_url,
      reference:      psData.data.reference,
      payment_id:     payment.id,
      cart_summary: {
        item_count:      checkoutItems.length,
        subtotal_ngn:    checkoutItems.reduce((s, i) => s + i.price_kobo, 0) / 100,
        discount_ngn:    discountKobo / 100,
        total_ngn:       totalKobo / 100,
        coupon_applied:  coupon_code ?? null,
        courses:         checkoutItems.map((i) => ({ id: i.course_id, title: i.title, price_ngn: i.price_ngn })),
      },
    });
  }),

  /**
   * POST /api/cart/webhook-enroll
   * Called by payments.js verifyWebhook when is_cart_checkout = true.
   * Enrolls student in all cart courses + creates per-instructor earnings.
   * Exported so payments.js webhook handler can call it.
   */
  enrollFromCartWebhook: async ({ paymentId, userId, cartCourseIds, couponId }) => {
    if (!cartCourseIds?.length) return;

    const { data: payment } = await db
      .from("payments").select("amount_paid").eq("id", paymentId).single();

    const perCourseKobo = Math.round((payment?.amount_paid ?? 0) / cartCourseIds.length);

    for (const courseId of cartCourseIds) {
      // Activate enrollment
      await db.from("enrollments").upsert(
        { user_id: userId, course_id: courseId, payment_id: paymentId, status: "active" },
        { onConflict: "user_id,course_id" }
      );
      await db.rpc("increment_course_students", { course_id_input: courseId }).catch(() => {});

      // Create earnings record per instructor (correct commission per course)
      const { data: course } = await db
        .from("courses").select("instructor_id, currency").eq("id", courseId).single();

      if (course?.instructor_id) {
        const split = {
          pct:        businessConfig.commissionPercent,
          commission: Math.round(perCourseKobo * (businessConfig.commissionPercent / 100)),
        };
        split.net = perCourseKobo - split.commission;

        await db.from("instructor_earnings").upsert({
          instructor_id:      course.instructor_id,
          course_id:          courseId,
          payment_id:         paymentId,
          student_id:         userId,
          gross_amount:       perCourseKobo,
          commission_percent: split.pct,
          commission_amount:  split.commission,
          net_amount:         split.net,
          currency:           course.currency ?? "NGN",
          status:             "pending",
        }, { onConflict: "payment_id,course_id" }).catch(() => {});
      }
    }

    // Record coupon use
    if (couponId) {
      await db.from("coupon_uses").insert({ coupon_id: couponId, user_id: userId, payment_id: paymentId }).catch(() => {});
      await db.rpc("increment_coupon_uses", { coupon_id_input: couponId }).catch(() => {});
    }

    // Clear the cart
    await db.from("cart_items").delete().eq("user_id", userId).in("course_id", cartCourseIds);

    console.log(`[cart] ✅ Cart checkout enrolled user=${userId} in ${cartCourseIds.length} courses`);
  },
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

router.get   ("/cart",                      authenticateToken, handlers.get);
router.post  ("/cart",                      authenticateToken, [body("course_id").notEmpty()], runValidation, handlers.add);
router.delete("/cart",                      authenticateToken, handlers.clear);
router.delete("/cart/:courseId",            authenticateToken, handlers.remove);
router.post  ("/cart/move-from-wishlist",   authenticateToken, [body("course_id").notEmpty()], runValidation, handlers.moveFromWishlist);
router.post  ("/cart/apply-coupon",         authenticateToken, [body("coupon_code").notEmpty()], runValidation, handlers.applyCoupon);
router.post  ("/cart/checkout",             authenticateToken, handlers.checkout);

export { handlers as cartHandlers };
export default router;
