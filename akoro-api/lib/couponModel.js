/**
 * lib/couponModel.js — pure coupon logic for Phase 3 (plan §4.6):
 * status, display text, subscription eligibility, discount math, and
 * create-validation. Mirrors the prototype's couponStatus / couponText /
 * couponEligibility exactly. No db/express imports (contract-tested).
 */

export const todayStr = () => new Date().toISOString().slice(0, 10);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const COUPON_STATUS = {
  active:    { label: "Active",         badge: "s-active" },
  paused:    { label: "Paused",         badge: "s-paused" },
  expired:   { label: "Expired",        badge: "s-canceled" },
  exhausted: { label: "Fully redeemed", badge: "s-trial" },
};

/** active | paused | expired | exhausted — paused wins, like the prototype. */
export function couponStatus(coupon, redeemedCount = 0, today = todayStr()) {
  if (!coupon) return "expired";
  if (coupon.paused) return "paused";
  if (coupon.expires_at && coupon.expires_at < today) return "expired";
  if (coupon.max_redemptions !== null && coupon.max_redemptions !== undefined && redeemedCount >= coupon.max_redemptions) return "exhausted";
  return "active";
}

/** "20% off, for 3 months" · "₦500 off, first payment" · "10% off, forever" */
export function couponText(coupon) {
  if (!coupon) return "";
  const amt = coupon.type === "percent"
    ? `${coupon.value}% off`
    : `₦${Number(coupon.value).toLocaleString()} off`;
  const dur = coupon.duration === "once" ? "first payment"
    : coupon.duration === "forever" ? "forever"
    : `for ${coupon.months} months`;
  return `${amt}, ${dur}`;
}

/** Naira off the given per-cycle price. */
export function discountAmount(coupon, price) {
  if (!coupon || !(price > 0)) return 0;
  const off = coupon.type === "percent"
    ? Math.floor((price * coupon.value) / 100)
    : coupon.value;
  return Math.min(off, price);
}

export const discountedPrice = (coupon, price) => Math.max(0, (price ?? 0) - discountAmount(coupon, price));

/**
 * Can this coupon be applied to this subscription? Returns null when yes, or
 * the reason string (exact prototype copy) when no.
 *  sub: { price, status, discount, customer_id }
 *  customerHasPaidInvoice: boolean (first_time_only rule)
 */
export function couponEligibility(coupon, redeemedCount, sub, customerHasPaidInvoice, today = todayStr()) {
  const st = couponStatus(coupon, redeemedCount, today);
  if (st !== "active") return `${coupon.code} is ${COUPON_STATUS[st].label.toLowerCase()}`;
  if ((sub.price ?? 0) === 0) return "Coupons apply to paid plans only";
  if (sub.status === "canceled") return "Subscription is canceled";
  if (sub.discount) return "This subscription already has a coupon";
  if (coupon.first_time_only && customerHasPaidInvoice) return "Only for customers with no paid invoices";
  return null;
}

/** Validate a create payload. Returns { errors, values } (code is uppercased). */
export function validateCouponInput(body = {}) {
  const errors = {};
  const values = {};

  const code = String(body.code ?? "").trim().toUpperCase();
  if (!code) errors.code = "Give the coupon a code";
  else if (!/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(code)) errors.code = "Codes are 3-40 letters, numbers, or dashes";
  else values.code = code;

  const description = String(body.description ?? "").trim();
  if (description.length > 200) errors.description = "Description is too long (200 max)";
  else values.description = description || null;

  if (!["percent", "fixed"].includes(body.type)) errors.type = "Type must be percentage or fixed";
  else {
    values.type = body.type;
    const v = Number(body.value);
    if (!Number.isInteger(v) || v < 1) errors.value = "Value must be a whole number of 1 or more";
    else if (body.type === "percent" && v > 100) errors.value = "A percentage cannot exceed 100";
    else values.value = v;
  }

  if (!["once", "repeating", "forever"].includes(body.duration)) errors.duration = "Duration must be once, repeating, or forever";
  else {
    values.duration = body.duration;
    if (body.duration === "repeating") {
      const m = Number(body.months);
      if (!Number.isInteger(m) || m < 1) errors.months = "Repeating coupons need a month count of 1 or more";
      else values.months = m;
    } else {
      values.months = null;
    }
  }

  if (body.max_redemptions === undefined || body.max_redemptions === null || body.max_redemptions === "") {
    values.max_redemptions = null;
  } else {
    const m = Number(body.max_redemptions);
    if (!Number.isInteger(m) || m < 1) errors.max_redemptions = "Max redemptions must be 1 or more";
    else values.max_redemptions = m;
  }

  if (body.expires_at === undefined || body.expires_at === null || body.expires_at === "") {
    values.expires_at = null;
  } else if (!DATE_RE.test(body.expires_at) || Number.isNaN(new Date(`${body.expires_at}T00:00:00Z`).getTime())) {
    errors.expires_at = "Expires must be a date (or blank for never)";
  } else {
    values.expires_at = body.expires_at;
  }

  values.first_time_only = body.first_time_only === true;
  values.paused = false;

  return { errors, values };
}
