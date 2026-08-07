/**
 * lib/coins.js
 * ─────────────────────────────────────────────────────────────
 * Wallet operations over the atomic ledger functions in 2026-coin-wallet.sql.
 *
 * Hybrid funding: an AI charge debits the user's own account first; if that is
 * short, it falls back to their school's account (schools can also allocate
 * coins to students). Zero balance → hard block (chargeForAI throws
 * InsufficientCoins, callers return 402).
 */

import db from "../db.js";
import { coinsForResponseUsage, usdCost, cachedTokensOf, WELCOME_GRANT } from "./aiPricing.js";

export class InsufficientCoins extends Error {
  constructor(needed, balance) {
    super("Insufficient coin balance");
    this.name = "InsufficientCoins";
    this.needed = needed; this.balance = balance; this.code = "INSUFFICIENT_COINS";
  }
}

/** Ensure an account row exists; grant the welcome coins on first creation. */
export async function ensureAccount(ownerType, ownerId) {
  const { data: existing } = await db.from("coin_accounts")
    .select("id, balance").eq("owner_type", ownerType).eq("owner_id", ownerId).maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await db.from("coin_accounts")
    .insert({ owner_type: ownerType, owner_id: ownerId, balance: 0 })
    .select("id, balance").single();
  if (error) {
    // Lost the race — someone created it concurrently; read it back.
    const { data: again } = await db.from("coin_accounts")
      .select("id, balance").eq("owner_type", ownerType).eq("owner_id", ownerId).maybeSingle();
    if (again) return again;
    throw new Error(error.message);
  }
  if (WELCOME_GRANT > 0) {
    // try/catch, NOT a trailing .catch(): a Supabase builder is a thenable with
    // no .catch method, so calling one threw TypeError synchronously — and this
    // runs the FIRST time any user's wallet is created, which made every new
    // user's first AI action a 500. Existing users had wallets already, so it
    // never showed up in an environment that had been running a while.
    try {
      const { error: grantErr } = await db.rpc("coin_credit", {
        p_account: created.id, p_amount: WELCOME_GRANT, p_type: "grant",
        p_meta: { feature: "welcome_grant" },
      });
      if (grantErr) console.warn("[coins] welcome grant failed:", grantErr.message);
    } catch (e) {
      console.warn("[coins] welcome grant threw:", e.message);
    }
    return { ...created, balance: WELCOME_GRANT };
  }
  return created;
}

export async function getAccount(ownerType, ownerId) {
  return ensureAccount(ownerType, ownerId);
}

export async function getBalance(ownerType, ownerId) {
  const a = await ensureAccount(ownerType, ownerId);
  return a.balance;
}

/** Best-effort: the school a user belongs to (student roster → classroom → staff). */
export async function schoolIdForUser(userId) {
  const { data: stu } = await db.schema("mgmt").from("students")
    .select("school_id").eq("user_id", userId).not("school_id", "is", null).limit(1).maybeSingle();
  if (stu?.school_id) return stu.school_id;
  const { data: cs } = await db.from("classroom_students")
    .select("classrooms(school_id)").eq("user_id", userId).limit(1).maybeSingle();
  if (cs?.classrooms?.school_id) return cs.classrooms.school_id;
  const { data: st } = await db.from("school_teachers")
    .select("school_id").eq("teacher_id", userId).limit(1).maybeSingle();
  return st?.school_id ?? null;
}

/**
 * Which account should fund AI usage on a SCHOOL portal — the school itself.
 * Prefers a school the user administers, else the school they belong to.
 * Returns { ownerType:'school', ownerId } or null (no school → fall back to user).
 */
export async function schoolBillTo(userId) {
  if (!userId) return null;
  const { data: owned } = await db.from("school_profiles").select("id").eq("admin_user_id", userId).limit(1).maybeSingle();
  const schoolId = owned?.id || (await schoolIdForUser(userId));
  return schoolId ? { ownerType: "school", ownerId: schoolId } : null;
}

/** Balance available for a charge — a specific billTo account, or the user's hybrid. */
export async function coinsAvailable({ userId, billTo = null, min = 1 }) {
  if (billTo) {
    const acc = await ensureAccount(billTo.ownerType, billTo.ownerId);
    const total = Number(acc.balance || 0);
    return { ok: total >= min, total };
  }
  return hasCoins(userId, min);
}

/** Ordered accounts to draw from for a user's AI usage (own, then school). */
export async function payerAccountsForUser(userId) {
  const accounts = [];
  const own = await ensureAccount("user", userId);
  accounts.push({ ...own, kind: "user" });
  const schoolId = await schoolIdForUser(userId);
  if (schoolId) {
    const school = await ensureAccount("school", schoolId);
    accounts.push({ ...school, kind: "school" });
  }
  return accounts;
}

/**
 * Pre-flight: does the user have at least `minCoins` available across their
 * own + school account? Used to hard-block BEFORE spending money on an AI call.
 */
export async function hasCoins(userId, minCoins = 1) {
  const accounts = await payerAccountsForUser(userId);
  const total = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
  return { ok: total >= minCoins, total, accounts };
}

/**
 * Charge a user for an AI completion AFTER it returns (we know real usage).
 * Debits the user's own account, then their school's for any remainder.
 * Throws InsufficientCoins if the combined balance can't cover it.
 * Returns { charged, model, tokensIn, tokensOut, costUsd, balances }.
 */
export async function chargeForAI({ userId, feature, model, usage = {}, ref = null, billTo = null }) {
  const coins = coinsForResponseUsage(model, usage);
  const tokensIn  = usage.prompt_tokens ?? 0;
  const tokensOut = usage.completion_tokens ?? 0;
  const cost = usdCost(model, tokensIn, tokensOut, cachedTokensOf(usage));
  return debitCoins({ userId, coins, feature, model, tokensIn, tokensOut, cost, ref, billTo });
}

/**
 * Debit an explicit coin amount across the user's own → school accounts, with
 * rollback and a hard InsufficientCoins error. Used by chargeForAI (chat) and
 * by voice metering (audio, priced per minute / per character).
 */
export async function debitCoins({ userId, coins, feature, model = null, tokensIn = null, tokensOut = null, cost = null, ref = null, billTo = null }) {
  if (!coins || coins < 1) return { charged: 0, applied: [] };
  // billTo → charge that specific account directly (e.g. a school funding its
  // students' usage), no student-then-school hybrid.
  if (billTo) {
    const acc = await ensureAccount(billTo.ownerType, billTo.ownerId);
    const meta = { feature, model, tokens_in: tokensIn, tokens_out: tokensOut, cost, ref, by: userId };
    const { data: newBal, error } = await db.rpc("coin_debit", { p_account: acc.id, p_amount: coins, p_type: "debit", p_meta: meta });
    if (error) throw new Error(error.message);
    if (newBal == null) throw new InsufficientCoins(coins, Number(acc.balance || 0));
    return { charged: coins, model, tokensIn, tokensOut, costUsd: cost, applied: [{ account: acc.id, kind: billTo.ownerType, took: coins, balanceAfter: newBal }] };
  }
  const accounts = await payerAccountsForUser(userId);
  let remaining = coins;
  const applied = [];
  for (const acc of accounts) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(acc.balance || 0));
    if (take <= 0) continue;
    const meta = { feature, model, tokens_in: tokensIn, tokens_out: tokensOut, cost, ref, by: userId };
    const { data: newBal, error } = await db.rpc("coin_debit", { p_account: acc.id, p_amount: take, p_type: "debit", p_meta: meta });
    if (error) throw new Error(error.message);
    if (newBal == null) continue;      // raced to empty — try next account
    remaining -= take;
    applied.push({ account: acc.id, kind: acc.kind, took: take, balanceAfter: newBal });
  }
  if (remaining > 0) {
    for (const a of applied) {
      // Same trap, and worse here: this is the ROLLBACK path, so the TypeError
      // masked whatever failure triggered it and left the coins debited.
      try {
        const { error: refundErr } = await db.rpc("coin_credit", {
          p_account: a.account, p_amount: a.took, p_type: "refund",
          p_meta: { feature: `${feature}:rollback`, ref },
        });
        if (refundErr) console.error("[coins] ROLLBACK FAILED — coins still debited:", refundErr.message, { account: a.account, amount: a.took });
      } catch (e) {
        console.error("[coins] ROLLBACK THREW — coins still debited:", e.message, { account: a.account, amount: a.took });
      }
    }
    const { total } = await hasCoins(userId, coins);
    throw new InsufficientCoins(coins, total);
  }
  return { charged: coins, model, tokensIn, tokensOut, costUsd: cost, applied };
}

/**
 * Refund a completed debit to the SAME accounts it came from.
 *
 * debitCoins can spread one charge across the user's own wallet and their
 * school's. Refunding the total to the user account would leave the school
 * short and the learner over — so replay the `applied` breakdown instead.
 * Returns the number of accounts that could not be credited back.
 */
export async function refundCoins({ applied = [], feature, ref }) {
  let failed = 0;
  for (const a of applied) {
    const { error } = await db.rpc("coin_credit", {
      p_account: a.account, p_amount: a.took, p_type: "refund",
      p_meta: { feature: `${feature}:refund`, ref },
    });
    if (error) { failed++; console.error(`[coins] refund failed account=${a.account} coins=${a.took} ref=${ref}:`, error.message); }
  }
  return failed;
}

/** Credit a top-up idempotently by its Paystack reference. */
export async function creditTopup({ ownerType, ownerId, coins, ref, costUsd = null, by = null }) {
  const acc = await ensureAccount(ownerType, ownerId);
  const { data: newBal } = await db.rpc("coin_topup", {
    p_account: acc.id, p_amount: coins, p_ref: ref, p_meta: { cost: costUsd, by },
  });
  return { credited: newBal != null, balance: newBal, alreadyApplied: newBal == null };
}

/** School → student allocation (moves coins between accounts atomically-ish). */
export async function allocateToStudent({ schoolId, studentUserId, coins, by }) {
  const school = await ensureAccount("school", schoolId);
  const student = await ensureAccount("user", studentUserId);
  const { data: schoolBal } = await db.rpc("coin_debit", {
    p_account: school.id, p_amount: coins, p_type: "allocate", p_meta: { feature: `allocate:${studentUserId}`, by },
  });
  if (schoolBal == null) throw new InsufficientCoins(coins, school.balance);
  await db.rpc("coin_credit", { p_account: student.id, p_amount: coins, p_type: "allocate", p_meta: { feature: `allocate:from_school`, by } });
  return { schoolBalance: schoolBal };
}
