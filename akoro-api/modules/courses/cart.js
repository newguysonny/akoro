/**
 * modules/courses/cart.js  —  Akoro Cart & Checkout (mounted router)
 *
 * Supports two purchase flows:
 *   A. Direct purchase  →  POST /api/payments/initiate  (existing)
 *   B. Cart checkout    →  POST /api/cart/checkout      (this file)
 *
 * Cart is stored in Supabase cart_items table (not Redis — persists across devices).
 * One Paystack transaction covers all cart items.
 * On webhook success: enrols student in every course + creates per-instructor
 * earnings records with correct commission split.
 *
 * The lifecycle is split into layers inside this module:
 *   routes  → cart.js (this file, mounted entry)
 *   service → cart-service.js (checkout orchestration, Paystack init/verify)
 *   rules   → cart-rules.js (pure pricing, currency, totals)
 *   store   → cart-store.js (Supabase queries, no Express)
 */

import { Router }                 from "express";
import { body, validationResult } from "express-validator";
import { authenticateToken }      from "../auth/index.js";
import { handlers }               from "./cart-service.js";

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
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
router.get   ("/cart/verify/:reference",    authenticateToken, handlers.verifyCheckout);
router.post  ("/cart/checkout",             authenticateToken, handlers.checkout);

export { handlers as cartHandlers };
export default router;
