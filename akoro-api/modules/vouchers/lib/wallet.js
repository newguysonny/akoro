/**
 * lib/wallet.js — the agent's prepaid USD wallet.
 * A SEPARATE ledger from Akoro's own coin wallet (lib/coins.js) — do not
 * import that file here. Same atomic-conditional-UPDATE pattern, different
 * money, different table, so this module carries its own economics wherever
 * it goes.
 */
import { vdb } from "../db.js";

export class InsufficientFunds extends Error {
  constructor(needed, balance) {
    super("Insufficient wallet balance");
    this.name = "InsufficientFunds";
    this.needed = needed; this.balance = balance; this.code = "INSUFFICIENT_FUNDS";
  }
}

export async function ensureWallet(userId) {
  const { data: existing } = await vdb().from("agent_wallets")
    .select("id, balance_usd").eq("user_id", userId).maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await vdb().from("agent_wallets")
    .insert({ user_id: userId, balance_usd: 0 }).select("id, balance_usd").single();
  if (error) {
    // Lost a create race — read it back.
    const { data: again } = await vdb().from("agent_wallets")
      .select("id, balance_usd").eq("user_id", userId).maybeSingle();
    if (again) return again;
    throw new Error(error.message);
  }
  return created;
}

export async function getBalance(userId) {
  const w = await ensureWallet(userId);
  return Number(w.balance_usd);
}

/** Debit for a purchase. Throws InsufficientFunds if the balance can't cover it. */
export async function debit(userId, amountUsd, { type = "purchase", ref = null, meta = {} } = {}) {
  const wallet = await ensureWallet(userId);
  const { data: newBal, error } = await vdb().rpc("wallet_debit", {
    p_wallet: wallet.id, p_amount: amountUsd, p_type: type, p_ref: ref, p_meta: meta,
  });
  if (error) throw new Error(error.message);
  if (newBal == null) throw new InsufficientFunds(amountUsd, Number(wallet.balance_usd));
  return Number(newBal);
}

/** Credit (top-up / refund). `ref` makes a top-up idempotent across retries. */
export async function credit(userId, amountUsd, { type = "topup", ref = null, meta = {} } = {}) {
  const wallet = await ensureWallet(userId);
  const { data: newBal, error } = await vdb().rpc("wallet_credit", {
    p_wallet: wallet.id, p_amount: amountUsd, p_type: type, p_ref: ref, p_meta: meta,
  });
  if (error) throw new Error(error.message);
  return { credited: newBal != null, balance: newBal, alreadyApplied: newBal == null };
}

export async function transactions(userId, { limit = 50, offset = 0 } = {}) {
  const wallet = await ensureWallet(userId);
  const { data } = await vdb().from("agent_wallet_transactions").select("*")
    .eq("wallet_id", wallet.id).order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  return data || [];
}
