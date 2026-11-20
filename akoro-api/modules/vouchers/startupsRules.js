/**
 * startupsRules.js — the pure rules for the Akoro-authenticated startup
 * routes: the categories and billing periods a business may pick, the slug
 * its URL uses, and a voucher product's shape.
 */

export const CATEGORIES = ["education", "fintech", "gaming", "productivity", "health", "ecommerce", "other"];
export const BILLING_PERIODS = ["one_time", "monthly", "quarterly", "yearly"];

export const slugify = (s) => String(s || "").toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `startup-${Date.now()}`;

/** A voucher product's body → the validated row fields, or the first error. */
export function validProductBody(body) {
  const name = String(body?.name || "").trim();
  const credits = Math.floor(Number(body?.credits));
  const priceUsd = Number(body?.price_usd);
  const minOrderQty = body?.min_order_qty != null ? Math.floor(Number(body.min_order_qty)) : 1;
  const billingPeriod = body?.billing_period || "one_time";
  if (!name) return "name is required";
  if (!credits || credits < 1) return "credits must be a positive integer";
  if (!priceUsd || priceUsd <= 0) return "price_usd must be a positive number";
  if (!minOrderQty || minOrderQty < 1) return "min_order_qty must be a positive integer";
  if (!BILLING_PERIODS.includes(billingPeriod)) return "Invalid billing_period";
  return {
    name, credits, price_usd: priceUsd, min_order_qty: minOrderQty, billing_period: billingPeriod,
    description: body?.description?.trim() || null, image_url: body?.image_url?.trim() || null,
  };
}
