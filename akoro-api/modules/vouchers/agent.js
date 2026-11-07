/**
 * agent.js — the agent-facing surface (Akoro-authenticated): browse startups,
 * top up wallet, buy voucher batches, view codes + purchase history.
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { authenticateToken } from "../auth/routes.js";
import { vdb } from "./db.js";
import { serverError } from "./lib/httpError.js";
import { getBalance, debit, credit, transactions } from "./lib/wallet.js";
import { priceForQuantity } from "./lib/pricing.js";
import { generateCodes } from "./lib/codes.js";
import { initializeTransaction } from "./lib/paystack.js";
import { urlFor, displayHost } from "../../lib/urls.js";

const router = Router();
router.use(authenticateToken);

// GET /api/vouchers/marketplace — active startups an agent can buy from,
// enriched with discount tiers, popularity (codes sold / redeemed), and
// "have I bought from them before" — the data the Discovery-style
// marketplace rails (Recommended / Trending / New) sort and badge by.
router.get("/marketplace", async (req, res) => {
  try {
    const { data: startups } = await vdb().from("startups")
      .select("id, name, slug, credit_rate_usd, description, cover_image_url, category, created_at")
      .eq("status", "active").order("name");
    const ids = (startups || []).map((s) => s.id);

    const [{ data: tiers }, { data: products }, { data: batches }, { data: myBatches }] = await Promise.all([
      ids.length ? vdb().from("discount_tiers").select("startup_id, min_credits, discount_pct").in("startup_id", ids).order("min_credits") : { data: [] },
      ids.length ? vdb().from("voucher_products").select("*").eq("status", "active").in("startup_id", ids).order("price_usd") : { data: [] },
      ids.length ? vdb().from("batches").select("startup_id, quantity").eq("status", "paid").in("startup_id", ids) : { data: [] },
      ids.length ? vdb().from("batches").select("startup_id").eq("agent_id", req.user.id).in("startup_id", ids) : { data: [] },
    ]);

    const tiersByStartup = {};
    (tiers || []).forEach((t) => { (tiersByStartup[t.startup_id] ||= []).push(t); });
    const productsByStartup = {};
    (products || []).forEach((p) => { (productsByStartup[p.startup_id] ||= []).push(p); });
    const soldByStartup = {};
    (batches || []).forEach((b) => { soldByStartup[b.startup_id] = (soldByStartup[b.startup_id] || 0) + b.quantity; });
    const boughtFrom = new Set((myBatches || []).map((b) => b.startup_id));

    res.json({
      success: true,
      startups: (startups || []).map((s) => ({
        ...s,
        discountTiers: tiersByStartup[s.id] || [],
        products: productsByStartup[s.id] || [],
        codesSold: soldByStartup[s.id] || 0,
        boughtBefore: boughtFrom.has(s.id),
      })),
    });
  } catch (e) { serverError(res, e, req); }
});

// GET /api/vouchers/wallet — my balance + recent transactions.
router.get("/wallet", async (req, res) => {
  try {
    const [balance, recent] = await Promise.all([getBalance(req.user.id), transactions(req.user.id, { limit: 25 })]);
    res.json({ success: true, balance, recent });
  } catch (e) { serverError(res, e, req); }
});

// GET /api/vouchers/wallet/transactions
router.get("/wallet/transactions", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
    const offset = parseInt(req.query.offset ?? "0", 10);
    const rows = await transactions(req.user.id, { limit, offset });
    res.json({ success: true, transactions: rows });
  } catch (e) { serverError(res, e, req); }
});

// POST /api/vouchers/wallet/topup/init — Paystack top-up (fiat only, v1).
router.post("/wallet/topup/init", async (req, res) => {
  try {
    const amountUsd = Number(req.body?.amountUsd);
    if (!amountUsd || amountUsd <= 0) return res.status(400).json({ error: "amountUsd must be a positive number" });
    const ngnRate = Math.max(1, Number(process.env.USD_NGN_RATE || 1600));
    const kobo = Math.round(amountUsd * ngnRate * 100);
    if (kobo < 100) return res.status(400).json({ error: "Top-up amount is too small" });

    const reference = `vwallet_${randomUUID()}`;
    const email = req.user.email || `user_${req.user.id}@${displayHost(urlFor("MAIN_SITE_URL"))}`;
    const frontend = process.env.VOUCHERS_FRONTEND_URL || process.env.FRONTEND_URL || "";
    const init = await initializeTransaction({
      email, amount_kobo: kobo, reference,
      metadata: { purpose: "voucher_wallet_topup", user_id: req.user.id, amount_usd: amountUsd },
      callback_url: `${frontend}/wallet?ref=${reference}`,
    });
    res.json({ success: true, authorization_url: init.authorization_url, reference, amountUsd, amountNaira: kobo / 100 });
  } catch (e) { serverError(res, e, req); }
});

// POST /api/vouchers/purchase — buy N codes of a startup, paid from the wallet.
// Body: { startupId, quantity, unitCredits }
router.post("/purchase", async (req, res) => {
  try {
    const { startupId, quantity, unitCredits } = req.body || {};
    const qty = Math.floor(Number(quantity));
    const credits = Math.floor(Number(unitCredits));
    // Number.isFinite rejects Infinity/NaN, which the bare `!x` idiom lets through.
    if (!startupId || !Number.isFinite(qty) || qty < 1 || !Number.isFinite(credits) || credits < 1)
      return res.status(400).json({ error: "startupId, a positive quantity and unitCredits are required" });
    if (qty > 10000) return res.status(400).json({ error: "Max 10,000 codes per purchase" });
    if (credits > 1000000) return res.status(400).json({ error: "Max 1,000,000 credits per code" });

    const { data: startup } = await vdb().from("startups").select("*").eq("id", startupId).eq("status", "active").maybeSingle();
    if (!startup) return res.status(404).json({ error: "Startup not found or inactive" });

    const totalCreditsRequested = qty * credits;   // bulk tiers key off TOTAL credits bought
    // priceForQuantity returns a PER-CREDIT rate. The cost of one code is that
    // rate × the credits that code carries — multiplying by qty alone would
    // charge the same for a 1-credit code as a 1,000,000-credit one.
    const { unitPriceUsd: perCreditUsd, discountPct } = await priceForQuantity(startup, totalCreditsRequested);
    const unitPriceUsd = +(perCreditUsd * credits).toFixed(6);   // price per CODE
    const totalCostUsd = +(unitPriceUsd * qty).toFixed(2);

    // 1) Claim the batch as "pending" first so a failed code-generation step
    //    never leaves the agent charged with nothing to show for it.
    const { data: batch, error: bErr } = await vdb().from("batches").insert({
      startup_id: startup.id, agent_id: req.user.id, quantity: qty, unit_credits: credits,
      unit_price_usd: unitPriceUsd, total_cost_usd: totalCostUsd, status: "pending",
    }).select("id").single();
    if (bErr) throw new Error(bErr.message);

    // 2) Debit the wallet atomically. Insufficient funds → roll back the batch.
    try {
      await debit(req.user.id, totalCostUsd, { type: "purchase", ref: batch.id, meta: { startupId: startup.id, quantity: qty } });
    } catch (e) {
      await vdb().from("batches").update({ status: "failed" }).eq("id", batch.id);
      if (e.code === "INSUFFICIENT_FUNDS") return res.status(402).json({ error: "Insufficient wallet balance", code: "INSUFFICIENT_FUNDS", needed: e.needed, balance: e.balance });
      throw e;
    }

    // 3) Generate + insert the codes. On failure, refund the debit and fail the batch.
    let issued;
    try {
      const codes = generateCodes(qty);
      const rows = codes.map((code) => ({
        code, batch_id: batch.id, startup_id: startup.id, agent_id: req.user.id, credits,
        // Snapshot what was actually paid for THIS code — settlement to the
        // startup on redemption is computed from this, not the (possibly
        // later-changed) startup rate.
        paid_price_usd: unitPriceUsd,
      }));
      const { error: cErr } = await vdb().from("codes").insert(rows);
      if (cErr) throw new Error(cErr.message);
      await vdb().from("batches").update({ status: "paid" }).eq("id", batch.id);
      issued = codes;
    } catch (e) {
      try {
        await credit(req.user.id, totalCostUsd, { type: "refund", ref: `refund_${batch.id}`, meta: { reason: "code_generation_failed" } });
      } catch (refundErr) {
        console.error(`[vouchers/purchase] ‼️ REFUND FAILED agent=${req.user.id} batch=${batch.id} $${totalCostUsd} — manual correction required:`, refundErr.message);
      }
      await vdb().from("batches").update({ status: "failed" }).eq("id", batch.id);
      throw e;
    }

    // Responding OUTSIDE the try above: a throw here (or from res.json) must
    // never trigger the refund path for a purchase that actually succeeded,
    // nor double-send after serverError.
    res.status(201).json({
      success: true, batchId: batch.id, quantity: qty, unitCredits: credits,
      unitPriceUsd, discountPct, totalCostUsd, codes: issued,
    });
  } catch (e) {
    console.error("[vouchers/purchase]", e.message);
    serverError(res, e, req);
  }
});

// POST /api/vouchers/purchase-product — buy N units of a fixed-denomination
// voucher product (e.g. "₦1,000 Voucher"). Same claim→debit→generate→
// rollback shape as /purchase, but price/credits come from the product,
// not from the startup's base rate/discount tiers, and quantity is gated
// by the product's own minimum order.
// Body: { startupId, productId, quantity }
router.post("/purchase-product", async (req, res) => {
  try {
    const { startupId, productId, quantity } = req.body || {};
    const qty = Math.floor(Number(quantity));
    if (!startupId || !productId || !qty || qty < 1)
      return res.status(400).json({ error: "startupId, productId and a positive quantity are required" });
    if (qty > 10000) return res.status(400).json({ error: "Max 10,000 codes per purchase" });

    const { data: startup } = await vdb().from("startups").select("*").eq("id", startupId).eq("status", "active").maybeSingle();
    if (!startup) return res.status(404).json({ error: "Startup not found or inactive" });

    const { data: product } = await vdb().from("voucher_products").select("*")
      .eq("id", productId).eq("startup_id", startupId).eq("status", "active").maybeSingle();
    if (!product) return res.status(404).json({ error: "Voucher product not found or no longer available" });
    if (qty < product.min_order_qty) return res.status(400).json({ error: `Minimum order for "${product.name}" is ${product.min_order_qty}` });

    const unitPriceUsd = Number(product.price_usd);
    const credits = product.credits;
    const totalCostUsd = +(unitPriceUsd * qty).toFixed(2);

    const { data: batch, error: bErr } = await vdb().from("batches").insert({
      startup_id: startup.id, agent_id: req.user.id, quantity: qty, unit_credits: credits,
      unit_price_usd: unitPriceUsd, total_cost_usd: totalCostUsd, status: "pending", product_id: product.id,
    }).select("id").single();
    if (bErr) throw new Error(bErr.message);

    try {
      await debit(req.user.id, totalCostUsd, { type: "purchase", ref: batch.id, meta: { startupId: startup.id, productId: product.id, quantity: qty } });
    } catch (e) {
      await vdb().from("batches").update({ status: "failed" }).eq("id", batch.id);
      if (e.code === "INSUFFICIENT_FUNDS") return res.status(402).json({ error: "Insufficient wallet balance", code: "INSUFFICIENT_FUNDS", needed: e.needed, balance: e.balance });
      throw e;
    }

    let issued;
    try {
      const codes = generateCodes(qty);
      const rows = codes.map((code) => ({
        code, batch_id: batch.id, startup_id: startup.id, agent_id: req.user.id, credits, paid_price_usd: unitPriceUsd,
      }));
      const { error: cErr } = await vdb().from("codes").insert(rows);
      if (cErr) throw new Error(cErr.message);
      await vdb().from("batches").update({ status: "paid" }).eq("id", batch.id);
      issued = codes;
    } catch (e) {
      try {
        await credit(req.user.id, totalCostUsd, { type: "refund", ref: `refund_${batch.id}`, meta: { reason: "code_generation_failed" } });
      } catch (refundErr) {
        console.error(`[vouchers/purchase-product] ‼️ REFUND FAILED agent=${req.user.id} batch=${batch.id} $${totalCostUsd} — manual correction required:`, refundErr.message);
      }
      await vdb().from("batches").update({ status: "failed" }).eq("id", batch.id);
      throw e;
    }

    res.status(201).json({
      success: true, batchId: batch.id, quantity: qty, unitCredits: credits,
      unitPriceUsd, totalCostUsd, codes: issued, productName: product.name,
    });
  } catch (e) {
    console.error("[vouchers/purchase-product]", e.message);
    serverError(res, e, req);
  }
});

// GET /api/vouchers/my-codes — codes I've bought, newest first.
router.get("/my-codes", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? "100", 10), 500);
    let q = vdb().from("codes").select("id, code, credits, status, created_at, used_at, startups(name)")
      .eq("agent_id", req.user.id).order("created_at", { ascending: false }).limit(limit);
    if (req.query.status) q = q.eq("status", req.query.status);
    if (req.query.batchId) q = q.eq("batch_id", req.query.batchId);
    const { data } = await q;
    res.json({ success: true, codes: data || [] });
  } catch (e) { serverError(res, e, req); }
});

// GET /api/vouchers/batches — my purchase history, one row per bulk order.
// Each batch is enriched with a redemption breakdown (active/used/expired
// counts) so the agent app can show "3/10 redeemed" on the order card
// without a second round-trip per batch.
router.get("/batches", async (req, res) => {
  try {
    const { data: batches } = await vdb().from("batches").select("*, startups(name, category, cover_image_url)")
      .eq("agent_id", req.user.id).order("created_at", { ascending: false }).limit(100);
    const ids = (batches || []).map((b) => b.id);
    const { data: codes } = ids.length
      ? await vdb().from("codes").select("batch_id, status").in("batch_id", ids)
      : { data: [] };
    const counts = {};
    (codes || []).forEach((c) => {
      const bucket = (counts[c.batch_id] ||= { active: 0, used: 0, expired: 0, refunded: 0 });
      bucket[c.status] = (bucket[c.status] || 0) + 1;
    });
    res.json({
      success: true,
      batches: (batches || []).map((b) => ({ ...b, codeCounts: counts[b.id] || { active: 0, used: 0, expired: 0, refunded: 0 } })),
    });
  } catch (e) { serverError(res, e, req); }
});

export default router;
