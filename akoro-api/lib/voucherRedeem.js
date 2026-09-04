/**
 * lib/voucherRedeem.js
 * ─────────────────────────────────────────────────────────────
 * Redeems an Akoro voucher code on behalf of a learner.
 *
 * Akoro is itself a "startup" on the voucher platform, so this talks to the
 * voucher module the same way any third-party integrator would: a
 * server-to-server POST /api/vouchers/v1/validate authenticated with a secret
 * API key. That keeps the boundary honest — if the voucher module is ever
 * split into its own service, only VOUCHER_API_URL changes here.
 *
 * SECURITY: VOUCHER_API_KEY is a secret (sk_live_…). It lives ONLY in the
 * backend environment and must never reach a frontend bundle — anyone holding
 * it could redeem/burn any of this startup's outstanding vouchers.
 */

const API_KEY  = process.env.VOUCHER_API_KEY || "";
// Defaults to this same API (Akoro's voucher module is mounted here); point it
// elsewhere once the module ships standalone.
const BASE_URL = process.env.VOUCHER_API_URL
  || process.env.SELF_URL
  || `http://127.0.0.1:${process.env.PORT || 8080}`;

export class VoucherError extends Error {
  constructor(reason, status) {
    super(MESSAGES[reason] || "This voucher code could not be redeemed");
    this.name = "VoucherError";
    this.reason = reason;
    this.status = status;
  }
}

const MESSAGES = {
  not_found:      "We don't recognise that voucher code — check it and try again.",
  already_used:   "That voucher code has already been redeemed.",
  expired:        "That voucher code has expired.",
  refunded:       "That voucher code is no longer valid.",
  not_available:  "That voucher code isn't available for redemption.",
  rate_limited:   "Too many attempts — please wait a moment and try again.",
  missing_api_key:"Voucher redemption isn't configured on this server.",
  invalid_api_key:"Voucher redemption isn't configured correctly on this server.",
  startup_inactive:"Voucher redemption is temporarily unavailable.",
  server_error:   "Something went wrong redeeming that code — please try again.",
};

export const voucherRedeemConfigured = () => !!API_KEY;

/**
 * Redeem a code. Resolves with { credits, transactionId } on success,
 * throws VoucherError (with a user-safe .message and a .reason) otherwise.
 *
 * idempotencyKey lets a retried request return the SAME result instead of
 * failing as already_used — pass a stable per-attempt id.
 */
export async function redeemVoucher({ code, customerId, idempotencyKey }) {
  if (!API_KEY) throw new VoucherError("missing_api_key", 503);

  let res, body;
  try {
    res = await fetch(`${BASE_URL}/api/vouchers/v1/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        voucher_code: code,
        ...(customerId ? { customer_id: String(customerId) } : {}),
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      }),
    });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    console.error("[voucherRedeem] transport error:", e.message);
    throw new VoucherError("server_error", 502);
  }

  if (!res.ok || !body?.valid) {
    throw new VoucherError(body?.reason || "server_error", res.status || 500);
  }
  return { credits: Number(body.credits) || 0, transactionId: body.transaction_id, replay: !!body.replay };
}
