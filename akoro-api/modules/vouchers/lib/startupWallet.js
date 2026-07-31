/**
 * lib/startupWallet.js — a startup's settlement balance: what the platform
 * owes them for REDEEMED credits, minus the platform fee. Separate ledger
 * from the agent's prepaid wallet (lib/wallet.js).
 */
import { vdb } from "../db.js";

export const PLATFORM_FEE_PCT = Math.max(0, Math.min(50, Number(process.env.VOUCHER_PLATFORM_FEE_PCT ?? 10)));

export class InsufficientBalance extends Error {
  constructor(needed, balance) {
    super("Insufficient withdrawable balance");
    this.name = "InsufficientBalance";
    this.needed = needed; this.balance = balance; this.code = "INSUFFICIENT_BALANCE";
  }
}

export async function ensureStartupWallet(startupId) {
  const { data: existing } = await vdb().from("startup_wallets").select("id, balance_usd").eq("startup_id", startupId).maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await vdb().from("startup_wallets")
    .insert({ startup_id: startupId, balance_usd: 0 }).select("id, balance_usd").single();
  if (error) {
    const { data: again } = await vdb().from("startup_wallets").select("id, balance_usd").eq("startup_id", startupId).maybeSingle();
    if (again) return again;
    throw new Error(error.message);
  }
  return created;
}

export async function getStartupBalance(startupId) {
  const w = await ensureStartupWallet(startupId);
  return Number(w.balance_usd);
}

/** Credit the startup for one redeemed code. Idempotent per code (ref = code id). */
export async function creditRedemption(startupId, amountUsd, codeId) {
  if (!(amountUsd > 0)) return null;
  const wallet = await ensureStartupWallet(startupId);
  const { data: newBal, error } = await vdb().rpc("startup_wallet_credit", {
    p_wallet: wallet.id, p_amount: amountUsd, p_type: "redemption_credit", p_ref: codeId, p_meta: {},
  });
  if (error) throw new Error(error.message);
  return newBal;   // null = already credited for this code (safe no-op)
}

/** Debit for a withdrawal. Throws InsufficientBalance if it can't cover it. */
export async function debitWithdrawal(startupId, amountUsd, withdrawalId) {
  const wallet = await ensureStartupWallet(startupId);
  const { data: newBal, error } = await vdb().rpc("startup_wallet_debit", {
    p_wallet: wallet.id, p_amount: amountUsd, p_type: "withdrawal", p_ref: withdrawalId, p_meta: {},
  });
  if (error) throw new Error(error.message);
  if (newBal == null) throw new InsufficientBalance(amountUsd, Number(wallet.balance_usd));
  return newBal;
}

/** Refund a failed withdrawal back onto the balance. */
export async function refundWithdrawal(startupId, amountUsd, withdrawalId) {
  const wallet = await ensureStartupWallet(startupId);
  await vdb().rpc("startup_wallet_credit", {
    p_wallet: wallet.id, p_amount: amountUsd, p_type: "refund", p_ref: `refund_${withdrawalId}`, p_meta: {},
  });
}

export async function startupTransactions(startupId, { limit = 50, offset = 0 } = {}) {
  const wallet = await ensureStartupWallet(startupId);
  const { data } = await vdb().from("startup_wallet_transactions").select("*")
    .eq("wallet_id", wallet.id).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  return data || [];
}
