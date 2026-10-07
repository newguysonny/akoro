/**
 * lib/couponModel.js contract tests (plan §4.6 Phase 3): coupon status
 * precedence, display text, discount math, subscription eligibility (exact
 * prototype copy), and create validation.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  couponStatus, couponText, couponEligibility,
  discountAmount, discountedPrice, validateCouponInput, COUPON_STATUS,
} from "./couponModel.js";

const T = "2026-09-29";
const coupon = (over) => ({
  code: "WELCOME20", type: "percent", value: 20, duration: "repeating",
  months: 3, max_redemptions: 100, expires_at: "2027-01-31",
  first_time_only: true, paused: false, ...over,
});

/* ── status precedence ─────────────────────────────────────────────────────── */

test("couponStatus: paused > expired > exhausted > active", () => {
  assert.equal(couponStatus(coupon(), 0, T), "active");
  assert.equal(couponStatus(coupon({ paused: true }), 0, T), "paused");
  assert.equal(couponStatus(coupon({ expires_at: "2026-09-15" }), 0, T), "expired");
  assert.equal(couponStatus(coupon({ max_redemptions: 2 }), 2, T), "exhausted");
  assert.equal(couponStatus(coupon({ max_redemptions: null }), 9999, T), "active");
  assert.equal(couponStatus(coupon({ expires_at: T }), 0, T), "active", "expiring today is still active");
  assert.equal(couponStatus(null), "expired");
  assert.equal(COUPON_STATUS.exhausted.label, "Fully redeemed");
});

/* ── display text + discount math ──────────────────────────────────────────── */

test("couponText: amount × duration phrasing (exact prototype copy)", () => {
  assert.equal(couponText(coupon()), "20% off, for 3 months");
  assert.equal(couponText(coupon({ type: "fixed", value: 500, duration: "once", months: null })), "₦500 off, first payment");
  assert.equal(couponText(coupon({ type: "percent", value: 10, duration: "forever", months: null })), "10% off, forever");
  assert.equal(couponText(null), "");
});

test("discount math: percent floors, fixed caps at the price, free plans get nothing", () => {
  assert.equal(discountAmount(coupon({ value: 20 }), 1500), 300);
  assert.equal(discountedPrice(coupon({ value: 20 }), 1500), 1200);
  assert.equal(discountAmount(coupon({ type: "fixed", value: 2000 }), 1500), 1500, "fixed discount never exceeds the price");
  assert.equal(discountedPrice(coupon({ type: "fixed", value: 2000 }), 1500), 0);
  assert.equal(discountAmount(coupon({ value: 33 }), 1000), 330);
  assert.equal(discountAmount(coupon(), 0), 0);
});

/* ── eligibility (exact prototype reasons) ─────────────────────────────────── */

test("couponEligibility: every rejection reason matches the prototype copy", () => {
  const sub = { price: 1500, status: "active", discount: null, customer_id: "c1" };
  assert.equal(couponEligibility(coupon(), 0, sub, false, T), null);

  assert.equal(couponEligibility(coupon({ paused: true }), 0, sub, false, T), "WELCOME20 is paused");
  assert.equal(couponEligibility(coupon({ expires_at: "2026-01-01" }), 0, sub, false, T), "WELCOME20 is expired");
  assert.equal(couponEligibility(coupon({ max_redemptions: 5 }), 5, sub, false, T), "WELCOME20 is fully redeemed");
  assert.equal(couponEligibility(coupon(), 0, { ...sub, price: 0 }, false, T), "Coupons apply to paid plans only");
  assert.equal(couponEligibility(coupon(), 0, { ...sub, status: "canceled" }, false, T), "Subscription is canceled");
  assert.equal(couponEligibility(coupon(), 0, { ...sub, discount: { id: "x" } }, false, T), "This subscription already has a coupon");
  assert.equal(couponEligibility(coupon(), 0, sub, true, T), "Only for customers with no paid invoices");
  assert.equal(couponEligibility(coupon({ first_time_only: false }), 0, sub, true, T), null);
});

/* ── create validation ─────────────────────────────────────────────────────── */

test("validateCouponInput: normalizes code, defaults optionals, validates fields", () => {
  const { errors, values } = validateCouponInput({
    code: " term2 ", type: "percent", value: 15, duration: "repeating", months: 2,
    description: "Term 2 offer", expires_at: "2026-12-31", first_time_only: true,
  });
  assert.deepEqual(errors, {});
  assert.equal(values.code, "TERM2");
  assert.equal(values.max_redemptions, null);
  assert.equal(values.months, 2);
  assert.equal(values.first_time_only, true);
  assert.equal(values.paused, false);

  const unlimited = validateCouponInput({ code: "LOYAL", type: "fixed", value: 300, duration: "forever" });
  assert.deepEqual(unlimited.errors, {});
  assert.equal(unlimited.values.months, null);
  assert.equal(unlimited.values.expires_at, null);
});

test("validateCouponInput: rejects bad codes, values, durations, dates, caps", () => {
  const bad = validateCouponInput({ code: "x!", type: "percent", value: 150, duration: "repeating", months: 0, max_redemptions: 0, expires_at: "31-12-2026" });
  for (const f of ["code", "value", "months", "max_redemptions", "expires_at"]) assert.ok(bad.errors[f], `expected error for ${f}`);
  assert.ok(validateCouponInput({ code: "OK", type: "weird", value: 5, duration: "once" }).errors.type);
  assert.ok(validateCouponInput({ code: "OK", type: "fixed", value: 0, duration: "once" }).errors.value);
  assert.ok(validateCouponInput({ code: "OK", type: "percent", value: 5, duration: "repeating" }).errors.months);
  assert.ok(!validateCouponInput({ code: "OK", type: "percent", value: 5, duration: "once" }).errors.months);
});
