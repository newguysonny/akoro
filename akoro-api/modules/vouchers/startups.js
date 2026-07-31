/**
 * startups.js — startup onboarding + admin (Akoro-authenticated).
 * A "startup" here is any Akoro user managing their business's voucher
 * program: register, set the credit rate + discount tiers, mint API keys,
 * view redemptions/analytics.
 */
import { Router } from "express";
import { authenticateToken } from "../auth/routes.js";
import { vdb } from "./db.js";
import { issueApiKey } from "./lib/apiKeys.js";
import { getStartupBalance, debitWithdrawal, refundWithdrawal, startupTransactions, ensureStartupWallet, PLATFORM_FEE_PCT } from "./lib/startupWallet.js";
import { createTransferRecipient, initiateTransfer } from "./lib/paystack.js";

const router = Router();
router.use(authenticateToken);

const slugify = (s) => String(s || "").toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `startup-${Date.now()}`;

// Ownership guard — only the startup's owner may manage it.
async function ownedStartup(req, res) {
  const { data } = await vdb().from("startups").select("*").eq("id", req.params.id).maybeSingle();
  if (!data) { res.status(404).json({ error: "Startup not found" }); return null; }
  if (data.owner_user_id !== req.user.id) { res.status(403).json({ error: "Not your startup" }); return null; }
  return data;
}

// POST /api/vouchers/startups — register a new startup.
router.post("/", async (req, res) => {
  try {
    const { name, credit_rate_usd } = req.body || {};
    const rate = Number(credit_rate_usd);
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    if (!rate || rate <= 0) return res.status(400).json({ error: "credit_rate_usd must be a positive number" });

    let slug = slugify(name);
    const { data: clash } = await vdb().from("startups").select("id").eq("slug", slug).maybeSingle();
    if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

    const { data, error } = await vdb().from("startups").insert({
      owner_user_id: req.user.id, name: name.trim(), slug, credit_rate_usd: rate,
    }).select("*").single();
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, startup: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/vouchers/startups/mine — startups I own.
router.get("/mine", async (req, res) => {
  try {
    const { data } = await vdb().from("startups").select("*").eq("owner_user_id", req.user.id).order("created_at", { ascending: false });
    res.json({ success: true, startups: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/vouchers/startups/:id — update rate / webhook / status.
router.patch("/:id", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const patch = {};
    if (req.body.credit_rate_usd != null) {
      const rate = Number(req.body.credit_rate_usd);
      if (!rate || rate <= 0) return res.status(400).json({ error: "credit_rate_usd must be positive" });
      patch.credit_rate_usd = rate;
    }
    if (req.body.webhook_url !== undefined) patch.webhook_url = req.body.webhook_url || null;
    if (req.body.status && ["active", "suspended"].includes(req.body.status)) patch.status = req.body.status;
    if (!Object.keys(patch).length) return res.status(400).json({ error: "No valid fields" });
    patch.updated_at = new Date().toISOString();
    const { data, error } = await vdb().from("startups").update(patch).eq("id", startup.id).select("*").single();
    if (error) throw new Error(error.message);
    res.json({ success: true, startup: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/vouchers/startups/:id/discount-tiers — replace the tier ladder.
// Body: { tiers: [{ min_credits, discount_pct }, ...] }
router.post("/:id/discount-tiers", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const tiers = Array.isArray(req.body?.tiers) ? req.body.tiers : [];
    for (const t of tiers) {
      if (!(Number(t.min_credits) > 0) || !(Number(t.discount_pct) >= 0 && Number(t.discount_pct) < 100))
        return res.status(400).json({ error: "Each tier needs a positive min_credits and a discount_pct in [0,100)" });
    }
    await vdb().from("discount_tiers").delete().eq("startup_id", startup.id);
    if (tiers.length) {
      await vdb().from("discount_tiers").insert(
        tiers.map((t, i) => ({ startup_id: startup.id, min_credits: Math.floor(Number(t.min_credits)), discount_pct: Number(t.discount_pct), sort_order: i }))
      );
    }
    const { data } = await vdb().from("discount_tiers").select("*").eq("startup_id", startup.id).order("min_credits");
    res.json({ success: true, tiers: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/vouchers/startups/:id/api-keys — mint a new key (shown once).
router.post("/:id/api-keys", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const key = await issueApiKey(startup.id, req.body?.label || null);
    res.status(201).json({ success: true, key });   // rawKey only ever appears in THIS response
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/vouchers/startups/:id/api-keys — list (never returns the raw key).
router.get("/:id/api-keys", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const { data } = await vdb().from("api_keys")
      .select("id, key_prefix, label, status, created_at, last_used_at")
      .eq("startup_id", startup.id).order("created_at", { ascending: false });
    res.json({ success: true, keys: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/vouchers/startups/:id/api-keys/:keyId — revoke.
router.delete("/:id/api-keys/:keyId", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    await vdb().from("api_keys").update({ status: "revoked" }).eq("id", req.params.keyId).eq("startup_id", startup.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/vouchers/startups/:id/redemptions — audit list.
router.get("/:id/redemptions", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
    const { data } = await vdb().from("redemptions")
      .select("id, customer_id, redeemed_at, codes(code, credits, agent_id)")
      .eq("startup_id", startup.id).order("redeemed_at", { ascending: false }).limit(limit);
    res.json({ success: true, redemptions: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/vouchers/startups/:id/analytics — quick summary.
router.get("/:id/analytics", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const [{ count: totalCodes }, { count: usedCodes }, { count: activeKeys }, { data: batches }] = await Promise.all([
      vdb().from("codes").select("id", { count: "exact", head: true }).eq("startup_id", startup.id),
      vdb().from("codes").select("id", { count: "exact", head: true }).eq("startup_id", startup.id).eq("status", "used"),
      vdb().from("api_keys").select("id", { count: "exact", head: true }).eq("startup_id", startup.id).eq("status", "active"),
      vdb().from("batches").select("total_cost_usd, quantity, unit_credits").eq("startup_id", startup.id).eq("status", "paid"),
    ]);
    const grossSalesUsd = (batches || []).reduce((s, b) => s + Number(b.total_cost_usd || 0), 0);
    const creditsSold = (batches || []).reduce((s, b) => s + Number(b.quantity || 0) * Number(b.unit_credits || 0), 0);
    res.json({
      success: true,
      analytics: { totalCodes: totalCodes || 0, usedCodes: usedCodes || 0, activeApiKeys: activeKeys || 0, grossSalesUsd, creditsSold },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/vouchers/startups/:id/wallet — settlement balance + ledger.
router.get("/:id/wallet", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const [balance, recent] = await Promise.all([getStartupBalance(startup.id), startupTransactions(startup.id, { limit: 30 })]);
    res.json({ success: true, balance, platformFeePct: PLATFORM_FEE_PCT, recent });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/vouchers/startups/:id/wallet/transactions
router.get("/:id/wallet/transactions", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
    const offset = parseInt(req.query.offset ?? "0", 10);
    const rows = await startupTransactions(startup.id, { limit, offset });
    res.json({ success: true, transactions: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/vouchers/startups/:id/withdraw — payout via Paystack transfer.
// Body: { amountUsd, bankCode, accountNumber, accountName? }
// Claim-then-act with revert (same pattern as Akoro's instructor payouts): the
// balance is debited FIRST (atomically, no overdraft), then the transfer is
// attempted; any failure refunds the debit and marks the withdrawal failed.
router.post("/:id/withdraw", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const amountUsd = Number(req.body?.amountUsd);
    const { bankCode, accountNumber, accountName } = req.body || {};
    if (!amountUsd || amountUsd <= 0) return res.status(400).json({ error: "amountUsd must be a positive number" });
    if (!bankCode || !accountNumber) return res.status(400).json({ error: "bankCode and accountNumber are required" });

    const ngnRate = Math.max(1, Number(process.env.USD_NGN_RATE || 1600));
    const amountKobo = Math.round(amountUsd * ngnRate * 100);
    if (amountKobo < 5000) return res.status(400).json({ error: "Minimum withdrawal is roughly $3 (₦5,000)" });

    const wallet = await ensureStartupWallet(startup.id);
    const { data: wd, error: wErr } = await vdb().from("withdrawals").insert({
      startup_id: startup.id, wallet_id: wallet.id,
      amount_usd: amountUsd, bank_code: bankCode, account_number: accountNumber, account_name: accountName || null,
      status: "pending",
    }).select("id, wallet_id").single();
    if (wErr) throw new Error(wErr.message);

    try {
      await debitWithdrawal(startup.id, amountUsd, wd.id);
    } catch (e) {
      await vdb().from("withdrawals").update({ status: "failed", failure_reason: "insufficient_balance" }).eq("id", wd.id);
      if (e.code === "INSUFFICIENT_BALANCE") return res.status(402).json({ error: "Insufficient balance", code: "INSUFFICIENT_BALANCE", needed: e.needed, balance: e.balance });
      throw e;
    }

    try {
      const recipient = await createTransferRecipient({ name: accountName || startup.name, accountNumber, bankCode });
      const transfer = await initiateTransfer({
        amount_kobo: amountKobo, recipientCode: recipient.recipientCode,
        reason: `Akoro Vouchers settlement — ${startup.name}`, reference: `vwithdraw_${wd.id}`,
      });
      const status = transfer.status === "success" ? "paid" : "processing";
      await vdb().from("withdrawals").update({
        status, paystack_recipient_code: recipient.recipientCode, paystack_transfer_code: transfer.transferCode,
        paid_at: status === "paid" ? new Date().toISOString() : null,
      }).eq("id", wd.id);
      res.status(201).json({ success: true, withdrawalId: wd.id, status, amountUsd });
    } catch (e) {
      // Transfer failed outright (not just pending) — refund and mark failed.
      await refundWithdrawal(startup.id, amountUsd, wd.id).catch(() => {});
      await vdb().from("withdrawals").update({ status: "failed", failure_reason: e.message }).eq("id", wd.id);
      res.status(502).json({ error: `Payout failed: ${e.message}` });
    }
  } catch (e) {
    console.error("[vouchers/withdraw]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/vouchers/startups/:id/withdrawals — history.
router.get("/:id/withdrawals", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const { data } = await vdb().from("withdrawals").select("*").eq("startup_id", startup.id).order("created_at", { ascending: false }).limit(50);
    res.json({ success: true, withdrawals: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
