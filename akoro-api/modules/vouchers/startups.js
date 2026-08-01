/**
 * startups.js — startup onboarding + admin (Akoro-authenticated).
 * A "startup" here is any Akoro user managing their business's voucher
 * program: register, set the credit rate + discount tiers, mint API keys,
 * view redemptions/analytics.
 */
import { Router } from "express";
import { authenticateToken } from "../auth/routes.js";
import db, { vdb } from "./db.js";
import { issueApiKey } from "./lib/apiKeys.js";
import { getStartupBalance, debitWithdrawal, refundWithdrawal, startupTransactions, ensureStartupWallet, PLATFORM_FEE_PCT } from "./lib/startupWallet.js";
import { createTransferRecipient, initiateTransfer } from "./lib/paystack.js";

const router = Router();
router.use(authenticateToken);

const slugify = (s) => String(s || "").toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `startup-${Date.now()}`;

const CATEGORIES = ["education", "fintech", "gaming", "productivity", "health", "ecommerce", "other"];

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
    const { name, credit_rate_usd, description, cover_image_url, category } = req.body || {};
    const rate = Number(credit_rate_usd);
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    if (!rate || rate <= 0) return res.status(400).json({ error: "credit_rate_usd must be a positive number" });
    if (category && !CATEGORIES.includes(category)) return res.status(400).json({ error: "Invalid category" });

    // Guard against the double-submit that produced real duplicate rows in
    // production (a stuck/retried onboarding form calling this repeatedly).
    // Case-insensitive, scoped to this owner only — two different owners are
    // still free to both register e.g. "Fluent AI".
    const { data: dupe } = await vdb().from("startups").select("id")
      .eq("owner_user_id", req.user.id).ilike("name", name.trim()).maybeSingle();
    if (dupe) return res.status(409).json({ error: `You already have a business named "${name.trim()}"`, existingId: dupe.id });

    let slug = slugify(name);
    const { data: clash } = await vdb().from("startups").select("id").eq("slug", slug).maybeSingle();
    if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

    const { data, error } = await vdb().from("startups").insert({
      owner_user_id: req.user.id, name: name.trim(), slug, credit_rate_usd: rate,
      description: description?.trim() || null, cover_image_url: cover_image_url?.trim() || null,
      category: category || "other",
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
    if (req.body.description !== undefined) patch.description = req.body.description?.trim() || null;
    if (req.body.cover_image_url !== undefined) patch.cover_image_url = req.body.cover_image_url?.trim() || null;
    if (req.body.category !== undefined) {
      if (!CATEGORIES.includes(req.body.category)) return res.status(400).json({ error: "Invalid category" });
      patch.category = req.body.category;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "No valid fields" });
    patch.updated_at = new Date().toISOString();
    const { data, error } = await vdb().from("startups").update(patch).eq("id", startup.id).select("*").single();
    if (error) throw new Error(error.message);
    res.json({ success: true, startup: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/vouchers/startups/:id — for cleaning up duplicates/mistakes.
// Only allowed when the startup has NEVER been used (no batches ever sold) —
// once real money/vouchers have moved through it, use PATCH status=suspended
// instead; deleting it would orphan codes agents already hold and destroy
// settlement history.
router.delete("/:id", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const { count } = await vdb().from("batches").select("id", { count: "exact", head: true }).eq("startup_id", startup.id);
    if (count > 0) {
      return res.status(409).json({ error: "This business has voucher history and can't be deleted — suspend it instead." });
    }
    await vdb().from("api_keys").delete().eq("startup_id", startup.id);
    await vdb().from("discount_tiers").delete().eq("startup_id", startup.id);
    await vdb().from("startup_wallets").delete().eq("startup_id", startup.id);
    const { error } = await vdb().from("startups").delete().eq("id", startup.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
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

// ── Voucher products — fixed-denomination SKUs (e.g. "₦1,000 Voucher") ───────
// Distinct from credit_rate_usd + discount_tiers (custom-amount pricing):
// each product has its OWN price and minimum order quantity, independent of
// the startup's base rate.
function validProductBody(body) {
  const name = String(body?.name || "").trim();
  const credits = Math.floor(Number(body?.credits));
  const priceUsd = Number(body?.price_usd);
  const minOrderQty = body?.min_order_qty != null ? Math.floor(Number(body.min_order_qty)) : 1;
  if (!name) return "name is required";
  if (!credits || credits < 1) return "credits must be a positive integer";
  if (!priceUsd || priceUsd <= 0) return "price_usd must be a positive number";
  if (!minOrderQty || minOrderQty < 1) return "min_order_qty must be a positive integer";
  return { name, credits, price_usd: priceUsd, min_order_qty: minOrderQty };
}

// POST /api/vouchers/startups/:id/products — create a voucher product.
router.post("/:id/products", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const parsed = validProductBody(req.body);
    if (typeof parsed === "string") return res.status(400).json({ error: parsed });
    const { data, error } = await vdb().from("voucher_products").insert({ startup_id: startup.id, ...parsed }).select("*").single();
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, product: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/vouchers/startups/:id/products — list (owner sees archived too).
router.get("/:id/products", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const { data } = await vdb().from("voucher_products").select("*").eq("startup_id", startup.id).order("created_at", { ascending: false });
    res.json({ success: true, products: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/vouchers/startups/:id/products/:productId — edit or archive.
router.patch("/:id/products/:productId", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const patch = {};
    if (req.body.name !== undefined) { const n = String(req.body.name).trim(); if (!n) return res.status(400).json({ error: "name cannot be empty" }); patch.name = n; }
    if (req.body.credits !== undefined) { const c = Math.floor(Number(req.body.credits)); if (!c || c < 1) return res.status(400).json({ error: "credits must be a positive integer" }); patch.credits = c; }
    if (req.body.price_usd !== undefined) { const p = Number(req.body.price_usd); if (!p || p <= 0) return res.status(400).json({ error: "price_usd must be a positive number" }); patch.price_usd = p; }
    if (req.body.min_order_qty !== undefined) { const m = Math.floor(Number(req.body.min_order_qty)); if (!m || m < 1) return res.status(400).json({ error: "min_order_qty must be a positive integer" }); patch.min_order_qty = m; }
    if (req.body.status && ["active", "archived"].includes(req.body.status)) patch.status = req.body.status;
    if (!Object.keys(patch).length) return res.status(400).json({ error: "No valid fields" });
    patch.updated_at = new Date().toISOString();
    const { data, error } = await vdb().from("voucher_products").update(patch).eq("id", req.params.productId).eq("startup_id", startup.id).select("*").single();
    if (error) throw new Error(error.message);
    res.json({ success: true, product: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/vouchers/startups/:id/products/:productId — only if no order
// has ever used it (same conservative rule as deleting a startup itself);
// otherwise archive it via PATCH status=archived so it drops off the
// marketplace without breaking the history of orders that reference it.
router.delete("/:id/products/:productId", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const { count } = await vdb().from("batches").select("id", { count: "exact", head: true })
      .eq("startup_id", startup.id).eq("product_id", req.params.productId);
    if (count > 0) return res.status(409).json({ error: "This product has order history — archive it instead of deleting." });
    const { error } = await vdb().from("voucher_products").delete().eq("id", req.params.productId).eq("startup_id", startup.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/vouchers/startups/:id/api-keys — mint a new key (shown once).
router.post("/:id/api-keys", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const key = await issueApiKey(startup.id, req.body?.label || null, req.user.id);
    res.status(201).json({ success: true, key });   // rawKey only ever appears in THIS response
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/vouchers/startups/:id/api-keys — list (never returns the raw key).
// Enriched with created-by, tracking id, permissions (static — no scopes yet)
// and this-calendar-month spend, mirroring a typical "API keys" table.
router.get("/:id/api-keys", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const { data: keys } = await vdb().from("api_keys")
      .select("id, key_prefix, label, status, created_at, last_used_at, created_by_user_id")
      .eq("startup_id", startup.id).order("created_at", { ascending: false });

    const creatorIds = [...new Set((keys || []).map((k) => k.created_by_user_id).filter(Boolean))];
    const creators = {};
    if (creatorIds.length) {
      const { data: users } = await db.from("users").select("id, full_name, email").in("id", creatorIds);
      (users || []).forEach((u) => { creators[u.id] = u.full_name || u.email; });
    }

    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const { data: monthRedemptions } = await vdb().from("redemptions")
      .select("api_key_id, codes(paid_price_usd)")
      .eq("startup_id", startup.id).gte("redeemed_at", monthStart.toISOString());
    const spendByKey = {};
    (monthRedemptions || []).forEach((r) => {
      if (!r.api_key_id) return;
      spendByKey[r.api_key_id] = (spendByKey[r.api_key_id] || 0) + Number(r.codes?.paid_price_usd || 0);
    });

    const enriched = (keys || []).map((k) => ({
      ...k,
      name: k.label || "Untitled key",
      tracking_id: `key_${k.id.replace(/-/g, "").slice(0, 12)}`,
      created_by: creators[k.created_by_user_id] || "—",
      permissions: "All",
      monthly_spend_usd: +(spendByKey[k.id] || 0).toFixed(2),
    }));
    res.json({ success: true, keys: enriched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/vouchers/startups/:id/api-keys/:keyId/logs — per-key request log.
router.get("/:id/api-keys/:keyId/logs", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
    const { data } = await vdb().from("api_key_logs")
      .select("id, method, path, status_code, reason, ip_address, created_at")
      .eq("startup_id", startup.id).eq("api_key_id", req.params.keyId)
      .order("created_at", { ascending: false }).limit(limit);
    res.json({ success: true, logs: data || [] });
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

// GET /api/vouchers/startups/:id/batches — generation history: which agent
// bought how many codes, when, at what price. The "who and how much" view.
router.get("/:id/batches", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
    const { data: batches, error } = await vdb().from("batches")
      .select("id, quantity, unit_credits, unit_price_usd, total_cost_usd, status, created_at, agent_id")
      .eq("startup_id", startup.id).order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);

    // Enrich with the agent's name/email (public.users — outside the vouchers
    // schema, so a plain select rather than a PostgREST join).
    const agentIds = [...new Set((batches || []).map((b) => b.agent_id))];
    let agentsById = {};
    if (agentIds.length) {
      const { data: agents } = await db.from("users").select("id, full_name, email").in("id", agentIds);
      agentsById = Object.fromEntries((agents || []).map((a) => [a.id, a]));
    }
    res.json({
      success: true,
      batches: (batches || []).map((b) => ({ ...b, agent: agentsById[b.agent_id] || null })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/vouchers/startups/:id/codes/lookup?code=XXXX-XXXX-XXXX — support
// tool: find one code's full status/history (who bought it, is it redeemed).
router.get("/:id/codes/lookup", async (req, res) => {
  const startup = await ownedStartup(req, res);
  if (!startup) return;
  try {
    const code = String(req.query.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ error: "code is required" });
    const { data: row } = await vdb().from("codes")
      .select("id, code, credits, status, created_at, used_at, used_by_customer_id, agent_id, paid_price_usd")
      .eq("startup_id", startup.id).eq("code", code).maybeSingle();
    if (!row) return res.status(404).json({ error: "No code matching that value for this startup" });
    const { data: agent } = row.agent_id ? await db.from("users").select("id, full_name, email").eq("id", row.agent_id).maybeSingle() : { data: null };
    res.json({ success: true, code: { ...row, agent } });
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
