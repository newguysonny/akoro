/**
 * fulfillment.js — Paystack webhook fulfillment for wallet top-ups.
 * Wired into the unified webhook dispatcher (modules/webhooks/paystack.js)
 * exactly like fulfillCoinTopup — inspects the metadata discriminator and
 * no-ops if it isn't ours.
 */
import { credit } from "./lib/wallet.js";

export async function fulfillVoucherWalletTopup(data) {
  const md = data?.metadata || {};
  if (md.purpose !== "voucher_wallet_topup") return false;
  const ref = data?.reference;
  const amountUsd = Number(md.amount_usd || 0);
  if (!ref || !md.user_id || !(amountUsd > 0)) return false;
  const r = await credit(md.user_id, amountUsd, { type: "topup", ref, meta: { source: "paystack" } });
  return r.credited || r.alreadyApplied;   // handled either way (idempotent)
}
