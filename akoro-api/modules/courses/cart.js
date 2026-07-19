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

// Grant a purchased agent to a learner (idempotent): record the purchase, add
// the agent to their purchased_agents, and bump the listing's student count.
// Mirrors the marketplace's grantAgentAccess so cart + direct purchase agree.
const grantAgentFromCart = async (userId, { listingId, agentId, amountKobo = 0, currency = "NGN", paymentRef }) => {
  // Already owns it? skip.
  const { data: owned } = await db
    .schema("edu").from("agent_purchases")
    .select("id").eq("student_id", userId).eq("listing_id", listingId).eq("access_granted", true).single();
  if (owned) return;

  const purchaseId = crypto.randomUUID();
  try {
    await db.schema("edu").from("agent_purchases").insert({
      id: purchaseId, student_id: userId, agent_id: agentId, listing_id: listingId,
      amount_kobo: amountKobo, currency, paystack_ref: paymentRef || `CART-${purchaseId}`,
      paystack_status: "success", access_granted: true, verified_at: new Date(),
    });
  } catch { /* ignore duplicate */ }

  const { data: prefs } = await db
    .schema("edu").from("user_agent_preferences").select("purchased_agents").eq("user_id", userId).single();
  const existing = prefs?.purchased_agents || [];
  if (!existing.includes(agentId)) {
    await db.schema("edu").from("user_agent_preferences")
      .upsert({ user_id: userId, purchased_agents: [...existing, agentId], updated_at: new Date() }, { onConflict: "user_id" });
  }

  try {
    const { data: l } = await db.schema("edu").from("marketplace_listings").select("total_students").eq("id", listingId).single();
    if (l) await db.schema("edu").from("marketplace_listings")
      .update({ total_students: (l.total_students || 0) + 1, updated_at: new Date() }).eq("id", listingId);
  } catch { /* best-effort */ }
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
      id, added_at, item_type, course_id, listing_id,
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

  // Course line items.
  const courseLines = (items ?? []).map((item) => {
    if (item.item_type === "agent") return null;
    const course = item.courses;
    if (!course) return null;

    const discActive  = course.discount_price &&
      (!course.discount_expires_at || new Date(course.discount_expires_at) > nowDate);
    const priceKobo   = course.is_free ? 0 : (discActive ? course.discount_price : course.price);
    subtotalKobo     += priceKobo;

    return {
      cart_item_id:     item.id,
      item_type:        "course",
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

  // Agent (teaching-guide) line items — resolved from edu.marketplace_listings.
  const agentRows = (items ?? []).filter((i) => i.item_type === "agent" && i.listing_id);
  let agentLines = [];
  if (agentRows.length) {
    const { data: listings } = await db
      .schema("edu").from("marketplace_listings")
      .select("id, agent_id, title, subject, teacher_name, teacher_avatar, cover_image_url, price_kobo, currency, is_active")
      .in("id", agentRows.map((r) => r.listing_id));
    const byId = Object.fromEntries((listings ?? []).map((l) => [l.id, l]));
    agentLines = agentRows.map((r) => {
      const l = byId[r.listing_id];
      if (!l) return null;
      const priceKobo = l.price_kobo || 0;
      subtotalKobo += priceKobo;
      return {
        cart_item_id:    r.id,
        item_type:       "agent",
        listing_id:      l.id,
        agent_id:        l.agent_id,
        title:           l.title,
        subject:         l.subject,
        cover_image_url: l.cover_image_url,
        teacher_avatar:  l.teacher_avatar,
        instructor:      { full_name: l.teacher_name },
        price_ngn:       priceKobo / 100,
        price_kobo:      priceKobo,
        is_free:         priceKobo === 0,
        currency:        l.currency ?? "NGN",
        added_at:        r.added_at,
      };
    }).filter(Boolean);
  }

  const lineItems = [...courseLines, ...agentLines]
    .sort((a, b) => new Date(a.added_at) - new Date(b.added_at));

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
    const { course_id, item_type, listing_id } = req.body;
    const userId        = req.user.id;

    // ── Agent (teaching-guide) item ──────────────────────────────────────────
    if (item_type === "agent" || listing_id) {
      if (!listing_id) return res400(res, "listing_id required");

      const { data: listing } = await db
        .schema("edu").from("marketplace_listings")
        .select("id, title, agent_id, is_active")
        .eq("id", listing_id).eq("is_active", true).single();
      if (!listing) return res404(res, "Agent listing not found or inactive");

      // Skip if already purchased (owns the agent).
      const { data: owned } = await db
        .schema("edu").from("agent_purchases")
        .select("id").eq("student_id", userId).eq("listing_id", listing_id).eq("access_granted", true).single();
      if (owned) return res400(res, "You already own this agent");

      // Skip if already in cart.
      const { data: inCart } = await db
        .from("cart_items").select("id").eq("user_id", userId).eq("listing_id", listing_id).single();
      if (inCart) return res200(res, { already_in_cart: true, message: "Agent already in cart" });

      const { error } = await db
        .from("cart_items").insert({ user_id: userId, item_type: "agent", listing_id });
      if (error) throw new Error(error.message);

      const cart = await getCartWithPrices(userId);
      return res201(res, { added: true, course_title: listing.title, cart_summary: { item_count: cart.item_count, subtotal_ngn: cart.subtotal_ngn } });
    }

    // ── Course item ──────────────────────────────────────────────────────────
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
   * DELETE /api/cart/listing/:listingId
   * Remove an agent (teaching-guide) item from the cart.
   */
  removeListing: asyncHandler(async (req, res) => {
    const { error } = await db
      .from("cart_items")
      .delete()
      .eq("user_id", req.user.id)
      .eq("listing_id", req.params.listingId);

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
   * Optional body: { coupon_code, method }  — method: card | bank | ussd | any
   */
  checkout: asyncHandler(async (req, res) => {
    const { coupon_code, method } = req.body;
    // Map the chosen payment method to Paystack channels (omit → all methods).
    const CHANNELS = { card: ["card"], bank: ["bank", "bank_transfer"], ussd: ["ussd"] };
    const channels = CHANNELS[method] || null;
    const userId          = req.user.id;

    const cart = await getCartWithPrices(userId);
    if (!cart.items.length) return res400(res, "Cart is empty");

    // Filter out already-owned items (edge case — enrolled/purchased elsewhere).
    const courseIds = cart.items.filter((i) => i.item_type === "course").map((i) => i.course_id);
    const enrolledIds = courseIds.length
      ? ((await db.from("enrollments").select("course_id")
          .eq("user_id", userId).eq("status", "active").in("course_id", courseIds)).data ?? []).map((e) => e.course_id)
      : [];

    const checkoutItems = cart.items.filter((i) =>
      i.item_type === "agent" ? true : !enrolledIds.includes(i.course_id));

    if (!checkoutItems.length)
      return res400(res, "You already own everything in your cart");

    if (enrolledIds.length) {
      await db.from("cart_items").delete().eq("user_id", userId).in("course_id", enrolledIds);
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

    // Free cart — grant everything directly without Paystack
    if (totalKobo === 0) {
      for (const item of checkoutItems) {
        if (item.item_type === "agent") {
          await grantAgentFromCart(userId, { listingId: item.listing_id, agentId: item.agent_id, amountKobo: 0, currency: item.currency });
        } else {
          await db.from("enrollments").upsert(
            { user_id: userId, course_id: item.course_id, status: "active" },
            { onConflict: "user_id,course_id" }
          );
          try { await db.rpc("increment_course_students", { course_id_input: item.course_id }); } catch {}
        }
      }
      await db.from("cart_items").delete().eq("user_id", userId);
      return res200(res, { free: true, enrolled_count: checkoutItems.length, message: "Access granted to all free items" });
    }

    const { data: user } = await db.from("users").select("email, full_name").eq("id", userId).single();

    const courseCartIds  = checkoutItems.filter((i) => i.item_type === "course").map((i) => i.course_id);
    const listingCartIds = checkoutItems.filter((i) => i.item_type === "agent").map((i) => i.listing_id);

    // Create a single payment record for the cart. course_id is a representative
    // FK (first course, or null for an agent-only cart); the full item list lives
    // in the metadata below.
    const { data: payment, error: payErr } = await db
      .from("payments")
      .insert({
        user_id:          userId,
        course_id:        courseCartIds[0] ?? null,
        amount_paid:      totalKobo,
        currency:         "NGN",
        payment_provider: "paystack",
        status:           "pending",
        provider_response: {
          is_cart_checkout: true,
          course_ids:       courseCartIds,
          listing_ids:      listingCartIds,
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
        ...(channels ? { channels } : {}),
        metadata: {
          payment_id:        payment.id,
          course_id:         courseCartIds[0] ?? null,
          user_id:           userId,
          is_cart_checkout:  true,
          cart_course_ids:   courseCartIds,
          cart_listing_ids:  listingCartIds,
          coupon_id:         couponRecord?.id ?? null,
        },
        // Where Paystack redirects the BROWSER after payment — a real frontend
        // page, not the webhook. Fulfilment happens via the Paystack webhook
        // (POST /api/payments/verify), configured in the Paystack dashboard.
        callback_url: `${process.env.FRONTEND_URL || "https://akoro.app"}/checkout?payment=success&items=${checkoutItems.length}&amount=${totalKobo}`,
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
  enrollFromCartWebhook: async ({ paymentId, userId, cartCourseIds = [], cartListingIds = [], couponId }) => {
    if (!cartCourseIds.length && !cartListingIds.length) return;

    const { data: payment } = await db
      .from("payments").select("amount_paid, provider_reference").eq("id", paymentId).single();

    const totalItems  = cartCourseIds.length + cartListingIds.length;
    const perItemKobo = totalItems ? Math.round((payment?.amount_paid ?? 0) / totalItems) : 0;
    const perCourseKobo = perItemKobo;

    // ── Agent (teaching-guide) items ─────────────────────────────────────────
    if (cartListingIds.length) {
      const { data: listings } = await db
        .schema("edu").from("marketplace_listings")
        .select("id, agent_id, price_kobo, currency").in("id", cartListingIds);
      for (const listing of (listings ?? [])) {
        await grantAgentFromCart(userId, {
          listingId:  listing.id,
          agentId:    listing.agent_id,
          amountKobo: listing.price_kobo ?? perItemKobo,
          currency:   listing.currency ?? "NGN",
          paymentRef: payment?.provider_reference,
        });
      }
      await db.from("cart_items").delete().eq("user_id", userId).in("listing_id", cartListingIds);
    }

    for (const courseId of cartCourseIds) {
      // Activate enrollment
      await db.from("enrollments").upsert(
        { user_id: userId, course_id: courseId, payment_id: paymentId, status: "active" },
        { onConflict: "user_id,course_id" }
      );
      try { await db.rpc("increment_course_students", { course_id_input: courseId }); } catch {}

      // Create earnings record per instructor (correct commission per course)
      const { data: course } = await db
        .from("courses").select("instructor_id, currency").eq("id", courseId).single();

      if (course?.instructor_id) {
        const split = {
          pct:        businessConfig.commissionPercent,
          commission: Math.round(perCourseKobo * (businessConfig.commissionPercent / 100)),
        };
        split.net = perCourseKobo - split.commission;

        try {
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
          }, { onConflict: "payment_id,course_id" });
        } catch {}
      }
    }

    // Record coupon use
    if (couponId) {
      try { await db.from("coupon_uses").insert({ coupon_id: couponId, user_id: userId, payment_id: paymentId }); } catch {}
      try { await db.rpc("increment_coupon_uses", { coupon_id_input: couponId }); } catch {}
    }

    // Clear the cart
    await db.from("cart_items").delete().eq("user_id", userId).in("course_id", cartCourseIds);

    console.log(`[cart] ✅ Cart checkout enrolled user=${userId} in ${cartCourseIds.length} courses`);
  },
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

router.get   ("/cart",                      authenticateToken, handlers.get);
router.post  ("/cart",                      authenticateToken, handlers.add);   // course_id OR listing_id (validated in handler)
router.delete("/cart",                      authenticateToken, handlers.clear);
router.delete("/cart/listing/:listingId",   authenticateToken, handlers.removeListing);
router.delete("/cart/:courseId",            authenticateToken, handlers.remove);
router.post  ("/cart/move-from-wishlist",   authenticateToken, [body("course_id").notEmpty()], runValidation, handlers.moveFromWishlist);
router.post  ("/cart/apply-coupon",         authenticateToken, [body("coupon_code").notEmpty()], runValidation, handlers.applyCoupon);
router.post  ("/cart/checkout",             authenticateToken, handlers.checkout);

export { handlers as cartHandlers };
export default router;
