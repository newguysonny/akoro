/**
 * lib/pricing.js — bulk-discount pricing for a startup's credits.
 */
import { vdb } from "../db.js";

/** Best (largest) applicable discount tier for a given quantity. */
export async function priceForQuantity(startup, quantity) {
  const { data: tiers } = await vdb().from("discount_tiers")
    .select("min_credits, discount_pct").eq("startup_id", startup.id)
    .lte("min_credits", quantity).order("min_credits", { ascending: false }).limit(1);
  const discountPct = tiers?.[0]?.discount_pct ? Number(tiers[0].discount_pct) : 0;
  const baseRate = Number(startup.credit_rate_usd);
  const unitPriceUsd = +(baseRate * (1 - discountPct / 100)).toFixed(6);
  return { unitPriceUsd, discountPct, baseRate };
}
