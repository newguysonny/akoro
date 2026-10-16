/**
 * modules/self-tooling/access.js — who has self-tooling.
 *   AKORO_SELF_TOOLING_ENABLED=true     the feature exists at all (default OFF — new risk surface)
 *   AKORO_SELF_TOOLING_LEARNERS=@a,b@x  optional allow-list (@username or email); empty = everyone
 */
import db from "../../db.js";

export const selfToolingEnabled = () => String(process.env.AKORO_SELF_TOOLING_ENABLED || "").toLowerCase() === "true";
const allowList = () => String(process.env.AKORO_SELF_TOOLING_LEARNERS || "").split(",").map((x) => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);

const cache = new Map();   // userId → { ok, at }
const TTL_MS = 60_000;

/** Is self-tooling on for this learner? (feature flag + allow-list) */
export async function selfToolingAllowedFor(userId) {
  if (!selfToolingEnabled() || !userId) return false;
  const list = allowList();
  if (!list.length) return true;
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;
  const { data } = await db.from("users").select("username, email").eq("id", userId).maybeSingle();
  const ok = !!data && (list.includes(String(data.username || "").toLowerCase()) || list.includes(String(data.email || "").toLowerCase()));
  cache.set(userId, { ok, at: Date.now() });
  return ok;
}
