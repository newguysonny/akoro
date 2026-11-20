/**
 * startupsStore.js — the reads the startup routes share: the ownership guard,
 * the API-key list with its usage, and the analytics summary.
 */
import db, { vdb } from "./db.js";

// Ownership guard — only the startup's owner may manage it.
export async function ownedStartup(req, res) {
  const { data } = await vdb().from("startups").select("*").eq("id", req.params.id).maybeSingle();
  if (!data) { res.status(404).json({ error: "Startup not found" }); return null; }
  if (data.owner_user_id !== req.user.id) { res.status(403).json({ error: "Not your startup" }); return null; }
  return data;
}

/**
 * The API-key list, enriched with created-by, tracking id, permissions
 * (static — no scopes yet) and this-calendar-month spend, mirroring a typical
 * "API keys" table.
 */
export async function listedApiKeys(startupId) {
  const { data: keys } = await vdb().from("api_keys")
    .select("id, key_prefix, label, status, created_at, last_used_at, created_by_user_id")
    .eq("startup_id", startupId).order("created_at", { ascending: false });

  const creatorIds = [...new Set((keys || []).map((k) => k.created_by_user_id).filter(Boolean))];
  const creators = {};
  if (creatorIds.length) {
    const { data: users } = await db.from("users").select("id, full_name, email").in("id", creatorIds);
    (users || []).forEach((u) => { creators[u.id] = u.full_name || u.email; });
  }

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const { data: monthRedemptions } = await vdb().from("redemptions")
    .select("api_key_id, codes(paid_price_usd)")
    .eq("startup_id", startupId).gte("redeemed_at", monthStart.toISOString());
  const spendByKey = {};
  (monthRedemptions || []).forEach((r) => {
    if (!r.api_key_id) return;
    spendByKey[r.api_key_id] = (spendByKey[r.api_key_id] || 0) + Number(r.codes?.paid_price_usd || 0);
  });

  return (keys || []).map((k) => ({
    ...k,
    name: k.label || "Untitled key",
    tracking_id: `key_${k.id.replace(/-/g, "").slice(0, 12)}`,
    created_by: creators[k.created_by_user_id] || "—",
    permissions: "All",
    monthly_spend_usd: +(spendByKey[k.id] || 0).toFixed(2),
  }));
}

/** GET /:id/analytics — quick summary. */
export async function startupAnalytics(startupId) {
  const [{ count: totalCodes }, { count: usedCodes }, { count: activeKeys }, { data: batches }] = await Promise.all([
    vdb().from("codes").select("id", { count: "exact", head: true }).eq("startup_id", startupId),
    vdb().from("codes").select("id", { count: "exact", head: true }).eq("startup_id", startupId).eq("status", "used"),
    vdb().from("api_keys").select("id", { count: "exact", head: true }).eq("startup_id", startupId).eq("status", "active"),
    vdb().from("batches").select("total_cost_usd, quantity, unit_credits").eq("startup_id", startupId).eq("status", "paid"),
  ]);
  const grossSalesUsd = (batches || []).reduce((s, b) => s + Number(b.total_cost_usd || 0), 0);
  const creditsSold = (batches || []).reduce((s, b) => s + Number(b.quantity || 0) * Number(b.unit_credits || 0), 0);
  return { totalCodes: totalCodes || 0, usedCodes: usedCodes || 0, activeApiKeys: activeKeys || 0, grossSalesUsd, creditsSold };
}
