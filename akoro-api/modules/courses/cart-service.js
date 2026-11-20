/**
 * cart-service.js — request orchestration for cart and checkout.
 *
 * Resolves cart totals, previews coupons, reconciles Paystack payments and
 * fulfils a cart (free, voucher/coins, or Paystack). Every query is behind
 * cart-store.js and every pure pricing rule is in cart-rules.js; cart.js is
 * only the mounted router.
 */

import { paystackPost } from "../../lib/paystackBreaker.js";
import { verifyTransaction } from "../../lib/paystackService.js";
import { recordPaymentItems } from "../../lib/paymentAudit.js";
import { notify } from "../notifications/index.js";
import { redeemVoucher, VoucherError, voucherRedeemConfigured } from "../../lib/voucherRedeem.js";
import { creditTopup, debitCoins, refundCoins, hasCoins } from "../../lib/coins.js";
import { nairaToCoins } from "../../lib/aiPricing.js";
import { urlFor } from "../../lib/urls.js";
import * as store from "./cart-store.js";
import {
  buildCart, calcCommission, checkoutChannels, couponDiscountKobo, couponIsValid, toPaymentItems,
} from "./cart-rules.js";

// ─── § HELPERS ────────────────────────────────────────────────────────────────

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
export const res201 = (res, data)            => res.status(201).json({ success: true,  data });
export const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
export const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

/**
 * getCartWithPrices
 * Fetches all cart items for a user, resolves current prices,
 * and returns line items + totals.
 */
const getCartWithPrices = async (userId) => {
  const { data: items, error } = await store.listCartItems(userId);
  if (error) throw new Error(error.message);

  // Self-heal: drop any course the user already owns (e.g. bought directly from
  // the course page while it was still sitting in the cart). This keeps the cart
  // correct even before the purchase webhook has pruned it server-side.
  const ownedCourseIds = new Set();
  const cartCourseIds = (items ?? []).filter((i) => i.item_type === "course" && i.course_id).map((i) => i.course_id);
  if (cartCourseIds.length) {
    const { data: enrolled } = await store.listActiveEnrollmentCourseIds(userId, cartCourseIds);
    (enrolled ?? []).forEach((e) => ownedCourseIds.add(e.course_id));
    if (ownedCourseIds.size) {
      try { await store.deleteCartCourses(userId, [...ownedCourseIds]); } catch {}
    }
  }
  const visibleItems = (items ?? []).filter((i) => !(i.item_type === "course" && ownedCourseIds.has(i.course_id)));

  // Agent (teaching-guide) line items — resolved from edu.marketplace_listings.
  const agentRows = visibleItems.filter((i) => i.item_type === "agent" && i.listing_id);
  let listingsById = {};
  if (agentRows.length) {
    const { data: listings } = await store.listAgentListings(agentRows.map((r) => r.listing_id));
    listingsById = Object.fromEntries((listings ?? []).map((l) => [l.id, l]));
  }

  return buildCart({ itemRows: visibleItems, listingsById });
};

// ─── § HANDLERS ───────────────────────────────────────────────────────────────

export const handlers = {

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

      const { data: listing } = await store.findActiveAgentListing(listing_id);
      if (!listing) return res404(res, "Agent listing not found or inactive");

      // Skip if already purchased (owns the agent).
      const { data: owned } = await store.findOwnedAgent(userId, listing_id);
      if (owned) return res400(res, "You already own this agent");

      // Skip if already in cart.
      const { data: inCart } = await store.findCartItemByListing(userId, listing_id);
      if (inCart) return res200(res, { already_in_cart: true, message: "Agent already in cart" });

      const { error } = await store.insertAgentCartItem(userId, listing_id);
      if (error) throw new Error(error.message);

      const cart = await getCartWithPrices(userId);
      return res201(res, { added: true, course_title: listing.title, cart_summary: { item_count: cart.item_count, subtotal_ngn: cart.subtotal_ngn } });
    }

    // ── Course item ──────────────────────────────────────────────────────────
    // Verify course exists and is published
    const { data: course } = await store.findCourse(course_id);

    if (!course)             return res404(res, "Course not found");
    if (!course.is_published) return res400(res, "Course is not available");

    // Skip if already enrolled
    const { data: enrolled } = await store.findActiveEnrollment(userId, course_id);

    if (enrolled) return res400(res, "You are already enrolled in this course");

    // Skip if already in cart
    const { data: inCart } = await store.findCartItemByCourse(userId, course_id);

    if (inCart) return res200(res, { already_in_cart: true, message: "Course already in cart" });

    // Add to cart
    const { error } = await store.insertCourseCartItem(userId, course_id);

    if (error) throw new Error(error.message);

    const cart = await getCartWithPrices(userId);
    res201(res, { added: true, course_title: course.title, cart_summary: { item_count: cart.item_count, subtotal_ngn: cart.subtotal_ngn } });
  }),

  /**
   * DELETE /api/cart/:courseId
   * Remove a specific course from the cart.
   */
  remove: asyncHandler(async (req, res) => {
    const { error } = await store.deleteCartCourse(req.user.id, req.params.courseId);

    if (error) throw new Error(error.message);
    res200(res, { removed: true });
  }),

  /**
   * DELETE /api/cart/listing/:listingId
   * Remove an agent (teaching-guide) item from the cart.
   */
  removeListing: asyncHandler(async (req, res) => {
    const { error } = await store.deleteCartListing(req.user.id, req.params.listingId);

    if (error) throw new Error(error.message);
    res200(res, { removed: true });
  }),

  /**
   * DELETE /api/cart
   * Clear the entire cart.
   */
  clear: asyncHandler(async (req, res) => {
    await store.clearCart(req.user.id);
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
    await store.removeWishlistItem(userId, course_id);

    // Add to cart (upsert — safe if already there)
    const { data: course } = await store.findPublishedCourse(course_id);

    if (!course || !course.is_published)
      return res400(res, "Course not available");

    await store.upsertCartCourse(userId, course_id);

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

    const { data: coupon } = await store.findActiveCoupon(coupon_code.toUpperCase().trim());

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
    const originalKobo = cart.subtotal_kobo;
    const discountKobo = couponDiscountKobo(coupon, originalKobo);
    const finalKobo    = originalKobo - discountKobo;

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
   * GET /api/cart/verify/:reference
   * Actively reconcile a cart payment with Paystack — a safety net for when the
   * webhook is delayed or missed. Idempotent + race-safe: it only fulfils if it
   * is the one to flip the payment pending→success (the webhook may win instead),
   * and enrollFromCartWebhook's upserts/ownership checks make a double-run safe.
   */
  verifyCheckout: asyncHandler(async (req, res) => {
    const { reference } = req.params;
    const userId = req.user.id;

    const { data: payment } = await store.findPaymentByReference(reference, userId);
    if (!payment) return res404(res, "Payment not found");
    if (payment.status === "success")
      return res200(res, { fulfilled: true, already: true });

    // Ask Paystack whether the charge actually succeeded.
    let tx;
    try { tx = await verifyTransaction(reference); }
    catch (e) { return res200(res, { fulfilled: false, pending: true, message: `Could not verify yet: ${e.message}` }); }

    if (tx.status !== "success")
      return res200(res, { fulfilled: false, status: tx.status });

    // Flip pending→success — only the winner (webhook or this call) proceeds.
    const { data: won } = await store.markPaymentPaid(payment.id, tx, new Date().toISOString());
    if (!won) return res200(res, { fulfilled: true, already: true });   // webhook got here first

    const meta = payment.provider_response || {};
    await handlers.enrollFromCartWebhook({
      paymentId:      payment.id,
      userId,
      cartCourseIds:  meta.course_ids  || tx.metadata?.cart_course_ids  || [],
      cartListingIds: meta.listing_ids || tx.metadata?.cart_listing_ids || [],
      couponId:       tx.metadata?.coupon_id ?? null,
    });
    return res200(res, { fulfilled: true, verified: true });
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
    const channels = checkoutChannels(method);
    const userId          = req.user.id;

    const cart = await getCartWithPrices(userId);
    if (!cart.items.length) return res400(res, "Cart is empty");

    // Filter out already-owned items (edge case — enrolled/purchased elsewhere).
    const courseIds = cart.items.filter((i) => i.item_type === "course").map((i) => i.course_id);
    const enrolledIds = courseIds.length
      ? ((await store.listActiveEnrollmentCourseIds(userId, courseIds)).data ?? []).map((e) => e.course_id)
      : [];

    const checkoutItems = cart.items.filter((i) =>
      i.item_type === "agent" ? true : !enrolledIds.includes(i.course_id));

    if (!checkoutItems.length)
      return res400(res, "You already own everything in your cart");

    if (enrolledIds.length) {
      await store.deleteCartCourses(userId, enrolledIds);
    }

    let totalKobo    = checkoutItems.reduce((s, i) => s + i.price_kobo, 0);
    let discountKobo = 0;
    let couponRecord = null;

    // Apply coupon if provided
    if (coupon_code) {
      const { data: coupon } = await store.findActiveCoupon(coupon_code.toUpperCase().trim());

      if (coupon) {
        const nowDate = new Date();
        const valid   = couponIsValid(coupon, nowDate);
        if (valid) {
          couponRecord = coupon;
          discountKobo = couponDiscountKobo(coupon, totalKobo);
          totalKobo -= discountKobo;
        }
      }
    }

    // Grant every item in the cart directly (no Paystack). Shared by the
    // free-cart path and the voucher/coin-settled path — both have already
    // "paid" by the time they get here, they just differ in how.
    const grantEverything = async ({ provider, amountKobo, extraMeta = {} }) => {
      const gCourseIds  = checkoutItems.filter((i) => i.item_type === "course").map((i) => i.course_id);
      const gListingIds = checkoutItems.filter((i) => i.item_type === "agent").map((i) => i.listing_id);
      // Record the payment so the order still appears in the learner's history.
      const { data: payment } = await store.insertDirectPayment({
        user_id: userId, course_id: gCourseIds[0] ?? null, amount_paid: amountKobo, currency: "NGN",
        payment_provider: provider, status: "success", paid_at: new Date().toISOString(),
        provider_response: { is_cart_checkout: true, course_ids: gCourseIds, listing_ids: gListingIds, item_count: checkoutItems.length, ...extraMeta },
      });
      if (payment?.id) await recordPaymentItems(payment.id, toPaymentItems(checkoutItems));
      for (const item of checkoutItems) {
        if (item.item_type === "agent") {
          await store.grantAgentFromCart(userId, { listingId: item.listing_id, agentId: item.agent_id, amountKobo: 0, currency: item.currency });
        } else {
          await store.upsertEnrollment({ userId, courseId: item.course_id });
          try { await store.incrementCourseStudents(item.course_id); } catch {}
        }
      }
      await store.clearCart(userId);
      notify.purchaseSuccess({ userId, itemTitle: `${checkoutItems.length} item${checkoutItems.length === 1 ? "" : "s"}`, amountNgn: amountKobo / 100 });
    };

    // Free cart — grant everything directly without Paystack
    if (totalKobo === 0) {
      await grantEverything({ provider: "free", amountKobo: 0, extraMeta: { free: true } });
      return res200(res, { free: true, enrolled_count: checkoutItems.length, message: "Access granted to all free items" });
    }

    // ── Pay with a voucher code ────────────────────────────────────────────
    // Redeem the code into coins, then settle this order from the coin
    // balance. Redemption is committed BEFORE we check whether it covers the
    // order — a voucher is single-use, so on a shortfall the learner keeps the
    // credited coins rather than losing them; we just tell them what's left to
    // cover and leave the cart intact.
    if (method === "voucher") {
      const code = String(req.body?.voucher_code || "").trim().toUpperCase();
      if (!code) return res400(res, "Enter a voucher code");
      if (!voucherRedeemConfigured()) return res400(res, "Voucher payment isn't configured on this server");

      let credited = 0;
      try {
        const { credits, transactionId } = await redeemVoucher({ code, customerId: userId });
        credited = credits;
        await creditTopup({ ownerType: "user", ownerId: userId, coins: credits, ref: `voucher_${transactionId}`, by: userId });
      } catch (e) {
        if (e instanceof VoucherError) return res.status(e.status === 429 ? 429 : 400).json({ success: false, message: e.message, reason: e.reason });
        throw e;
      }

      const coinsNeeded = nairaToCoins(totalKobo / 100);
      const { total: coinBalance } = await hasCoins(userId, 1);
      if (coinBalance < coinsNeeded) {
        return res.status(402).json({
          success: false, code: "INSUFFICIENT_COINS",
          message: `Voucher redeemed (+${credited} coins), but this order needs ${coinsNeeded} coins and you have ${coinBalance}. Add another voucher or top up the difference.`,
          credited, balance: coinBalance, needed: coinsNeeded,
        });
      }

      const spendRef = `cart_${userId}_${Date.now()}`;
      const spend = await debitCoins({ userId, coins: coinsNeeded, feature: "cart_checkout", ref: spendRef });
      try {
        await grantEverything({ provider: "voucher", amountKobo: totalKobo, extraMeta: { method: "voucher", coins_spent: coinsNeeded } });
      } catch (grantErr) {
        // The coins are already gone. If granting access fails we must put
        // them back, or the learner has paid and received nothing.
        // Refund to the SAME accounts the debit came from — a cart charge can
        // span the learner's wallet and their school's.
        const failedRefunds = await refundCoins({ applied: spend.applied, feature: "cart_checkout", ref: spendRef });
        if (failedRefunds === 0) {
          console.error("[cart/voucher] grant failed, coins refunded:", grantErr.message);
          return res.status(500).json({ success: false, message: "Could not complete your order — your coins were refunded. Please try again." });
        }
        console.error(`[cart/voucher] ‼️ GRANT FAILED and ${failedRefunds} refund(s) FAILED user=${userId} coins=${coinsNeeded} ref=${spendRef} — manual correction required`);
        return res.status(500).json({ success: false, message: "Something went wrong completing your order. Our team has been notified — please contact support." });
      }
      return res200(res, {
        free: true,   // reuse the frontend's "granted, no redirect" branch
        paid_with: "voucher", enrolled_count: checkoutItems.length,
        message: `Paid with voucher — access granted to ${checkoutItems.length} item${checkoutItems.length === 1 ? "" : "s"}`,
      });
    }

    const { data: user } = await store.findUser(userId);

    const courseCartIds  = checkoutItems.filter((i) => i.item_type === "course").map((i) => i.course_id);
    const listingCartIds = checkoutItems.filter((i) => i.item_type === "agent").map((i) => i.listing_id);

    // Create a single payment record for the cart. course_id is a representative
    // FK (first course, or null for an agent-only cart); the full item list lives
    // in the metadata below.
    const { data: payment, error: payErr } = await store.insertPendingPayment({
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
        method:           method || "any",   // for the "Processing" (async) label
      },
    });

    if (payErr) throw new Error(payErr.message);

    // Snapshot line items now (at init) so the order's contents are on record
    // even if the payment never completes.
    await recordPaymentItems(payment.id, toPaymentItems(checkoutItems));

    // Paystack transaction
    const { data: psData } = await paystackPost(
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
        callback_url: `${urlFor("FRONTEND_URL")}/checkout?payment=success&items=${checkoutItems.length}&amount=${totalKobo}`,
      },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    await store.setPaymentReference(payment.id, psData.data.reference);

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

    const { data: payment } = await store.findPaymentTotals(paymentId);

    const totalItems  = cartCourseIds.length + cartListingIds.length;
    const perItemKobo = totalItems ? Math.round((payment?.amount_paid ?? 0) / totalItems) : 0;
    const perCourseKobo = perItemKobo;

    // ── Agent (teaching-guide) items ─────────────────────────────────────────
    if (cartListingIds.length) {
      const { data: listings } = await store.listAgentListingsForFulfilment(cartListingIds);
      for (const listing of (listings ?? [])) {
        await store.grantAgentFromCart(userId, {
          listingId:  listing.id,
          agentId:    listing.agent_id,
          amountKobo: listing.price_kobo ?? perItemKobo,
          currency:   listing.currency ?? "NGN",
          paymentRef: payment?.provider_reference,
        });
        notify.agentUnlocked({ userId, agentName: listing.title || "Teaching guide" });
      }
      await store.deleteCartListings(userId, cartListingIds);
    }

    for (const courseId of cartCourseIds) {
      // Activate enrollment
      await store.upsertEnrollmentWithPayment({ userId, courseId, paymentId });
      try { await store.incrementCourseStudents(courseId); } catch {}

      // Create earnings record per instructor (correct commission per course)
      const { data: course } = await store.findCourseForEarnings(courseId);

      if (course?.instructor_id) {
        const split = calcCommission(perCourseKobo);

        try {
          await store.upsertInstructorEarning({
            instructor_id:      course.instructor_id,
            course_id:          courseId,
            payment_id:         paymentId,
            student_id:         userId,
            gross_amount:       perCourseKobo,
            commission_percent: split.commissionPercent,
            commission_amount:  split.commissionAmount,
            net_amount:         split.netAmount,
            currency:           course.currency ?? "NGN",
            status:             "pending",
          });
        } catch {}
        notify.newSale({ instructorId: course.instructor_id, courseTitle: course.title, netNgn: split.netAmount / 100 });
      }
    }

    // Record coupon use
    if (couponId) {
      try { await store.insertCouponUse({ couponId, userId, paymentId }); } catch {}
      try { await store.incrementCouponUses(couponId); } catch {}
    }

    // Clear the cart
    await store.deleteCartCourses(userId, cartCourseIds);

    // Notify the buyer their order is complete.
    notify.purchaseSuccess({ userId, itemTitle: `${totalItems} item${totalItems === 1 ? "" : "s"}`, amountNgn: (payment?.amount_paid ?? 0) / 100 });

    console.log(`[cart] ✅ Cart checkout enrolled user=${userId} in ${cartCourseIds.length} courses`);
  },
};
