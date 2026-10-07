/**
 * lib/paystack.js — self-contained Paystack client for this module.
 *
 * Deliberately does NOT import Akoro's other paystackService.js — this module
 * must carry its own payment plumbing so it can ship standalone. Only shared
 * resource: PAYSTACK_SECRET_KEY (same account as the rest of the platform;
 * swap the env var if this module ever settles through a different account).
 */
const BASE = "https://api.paystack.co";
const SECRET = process.env.PAYSTACK_SECRET_KEY;

async function call(method, path, body) {
  if (!SECRET) throw new Error("PAYSTACK_SECRET_KEY not configured");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) throw new Error(data.message || `Paystack ${path} failed (${res.status})`);
  return data;
}

/** Start a charge (wallet top-up). Returns { authorization_url, reference }. */
export async function initializeTransaction({ email, amount_kobo, reference, metadata, callback_url }) {
  const r = await call("POST", "/transaction/initialize", {
    email, amount: amount_kobo, reference, metadata, callback_url,
    currency: "NGN", channels: ["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer"],
  });
  return { authorization_url: r.data.authorization_url, access_code: r.data.access_code, reference: r.data.reference };
}

/** Verify a transaction reference (safety-net reconciliation). */
export async function verifyTransaction(reference) {
  const r = await call("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
  return r.data;   // { status: 'success'|..., amount, ... }
}

/** Create (or reuse) a transfer recipient for a bank payout. */
export async function createTransferRecipient({ name, accountNumber, bankCode }) {
  const r = await call("POST", "/transferrecipient", {
    type: "nuban", name, account_number: accountNumber, bank_code: bankCode, currency: "NGN",
  });
  return { recipientCode: r.data.recipient_code, accountName: r.data.details?.account_name || name };
}

/** Initiate a payout transfer. Returns Paystack's transfer status (async settlement). */
export async function initiateTransfer({ amount_kobo, recipientCode, reason, reference }) {
  const r = await call("POST", "/transfer", {
    source: "balance", amount: amount_kobo, recipient: recipientCode, reason, reference,
  });
  return { transferCode: r.data.transfer_code, status: r.data.status };   // status: 'pending'|'success'|'otp'|...
}
