/**
 * modules/wallet/routes.js
 * ─────────────────────────────────────────────────────────────
 * Coin wallet API — balance, ledger, Paystack top-up, school→student
 * allocation, and the pricing config. Mounted at /api/wallet.
 *
 * Top-ups reuse the shared Paystack initialize flow; the charge is credited
 * idempotently from the unified Paystack webhook via fulfillCoinTopup().
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import db from "../../db.js";
import { serverError } from "../../lib/httpError.js";
import { authenticateToken } from "../auth/routes.js";
import {
  ensureAccount, getBalance, payerAccountsForUser, creditTopup,
  allocateToStudent, InsufficientCoins,
} from "../../lib/coins.js";
import {
  COIN_USD, AI_MARKUP, USD_NGN, WELCOME_GRANT,
  coinsToKobo, nairaToCoins, coinsToUsd, coinsForUsage,
} from "../../lib/aiPricing.js";
import { initializeTransaction } from "../../lib/paystackService.js";
import { redeemVoucher, VoucherError, voucherRedeemConfigured } from "../../lib/voucherRedeem.js";
import { urlFor, displayHost } from "../../lib/urls.js";

const router = Router();
const SCHOOL_ROLES = ["school", "school_admin", "admin"];
const LOW_BALANCE = Math.max(0, Number(process.env.COIN_LOW_BALANCE ?? 100));

// Redirect a top-up back to the portal it was started from — not always the
// learner app. Driven by the X-Akoro-Portal header each frontend sends.
function walletFrontend(req) {
  const portal = String(req.headers["x-akoro-portal"] || "").toLowerCase();
  const byPortal = {
    school:       process.env.SCHOOL_FRONTEND_URL,
    school_admin: process.env.SCHOOL_FRONTEND_URL,
    instructor:   process.env.INSTRUCTOR_FRONTEND_URL || process.env.INSTRUCTOR_URL || process.env.INSTRUCTOR_APP_URL,
    admin:        process.env.ADMIN_FRONTEND_URL,
  };
  return byPortal[portal] || process.env.FRONTEND_URL || process.env.APP_URL || "";
}

// Resolve the school this user administers (for school-wallet actions).
async function mySchoolId(userId) {
  const { data } = await db.from("school_profiles").select("id")
    .eq("admin_user_id", userId).order("created_at", { ascending: true }).limit(1).maybeSingle();
  return data?.id ?? null;
}

// ── GET /api/wallet — balance(s) + recent transactions ────────────────────────
router.get("/", authenticateToken, async (req, res) => {
  try {
    const accounts = await payerAccountsForUser(req.user.id);
    // Include the school wallet the user *administers* (not just belongs to).
    if (SCHOOL_ROLES.includes(req.user.role)) {
      const sid = await mySchoolId(req.user.id);
      if (sid && !accounts.some((a) => a.kind === "school")) {
        const sacc = await ensureAccount("school", sid);
        accounts.push({ ...sacc, kind: "school" });
      }
    }
    const primary = accounts[0];
    // Activity must cover EVERY wallet this user can see, not just their own.
    // accounts[0] is always the personal account, so a school admin — whose
    // page shows the SCHOOL balance — saw personal transactions only: a
    // school-targeted top-up or voucher redemption updated the balance but
    // never appeared in the list. Each row is tagged so the UI can label it.
    const byId = Object.fromEntries(accounts.map((a) => [a.id, a.kind]));
    const { data: txns } = await db.from("coin_transactions")
      .select("id, account_id, delta, balance_after, type, feature, model, tokens_in, tokens_out, ref, created_at")
      .in("account_id", accounts.map((a) => a.id))
      .order("created_at", { ascending: false }).limit(25);
    const recent = (txns || []).map((t) => ({ ...t, accountKind: byId[t.account_id] || "user" }));
    res.json({
      success: true,
      data: {
        balance: primary.balance,
        accounts: accounts.map((a) => ({ id: a.id, kind: a.kind, balance: a.balance })),
        recent,
        coinValueUsd: COIN_USD,
        lowBalanceThreshold: LOW_BALANCE,
        low: (accounts.reduce((s, a) => s + Number(a.balance || 0), 0)) < LOW_BALANCE,
      },
    });
  } catch (e) { serverError(res, e, req); }
});

// ── GET /api/wallet/transactions?account=&limit=&offset= ──────────────────────
router.get("/transactions", authenticateToken, async (req, res) => {
  try {
    const own = await ensureAccount("user", req.user.id);
    let accountId = own.id;
    if (req.query.account === "school" && SCHOOL_ROLES.includes(req.user.role)) {
      const sid = await mySchoolId(req.user.id);
      if (sid) accountId = (await ensureAccount("school", sid)).id;
    }
    const limit  = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
    const offset = parseInt(req.query.offset ?? "0", 10);
    const { data } = await db.from("coin_transactions").select("*")
      .eq("account_id", accountId).order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    res.json({ success: true, data: data || [] });
  } catch (e) { serverError(res, e, req); }
});

// ── GET /api/wallet/pricing — coin economics + example costs ──────────────────
router.get("/pricing", authenticateToken, (_req, res) => {
  res.json({
    success: true,
    data: {
      coinValueUsd: COIN_USD, markup: AI_MARKUP, usdNgn: USD_NGN, welcomeGrant: WELCOME_GRANT,
      coinPriceNaira: coinsToKobo(1) / 100,
      examples: [
        { label: "Tutor message", model: "gpt-4o-mini", coins: coinsForUsage("gpt-4o-mini", 3000, 500) },
        { label: "Quiz generation", model: "gpt-4.1-mini", coins: coinsForUsage("gpt-4.1-mini", 2000, 1500) },
        { label: "Assessment (approx)", model: "gpt-4.1-mini", coins: coinsForUsage("gpt-4.1-mini", 15000, 6000) },
      ],
    },
  });
});

// ── POST /api/wallet/topup/init  { coins?|naira?, target?: 'user'|'school' } ──
// Returns a Paystack authorization_url. The wallet is credited on webhook.
router.post("/topup/init", authenticateToken, async (req, res) => {
  try {
    const b = req.body || {};
    const target = b.target === "school" ? "school" : "user";
    let ownerType = "user", ownerId = req.user.id;
    if (target === "school") {
      if (!SCHOOL_ROLES.includes(req.user.role)) return res.status(403).json({ error: "Only school admins can top up the school wallet" });
      const sid = await mySchoolId(req.user.id);
      if (!sid) return res.status(404).json({ error: "No school found for this account" });
      ownerType = "school"; ownerId = sid;
    }
    const coins = b.coins ? Math.floor(Number(b.coins)) : (b.naira ? nairaToCoins(Number(b.naira)) : 0);
    if (!coins || coins < 1) return res.status(400).json({ error: "Specify a positive `coins` or `naira` amount" });
    const kobo = coinsToKobo(coins);
    if (kobo < 100) return res.status(400).json({ error: "Top-up amount is too small" });

    await ensureAccount(ownerType, ownerId);
    const reference = `coins_${randomUUID()}`;
    const email = req.user.email || `user_${req.user.id}@${displayHost(urlFor("MAIN_SITE_URL"))}`;
    const init = await initializeTransaction({
      email, amount_kobo: kobo, reference,
      metadata: { purpose: "coin_topup", owner_type: ownerType, owner_id: ownerId, coins, by: req.user.id },
      callback_url: `${walletFrontend(req)}/wallet?ref=${reference}`,
    });
    res.json({ success: true, data: { authorization_url: init.authorization_url, reference, coins, amountNaira: kobo / 100 } });
  } catch (e) { serverError(res, e, req); }
});

// ── POST /api/wallet/redeem-voucher  { code } ─────────────────────────────────
// Top up with a voucher code bought from an agent. The code is redeemed
// server-side against the voucher API (the secret key never leaves the
// backend); 1 voucher credit = 1 coin.
router.post("/redeem-voucher", authenticateToken, async (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Enter a voucher code" });
  if (!voucherRedeemConfigured()) return res.status(503).json({ error: "Voucher redemption isn't configured on this server" });

  // Same targeting rules as /topup/init. Without this a school admin
  // redeeming from the school wallet page — where top-ups fund the SCHOOL —
  // would silently credit their personal wallet instead.
  const target = req.body?.target === "school" ? "school" : "user";
  let ownerType = "user", ownerId = req.user.id;
  if (target === "school") {
    if (!SCHOOL_ROLES.includes(req.user.role)) return res.status(403).json({ error: "Only school admins can top up the school wallet" });
    const sid = await mySchoolId(req.user.id);
    if (!sid) return res.status(404).json({ error: "No school found for this account" });
    ownerType = "school"; ownerId = sid;
  }

  try {
    const { credits, transactionId } = await redeemVoucher({ code, customerId: req.user.id });
    if (credits < 1) return res.status(400).json({ error: "That voucher carries no credits" });

    // Idempotent on the voucher's own transaction id, so a retried request
    // (or a double-tap) can never credit the same voucher twice.
    const { balance } = await creditTopup({
      ownerType, ownerId, coins: credits,
      ref: `voucher_${transactionId}`, by: req.user.id,
    });
    res.json({ success: true, data: { coins: credits, balance, target } });
  } catch (e) {
    if (e instanceof VoucherError) return res.status(e.status === 429 ? 429 : 400).json({ error: e.message, reason: e.reason });
    console.error("[wallet/redeem-voucher]", e.message);
    res.status(500).json({ error: "Could not redeem that code — please try again" });
  }
});

// ── POST /api/wallet/allocate  { student_user_id, coins } (school admins) ─────
router.post("/allocate", authenticateToken, async (req, res) => {
  try {
    if (!SCHOOL_ROLES.includes(req.user.role)) return res.status(403).json({ error: "Only school admins can allocate coins" });
    const sid = await mySchoolId(req.user.id);
    if (!sid) return res.status(404).json({ error: "No school found for this account" });
    const { student_user_id, coins } = req.body || {};
    const amount = Math.floor(Number(coins));
    if (!student_user_id || !amount || amount < 1) return res.status(400).json({ error: "student_user_id and a positive coins amount are required" });
    const r = await allocateToStudent({ schoolId: sid, studentUserId: student_user_id, coins: amount, by: req.user.id });
    res.json({ success: true, data: { schoolBalance: r.schoolBalance, allocated: amount } });
  } catch (e) {
    if (e instanceof InsufficientCoins) return res.status(402).json({ error: "Insufficient school balance", code: "INSUFFICIENT_COINS", needed: e.needed, balance: e.balance });
    serverError(res, e, req);
  }
});

// ── Admin: platform coin overview (revenue/usage) ────────────────────────────
router.get("/admin/overview", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const { data, error } = await db.rpc("coin_overview");
    if (error) throw new Error(error.message);
    res.json({ success: true, data: { ...data, coinValueUsd: COIN_USD } });
  } catch (e) { serverError(res, e, req); }
});

// ── Admin: grant/adjust coins on any account  { owner_type, owner_id, coins } ──
// Positive coins credit (grant); negative deduct (adjust).
router.post("/admin/grant", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const { owner_type = "user", owner_id, coins, reason } = req.body || {};
    const amount = Math.trunc(Number(coins));
    if (!owner_id || !amount) return res.status(400).json({ error: "owner_id and a non-zero coins amount are required" });
    if (!["user", "school"].includes(owner_type)) return res.status(400).json({ error: "owner_type must be user or school" });
    const acc = await ensureAccount(owner_type, owner_id);
    const meta = { feature: reason ? `admin:${reason}` : "admin_grant", by: req.user.id };
    if (amount > 0) {
      const { data: bal } = await db.rpc("coin_credit", { p_account: acc.id, p_amount: amount, p_type: "grant", p_meta: meta });
      return res.json({ success: true, data: { balance: bal, granted: amount } });
    }
    const { data: bal } = await db.rpc("coin_debit", { p_account: acc.id, p_amount: -amount, p_type: "adjust", p_meta: meta });
    if (bal == null) return res.status(402).json({ error: "Account balance too low to deduct that amount" });
    res.json({ success: true, data: { balance: bal, adjusted: amount } });
  } catch (e) { serverError(res, e, req); }
});

// ── Webhook fulfillment — credit a coin top-up (idempotent by reference) ──────
// Wired into the unified Paystack dispatcher; no-ops for non-coin metadata.
export async function fulfillCoinTopup(data) {
  const md = data?.metadata || {};
  if (md.purpose !== "coin_topup") return false;
  const ref = data?.reference;
  const coins = Math.floor(Number(md.coins || 0));
  if (!ref || coins < 1 || !md.owner_type || !md.owner_id) return false;
  const costUsd = data?.amount ? (Number(data.amount) / 100) / USD_NGN : null;   // kobo→₦→$
  const r = await creditTopup({ ownerType: md.owner_type, ownerId: md.owner_id, coins, ref, costUsd, by: md.by || null });
  return r.credited || r.alreadyApplied;   // handled either way (idempotent)
}

export default router;
