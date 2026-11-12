/**
 * lib/modelTiers.js — which models a learner's plan tier may switch to in the
 * chat's model picker (Grand Plan §7.11.5a, D26; Phase 11).
 *
 * Every tier defaults to gpt-4o-mini. What a learner may switch TO is the
 * payer's tier list, `public.tiers.allowed_models` (admin-editable, same
 * pattern as gated_features). NULL there means "never set": the plan's
 * starting list for that tier name applies (PLAN_TIER_MODELS). The list only
 * controls access; coins are still charged at the chosen model's price.
 *
 * Whose tier (the payer's):
 *   1. a school-funded call (billTo = the school)  → the school's tier
 *   2. the learner's own subscription (active, trial, past_due) → its tier
 *   3. no subscription, but a school learner (pilot learners have no record)
 *                                                  → the school's tier
 *   4. neither                                     → the learner Freemium tier
 * A school's tier is school_profiles.plan_tier (pilot | freemium | premium)
 * matched by name to a school-platform row of public.tiers.
 *
 *   allowedModelsOf(tierRow)                PURE → string[]
 *   makeTierResolver({ db, schoolIdForUser, now }) → { forUser(userId, { billTo }), clear() }
 *   allowedModelsFor(userId, { billTo })    the app's resolver (lazy db)
 *     → { tier: { id, name, platform } | null, allowedModels: string[], source }
 *
 * Reads are cached for a minute (tiers table and per payer), so the chat's
 * hot path costs no query most of the time. A failed read never blocks a
 * message: the plan's list for the tier name, else Freemium's, applies.
 */

/** The plan's starting lists (confirmed 2026-10-09). DeepSeek on every tier; Fable on none. */
export const PLAN_TIER_MODELS = Object.freeze({
  pilot: Object.freeze(["deepseek"]),
  trial: Object.freeze(["claude-haiku", "deepseek"]),
  freemium: Object.freeze(["glm-5-3-flash", "qwen3-8-flash", "gpt-6-luna", "gpt-5-6-luna", "deepseek", "claude-haiku"]),
  premium: Object.freeze(["glm-5-3-flash", "qwen3-8-flash", "gpt-6-luna", "gpt-5-6-luna", "deepseek", "claude-haiku", "grok"]),
});
/** A custom tier nobody has set a list for: the one model every tier has. */
const UNKNOWN_TIER_MODELS = Object.freeze(["deepseek"]);
const LIVE_SUBSCRIPTION = ["active", "trial", "past_due"];
const TTL_MS = 60_000;
const MAX_CACHED = 5000;
const lower = (s) => String(s || "").trim().toLowerCase();

/** The models a tier row allows (beyond the default). */
export function allowedModelsOf(tier) {
  if (!tier) return [...PLAN_TIER_MODELS.freemium];
  if (Array.isArray(tier.allowed_models)) return [...new Set(tier.allowed_models.map(String).filter(Boolean))];
  return [...(PLAN_TIER_MODELS[lower(tier.name)] || UNKNOWN_TIER_MODELS)];
}

/** Admin input for allowed_models → { value } | { error }. Catalogue ids: short, lower-case. */
export function validateAllowedModels(list) {
  if (list === null) return { value: null };
  if (!Array.isArray(list)) return { error: "allowed_models must be a list of model ids" };
  const ids = list.map((x) => String(x ?? "").trim());
  if (ids.some((id) => !/^[a-z0-9][a-z0-9._-]{0,59}$/.test(id))) return { error: "Model ids are 1-60 lower-case letters, digits, dots, dashes or underscores" };
  return { value: [...new Set(ids)] };
}

const view = (row) => (row ? { id: row.id || null, name: row.name, platform: row.platform || null } : null);

export function makeTierResolver({ db, schoolIdForUser = null, now = () => Date.now() }) {
  let tiersCache = null;
  const payerCache = new Map();

  async function tiers() {
    if (tiersCache && now() - tiersCache.at < TTL_MS) return tiersCache.rows;
    const { data, error } = await db.from("tiers").select("*");
    if (error) throw new Error(`tiers: ${error.message}`);
    tiersCache = { rows: data || [], at: now() };
    return tiersCache.rows;
  }
  const byName = (rows, platform, name) => rows.find((t) => t.platform === platform && lower(t.name) === lower(name)) || null;

  async function schoolTier(schoolId) {
    const { data } = await db.from("school_profiles").select("id, plan_tier").eq("id", schoolId).maybeSingle();
    const name = data?.plan_tier || "pilot";
    return byName(await tiers(), "school", name) || { name, platform: "school", allowed_models: null };
  }

  async function resolve(userId, billTo) {
    if (billTo?.ownerType === "school" && billTo.ownerId) return { tier: await schoolTier(billTo.ownerId), source: "school" };
    const { data: subs, error } = await db.from("subscriptions").select("tier_id, status, updated_at")
      .eq("learner_user_id", userId).in("status", LIVE_SUBSCRIPTION).order("updated_at", { ascending: false }).limit(1);
    if (error) throw new Error(`subscriptions: ${error.message}`);
    const sub = subs?.[0];
    if (sub?.tier_id) {
      const row = (await tiers()).find((t) => t.id === sub.tier_id);
      if (row) return { tier: row, source: "subscription" };
    }
    const schoolId = schoolIdForUser ? await schoolIdForUser(userId).catch(() => null) : null;
    if (schoolId) return { tier: await schoolTier(schoolId), source: "school" };
    return { tier: byName(await tiers(), "learner", "freemium") || { name: "Freemium", platform: "learner", allowed_models: null }, source: "default" };
  }

  async function forUser(userId, { billTo = null } = {}) {
    const key = `${userId}|${billTo?.ownerType || ""}:${billTo?.ownerId || ""}`;
    const hit = payerCache.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit.value;
    let value;
    try {
      const { tier, source } = await resolve(userId, billTo);
      value = { tier: view(tier), allowedModels: allowedModelsOf(tier), source };
    } catch (e) {
      // Never block a message on this read: the learner standing tier's list.
      console.warn("[model tiers] lookup failed:", e?.message || e);
      return { tier: null, allowedModels: allowedModelsOf(null), source: "fallback" };
    }
    if (payerCache.size >= MAX_CACHED) payerCache.delete(payerCache.keys().next().value);
    payerCache.set(key, { value, at: now() });
    return value;
  }

  return { forUser, clear: () => { tiersCache = null; payerCache.clear(); } };
}

let _resolver = null;
/** The app's resolver: the real db and roster lookup, loaded on first use. */
export async function allowedModelsFor(userId, opts = {}) {
  if (!_resolver) {
    const [{ default: db }, { schoolIdForUser }] = await Promise.all([import("../db.js"), import("./coins.js")]);
    _resolver = makeTierResolver({ db, schoolIdForUser });
  }
  return _resolver.forUser(userId, opts);
}
