// =============================================================
// marketplace/paystackService.js
// Paystack API wrapper — all payment operations in one place.
// Handles: initialize, verify, webhook validation.
// =============================================================

import crypto from "crypto";

const PAYSTACK_BASE    = "https://api.paystack.co";
const SECRET_KEY       = process.env.PAYSTACK_SECRET_KEY;
const WEBHOOK_SECRET   = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;

if (!SECRET_KEY) {
  console.warn("[Paystack] PAYSTACK_SECRET_KEY not set — payments will fail.");
}

// ── Core fetch helper ─────────────────────────────────────────
async function paystackRequest(method, path, body = null) {
  const options = {
    method,
    headers: {
      Authorization:  `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/json",
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res  = await fetch(`${PAYSTACK_BASE}${path}`, options);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || `Paystack error: ${res.status}`);
  }
  return data;
}

// =============================================================
// INITIALIZE TRANSACTION
// Creates a payment session and returns authorization_url.
// =============================================================

/**
 * @param {object} params
 * @param {string} params.email           — student's email
 * @param {number} params.amount_kobo     — amount in kobo (₦100 = 10000 kobo)
 * @param {string} params.reference       — unique reference (our purchase ID)
 * @param {object} params.metadata        — extra data attached to transaction
 * @param {string} params.callback_url    — where to redirect after payment
 * @returns {{ authorization_url, access_code, reference }}
 */
export async function initializeTransaction({
  email,
  amount_kobo,
  reference,
  metadata = {},
  callback_url,
}) {
  const data = await paystackRequest("POST", "/transaction/initialize", {
    email,
    amount:       amount_kobo,
    reference,
    metadata,
    callback_url: callback_url || `${process.env.APP_URL}/marketplace/payment/callback`,
    currency:     "NGN",
    channels:     ["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer"],
  });

  return {
    authorization_url: data.data.authorization_url,
    access_code:       data.data.access_code,
    reference:         data.data.reference,
  };
}

// =============================================================
// VERIFY TRANSACTION
// Call this after payment to confirm it succeeded.
// =============================================================

/**
 * @param {string} reference — Paystack transaction reference
 * @returns {{ status, amount, email, metadata, paid_at }}
 */
export async function verifyTransaction(reference) {
  const data = await paystackRequest("GET", `/transaction/verify/${reference}`);
  const tx   = data.data;

  return {
    status:    tx.status,            // "success" | "failed" | "abandoned"
    amount:    tx.amount,            // in kobo
    currency:  tx.currency,
    email:     tx.customer?.email,
    reference: tx.reference,
    metadata:  tx.metadata || {},
    paid_at:   tx.paid_at,
    channel:   tx.channel,
    gateway_response: tx.gateway_response,
  };
}

// =============================================================
// WEBHOOK SIGNATURE VALIDATION
// Call this on every incoming webhook to confirm it's from Paystack.
// =============================================================

/**
 * @param {string} rawBody   — raw request body string (NOT parsed JSON)
 * @param {string} signature — value of x-paystack-signature header
 * @returns {boolean}
 */
export function validateWebhookSignature(rawBody, signature) {
  if (!signature) return false;
  const hash = crypto
    .createHmac("sha512", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return hash === signature;
}

// =============================================================
// GENERATE UNIQUE REFERENCE
// Format: AGNT-{timestamp}-{random}
// =============================================================

export function generateReference(prefix = "AGNT") {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

// =============================================================
// LIST TRANSACTIONS (optional — for admin dashboard)
// =============================================================

export async function listTransactions({ page = 1, perPage = 50, status } = {}) {
  const params = new URLSearchParams({ page, perPage });
  if (status) params.set("status", status);
  const data = await paystackRequest("GET", `/transaction?${params}`);
  return data.data || [];
}

// =============================================================
// REFUND (optional)
// =============================================================

export async function refundTransaction(reference, amount_kobo = null) {
  const body = { transaction: reference };
  if (amount_kobo) body.amount = amount_kobo;
  const data = await paystackRequest("POST", "/refund", body);
  return data.data;
}
