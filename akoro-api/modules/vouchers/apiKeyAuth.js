/**
 * apiKeyAuth.js — authenticates a THIRD-PARTY STARTUP calling the validate
 * API. Deliberately NOT Akoro's JWT/cookie auth (authenticateToken) — a
 * startup's backend is a server-to-server caller with its own long-lived
 * secret key, not an Akoro portal session. Keeping this separate is part of
 * the decoupling boundary: if this module ships standalone, its auth model
 * ships with it unchanged.
 */
import { createHash } from "crypto";
import { vdb } from "./db.js";

export function hashKey(rawKey) {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * requireApiKey — Express middleware. Reads `Authorization: Bearer sk_...`
 * (preferred) or `x-api-key` header, or `api_key` in the body (compat with
 * the flow doc). Attaches req.startup on success.
 */
export async function requireApiKey(req, res, next) {
  try {
    const auth = req.headers["authorization"] || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    const raw = bearer || req.headers["x-api-key"] || req.body?.api_key;
    if (!raw || typeof raw !== "string") {
      return res.status(401).json({ valid: false, reason: "missing_api_key" });
    }
    const hash = hashKey(raw);
    const { data: key } = await vdb().from("api_keys")
      .select("id, startup_id, status").eq("key_hash", hash).maybeSingle();
    if (!key || key.status !== "active") {
      return res.status(401).json({ valid: false, reason: "invalid_api_key" });
    }
    const { data: startup } = await vdb().from("startups")
      .select("id, name, slug, credit_rate_usd, status").eq("id", key.startup_id).maybeSingle();
    if (!startup || startup.status !== "active") {
      return res.status(403).json({ valid: false, reason: "startup_inactive" });
    }
    req.startup = startup;
    req.apiKeyId = key.id;
    vdb().from("api_keys").update({ last_used_at: new Date().toISOString() })
      .eq("id", key.id).then(() => {}, () => {});   // best-effort, non-blocking
    next();
  } catch (e) {
    res.status(500).json({ valid: false, reason: "server_error" });
  }
}
