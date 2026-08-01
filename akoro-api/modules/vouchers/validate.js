/**
 * validate.js — the ONE endpoint startups integrate: POST /api/vouchers/v1/validate
 *
 * Your database is the source of truth (never let a startup store/trust its
 * own copy of "is this code used"). Redemption is a SINGLE atomic conditional
 * UPDATE (vouchers.redeem_code) so two concurrent calls for the same code can
 * never both succeed — that's what actually prevents double-spend, not
 * anything at the application layer.
 */
import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { requireApiKey, hashKey } from "./apiKeyAuth.js";
import { vdb } from "./db.js";
import { creditRedemption, PLATFORM_FEE_PCT } from "./lib/startupWallet.js";
import { enqueueWebhook } from "./lib/webhooks.js";

const router = Router();

// Rate-limit PER API KEY, not per IP — the module-level limiter mounted in
// app.js falls back to IP for these requests (there's no Akoro session), which
// would put every startup calling from the same egress IP in one shared
// bucket. Self-contained on purpose (this module owns its own rate-limiting
// behavior, consistent with the decoupling goal).
const perKeyLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,   // generous for real redemption traffic; raise via env if needed
  standardHeaders: true,
  legacyHeaders: false,
  // Key on the API key itself. Two details that matter:
  //  - hash it, so raw secrets never sit in the rate-limit store;
  //  - fall back through ipKeyGenerator(), which normalises IPv6 to a /64
  //    subnet. Returning a bare req.ip would let an IPv6 caller hop addresses
  //    within their prefix to bypass the limit (ERR_ERL_KEY_GEN_IPV6).
  keyGenerator: (req, res) => {
    const auth = req.headers["authorization"] || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    const raw = bearer || req.headers["x-api-key"];
    return raw ? `k:${hashKey(raw)}` : ipKeyGenerator(req.ip);
  },
  message: { valid: false, reason: "rate_limited" },
});
router.use(perKeyLimit);

// Best-effort per-key request log — powers a startup's "API key logs" view.
function logApiCall(req, statusCode, reason) {
  if (!req.startup) return;   // auth never resolved a startup — nothing to attribute the log to
  vdb().from("api_key_logs").insert({
    api_key_id: req.apiKeyId, startup_id: req.startup.id,
    method: req.method, path: req.path, status_code: statusCode, reason: reason || null,
    ip_address: req.ip || null,
  }).then(() => {}, () => {});
}

// POST /api/vouchers/v1/validate
// Auth: Authorization: Bearer sk_live_... (or x-api-key header)
// Body: { voucher_code, customer_id?, idempotency_key? }
router.post("/validate", requireApiKey, async (req, res) => {
  try {
    const code = String(req.body?.voucher_code || "").trim().toUpperCase();
    const customerId = req.body?.customer_id ? String(req.body.customer_id).slice(0, 255) : null;
    const idempotencyKey = req.body?.idempotency_key ? String(req.body.idempotency_key).slice(0, 255) : null;
    if (!code) return res.status(400).json({ valid: false, reason: "voucher_code required" });

    // Idempotency: if this startup already reported this idempotency_key,
    // return the SAME result instead of re-validating (safe retry).
    if (idempotencyKey) {
      const { data: prior } = await vdb().from("redemptions")
        .select("id, code_id").eq("startup_id", req.startup.id).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (prior) {
        const { data: c } = await vdb().from("codes").select("credits, code").eq("id", prior.code_id).maybeSingle();
        logApiCall(req, 200, "replay");
        return res.json({
          valid: true, credits: c?.credits ?? null, currency: "USD",
          transaction_id: prior.id, replay: true,
        });
      }
    }

    const { data: rows, error } = await vdb().rpc("redeem_code", {
      p_code: code, p_startup_id: req.startup.id, p_customer_id: customerId, p_idempotency_key: idempotencyKey,
    });
    if (error) throw new Error(error.message);
    const won = rows?.[0];

    if (!won) {
      // Distinguish WHY it failed for a useful error (read-only, no state change).
      const { data: existing } = await vdb().from("codes")
        .select("status, expires_at").eq("code", code).eq("startup_id", req.startup.id).maybeSingle();
      if (!existing) { logApiCall(req, 404, "not_found"); return res.status(404).json({ valid: false, reason: "not_found" }); }
      if (existing.status === "used")     { logApiCall(req, 409, "already_used"); return res.status(409).json({ valid: false, reason: "already_used" }); }
      if (existing.status === "expired" || (existing.expires_at && new Date(existing.expires_at) < new Date())) {
        logApiCall(req, 410, "expired"); return res.status(410).json({ valid: false, reason: "expired" });
      }
      if (existing.status === "refunded") { logApiCall(req, 410, "refunded"); return res.status(410).json({ valid: false, reason: "refunded" }); }
      logApiCall(req, 409, "not_available");
      return res.status(409).json({ valid: false, reason: "not_available" });
    }

    // Audit trail (best-effort — the redemption itself already committed).
    const { data: audit } = await vdb().from("redemptions").insert({
      code_id: won.id, startup_id: req.startup.id, customer_id: customerId,
      idempotency_key: idempotencyKey, ip_address: req.ip || null,
      user_agent: (req.headers["user-agent"] || "").slice(0, 500),
      api_key_id: req.apiKeyId,
    }).select("id").maybeSingle();
    logApiCall(req, 200, null);

    // Settle: the startup earns for this REDEEMED code now, net of the
    // platform fee. Idempotent per code, and never blocks the validate
    // response — a settlement hiccup must not make a legit redemption fail.
    vdb().from("codes").select("paid_price_usd").eq("id", won.id).maybeSingle()
      .then(({ data: c }) => {
        const paid = Number(c?.paid_price_usd || 0);
        if (paid > 0) return creditRedemption(req.startup.id, +(paid * (1 - PLATFORM_FEE_PCT / 100)).toFixed(2), won.id);
      })
      .catch((e) => console.error("[vouchers] settlement credit failed for code", won.id, e.message));

    // Notify the startup's own backend. Queued, not sent inline — a slow or
    // dead endpoint must never make a legitimate redemption hang or fail.
    enqueueWebhook(req.startup.id, "voucher.redeemed", {
      transaction_id: audit?.id || won.id,
      voucher_code: code,
      credits: won.credits,
      customer_id: customerId,
      redeemed_at: new Date().toISOString(),
    }).catch((e) => console.error("[vouchers] webhook enqueue failed for code", won.id, e.message));

    res.json({
      valid: true, credits: won.credits, currency: "USD",
      transaction_id: audit?.id || won.id,
    });
  } catch (e) {
    console.error("[vouchers/validate]", e.message);
    logApiCall(req, 500, "server_error");
    res.status(500).json({ valid: false, reason: "server_error" });
  }
});

// GET /api/vouchers/v1/redemptions — a startup's own redemption history (analytics).
router.get("/redemptions", requireApiKey, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
    const { data } = await vdb().from("redemptions")
      .select("id, code_id, customer_id, redeemed_at, codes(code, credits)")
      .eq("startup_id", req.startup.id).order("redeemed_at", { ascending: false }).limit(limit);
    res.json({ success: true, redemptions: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
