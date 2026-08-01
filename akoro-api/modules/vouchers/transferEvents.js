/**
 * transferEvents.js — reconcile Paystack transfer webhooks against
 * vouchers.withdrawals.
 *
 * Without this, a payout that Paystack accepts as `processing` and later
 * FAILS or REVERSES leaves the startup permanently debited: the money never
 * arrives, and nothing ever refunds the wallet. The unified webhook
 * dispatcher previously routed transfer.* only to the instructor-payout
 * handler, which matches on its own table and never touched ours.
 *
 * Idempotent: every update is conditional on the row not already being in the
 * target state, so a replayed webhook can't double-refund.
 */
import { vdb } from "./db.js";
import { refundWithdrawal } from "./lib/startupWallet.js";

/**
 * Returns true if this event matched a voucher withdrawal (so the caller can
 * tell "handled" from "belongs to another domain").
 */
export async function fulfillVoucherTransferEvent(event, data) {
  const transferCode = data?.transfer_code;
  if (!transferCode) return false;

  const { data: wd } = await vdb().from("withdrawals")
    .select("id, startup_id, amount_usd, status")
    .eq("paystack_transfer_code", transferCode).maybeSingle();
  if (!wd) return false;   // not ours — instructor payout or unrelated

  if (event === "transfer.success") {
    if (wd.status === "paid") return true;                    // replay
    await vdb().from("withdrawals")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", wd.id).neq("status", "paid");
    console.log(`[vouchers/payouts] ✅ withdrawal ${wd.id} paid (${transferCode})`);
    return true;
  }

  if (event === "transfer.failed" || event === "transfer.reversed") {
    // Only refund if we haven't already — the conditional UPDATE is the guard,
    // so two concurrent/replayed webhooks can't both credit the wallet back.
    const { data: claimed } = await vdb().from("withdrawals")
      .update({ status: "failed", failure_reason: `Paystack ${event}: ${data?.reason || "no reason given"}` })
      .eq("id", wd.id).in("status", ["pending", "processing"])
      .select("id").maybeSingle();
    if (!claimed) return true;                                 // already settled/refunded

    try {
      await refundWithdrawal(wd.startup_id, Number(wd.amount_usd), wd.id);
      console.log(`[vouchers/payouts] ↩️  withdrawal ${wd.id} ${event} — refunded $${wd.amount_usd}`);
    } catch (e) {
      // Loud, not silent: the startup is currently short this amount and a
      // human needs to make it whole.
      console.error(`[vouchers/payouts] ‼️ REFUND FAILED for withdrawal ${wd.id} ($${wd.amount_usd}) — manual correction required:`, e.message);
      await vdb().from("withdrawals")
        .update({ failure_reason: `${event}; REFUND FAILED (${e.message}) — needs manual correction` })
        .eq("id", wd.id);
    }
    return true;
  }

  return false;
}
