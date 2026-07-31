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
import { requireApiKey } from "./apiKeyAuth.js";
import { vdb } from "./db.js";

const router = Router();

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
      if (!existing) return res.status(404).json({ valid: false, reason: "not_found" });
      if (existing.status === "used")     return res.status(409).json({ valid: false, reason: "already_used" });
      if (existing.status === "expired" || (existing.expires_at && new Date(existing.expires_at) < new Date()))
        return res.status(410).json({ valid: false, reason: "expired" });
      if (existing.status === "refunded") return res.status(410).json({ valid: false, reason: "refunded" });
      return res.status(409).json({ valid: false, reason: "not_available" });
    }

    // Audit trail (best-effort — the redemption itself already committed).
    const { data: audit } = await vdb().from("redemptions").insert({
      code_id: won.id, startup_id: req.startup.id, customer_id: customerId,
      idempotency_key: idempotencyKey, ip_address: req.ip || null,
      user_agent: (req.headers["user-agent"] || "").slice(0, 500),
    }).select("id").maybeSingle();

    res.json({
      valid: true, credits: won.credits, currency: "USD",
      transaction_id: audit?.id || won.id,
    });
  } catch (e) {
    console.error("[vouchers/validate]", e.message);
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
