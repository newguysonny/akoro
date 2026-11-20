/**
 * cart-rules.js — pure pricing, currency and totals for cart checkout.
 *
 * No database import and no Express objects. The service passes resolved rows
 * in and gets line items, discounts and commission splits back, so the money
 * math (kobo integers, percent rounding, discount windows) lives in one place.
 */

import { businessConfig } from "../../config/index.js";

// Build normalized payment_items rows from resolved cart line items.
export const toPaymentItems = (items) => items.map((i) => ({
  item_type:       i.item_type,
  course_id:       i.course_id,
  listing_id:      i.listing_id,
  title:           i.title,
  unit_price_kobo: i.price_kobo,
  currency:        i.currency ?? "NGN",
}));

// Platform commission on a gross kobo amount. Math.round, never floors.
export const calcCommission = (grossKobo) => {
  const pct    = businessConfig.commissionPercent;
  const fee    = Math.round(grossKobo * (pct / 100));
  return { commissionPercent: pct, commissionAmount: fee, netAmount: grossKobo - fee };
};

// Coupon discount in kobo: percent rounds to the nearest kobo, fixed is capped
// at the original total. Mirrors both the preview and the checkout path.
export const couponDiscountKobo = (coupon, originalKobo) =>
  coupon.discount_type === "percent"
    ? Math.round(originalKobo * (coupon.discount_value / 100))
    : Math.min(coupon.discount_value, originalKobo);

// A coupon is usable when it has not expired and its usage cap is not reached.
export const couponIsValid = (coupon, nowDate) =>
  (!coupon.valid_until || new Date(coupon.valid_until) > nowDate) &&
  (coupon.max_uses === null || coupon.used_count < coupon.max_uses);

// Paystack channels for the chosen method; null means every method.
const CHANNELS = { card: ["card"], bank: ["bank", "bank_transfer"], ussd: ["ussd"] };
export const checkoutChannels = (method) => CHANNELS[method] || null;

// One course cart row → { priceKobo, line }. Null when the course is missing
// or the row is not a course. `discount_active` keeps the original expression
// (it can be 0/null, not strictly a boolean).
export const courseLine = (item, nowDate) => {
  if (item.item_type === "agent") return null;
  const course = item.courses;
  if (!course) return null;

  const discActive = course.discount_price &&
    (!course.discount_expires_at || new Date(course.discount_expires_at) > nowDate);
  const priceKobo = course.is_free ? 0 : (discActive ? course.discount_price : course.price);

  return {
    priceKobo,
    line: {
      cart_item_id:       item.id,
      item_type:          "course",
      course_id:          course.id,
      title:              course.title,
      slug:               course.slug,
      cover_image_url:    course.cover_image_url,
      course_type:        course.course_type,
      instructor:         course.users,
      original_price_ngn: course.price / 100,
      discount_active:    discActive,
      price_ngn:          priceKobo / 100,
      price_kobo:         priceKobo,
      is_free:            course.is_free,
      currency:           course.currency ?? "NGN",
      added_at:           item.added_at,
    },
  };
};

// One agent cart row + its marketplace listing → { priceKobo, line }.
export const agentLine = (row, listing) => {
  if (!listing) return null;
  const priceKobo = listing.price_kobo || 0;

  return {
    priceKobo,
    line: {
      cart_item_id:    row.id,
      item_type:       "agent",
      listing_id:      listing.id,
      agent_id:        listing.agent_id,
      title:           listing.title,
      subject:         listing.subject,
      cover_image_url: listing.cover_image_url,
      teacher_avatar:  listing.teacher_avatar,
      instructor:      { full_name: listing.teacher_name },
      price_ngn:       priceKobo / 100,
      price_kobo:      priceKobo,
      is_free:         priceKobo === 0,
      currency:        listing.currency ?? "NGN",
      added_at:        row.added_at,
    },
  };
};

/**
 * buildCart
 * Resolves visible cart rows against their prices and returns line items plus
 * totals in kobo and naira. Pure: every lookup is passed in by the service.
 */
export const buildCart = ({ itemRows, listingsById = {}, nowDate = new Date() }) => {
  const courseLines = itemRows
    .map((item) => courseLine(item, nowDate))
    .filter(Boolean);

  const agentRows = itemRows.filter((i) => i.item_type === "agent" && i.listing_id);
  const agentLines = agentRows
    .map((r) => agentLine(r, listingsById[r.listing_id]))
    .filter(Boolean);

  const lineItems = [...courseLines, ...agentLines]
    .map((r) => r.line)
    .sort((a, b) => new Date(a.added_at) - new Date(b.added_at));

  const subtotalKobo = [...courseLines, ...agentLines]
    .reduce((sum, r) => sum + r.priceKobo, 0);

  return {
    items:          lineItems,
    item_count:     lineItems.length,
    subtotal_ngn:   subtotalKobo / 100,
    subtotal_kobo:  subtotalKobo,
    commission_pct: calcCommission(subtotalKobo).commissionPercent,
  };
};
