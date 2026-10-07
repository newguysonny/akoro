/**
 * paymentAudit.js — durable forensics helpers for the payment pipeline.
 *
 * logPaymentEvent   — append a row to payment_events (webhook received, status
 *                     transition, verify/refund outcome). Never throws: auditing
 *                     must not break fulfillment, so failures are swallowed and
 *                     logged to console as a last resort.
 * recordPaymentItems — snapshot a payment's line items into payment_items so a
 *                     cart order's contents are queryable, not buried in JSON.
 */

import db from "../../db.js";

/**
 * @param {object} e
 * @param {string}  e.eventType        e.g. "charge.success", "status_change"
 * @param {string} [e.reference]       Paystack reference / transfer_code
 * @param {string} [e.paymentId]       resolved payment id, if known
 * @param {string} [e.source]          paystack_webhook | verify | refund | system
 * @param {boolean}[e.signatureValid]  webhook HMAC result (omit for non-webhook)
 * @param {boolean}[e.matched]         did it resolve to a known payment?
 * @param {string} [e.outcome]         fulfilled | already_processed | no_match | ignored | error
 * @param {object} [e.detail]          raw payload / transition context
 */
export async function logPaymentEvent(e = {}) {
  try {
    await db.from("payment_events").insert({
      payment_id:      e.paymentId ?? null,
      reference:       e.reference ?? null,
      event_type:      e.eventType ?? "unknown",
      source:          e.source ?? "paystack_webhook",
      signature_valid: typeof e.signatureValid === "boolean" ? e.signatureValid : null,
      matched:         typeof e.matched === "boolean" ? e.matched : null,
      outcome:         e.outcome ?? null,
      detail:          e.detail ?? null,
    });
  } catch (err) {
    // Best-effort: a broken audit insert must never fail a payment.
    console.error("[paymentAudit] logPaymentEvent failed:", err?.message || err);
  }
}

/**
 * Snapshot line items for a payment. Idempotent-ish: clears any prior rows for
 * the payment first so a re-run doesn't duplicate. Best-effort.
 * @param {string} paymentId
 * @param {Array<{item_type:'course'|'agent', course_id?:string, listing_id?:string, title?:string, unit_price_kobo?:number, currency?:string}>} items
 */
export async function recordPaymentItems(paymentId, items = []) {
  if (!paymentId || !items.length) return;
  try {
    await db.from("payment_items").delete().eq("payment_id", paymentId);
    await db.from("payment_items").insert(items.map((i) => ({
      payment_id:      paymentId,
      item_type:       i.item_type,
      course_id:       i.item_type === "course" ? (i.course_id ?? null) : null,
      listing_id:      i.item_type === "agent"  ? (i.listing_id ?? null) : null,
      title:           i.title ?? null,
      unit_price_kobo: i.unit_price_kobo ?? 0,
      currency:        i.currency ?? "NGN",
    })));
  } catch (err) {
    console.error("[paymentAudit] recordPaymentItems failed:", err?.message || err);
  }
}
