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
import { authenticateToken } from "../auth/routes.js";
import {
  ensureAccount, getBalance, payerAccountsForUser, creditTopup,
  allocateToStudent, InsufficientCoins,
} from "../../lib/coins.js";
import {
  COIN_USD, AI_MARKUP, USD_NGN, WELCOME_GRANT,
  coinsToKobo, nairaToCoins, coinsToUsd, coinsForUsage,
} from "../../lib/aiPricing.js";
import { initializeTransaction } from "../adaptive-learning/marketplace/paystackService.js";

const router = Router();
const SCHOOL_ROLES = ["school", "school_admin", "admin"];

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
    const { data: txns } = await db.from("coin_transactions")
      .select("id, delta, balance_after, type, feature, model, tokens_in, tokens_out, ref, created_at")
      .eq("account_id", primary.id).order("created_at", { ascending: false }).limit(25);
    res.json({
      success: true,
      data: {
        balance: primary.balance,
        accounts: accounts.map((a) => ({ id: a.id, kind: a.kind, balance: a.balance })),
        recent: txns || [],
        coinValueUsd: COIN_USD,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    const email = req.user.email || `user_${req.user.id}@akoro.app`;
    const init = await initializeTransaction({
      email, amount_kobo: kobo, reference,
      metadata: { purpose: "coin_topup", owner_type: ownerType, owner_id: ownerId, coins, by: req.user.id },
      callback_url: `${process.env.FRONTEND_URL || process.env.APP_URL || ""}/wallet?ref=${reference}`,
    });
    res.json({ success: true, data: { authorization_url: init.authorization_url, reference, coins, amountNaira: kobo / 100 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    res.status(500).json({ error: e.message });
  }
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
