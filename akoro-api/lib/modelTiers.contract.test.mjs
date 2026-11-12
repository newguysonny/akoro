// Grand Plan §7.11.5a (D26), Phase 11: the model picker's tier lists. Every
// tier defaults to gpt-4o-mini; what a learner may switch TO is the payer's
// tier list (tiers.allowed_models, the plan's starting list while unset); a
// school-funded session uses the school's list; a Pilot learner gets DeepSeek
// and nothing else. Scenario K's tier checks, over the in-memory fake db.
process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const { default: db } = await import("../db.js");
const { installFakeDb } = await import("./testing/fakeDb.mjs");
const T = await import("./modelTiers.js");
const { publicModelList, resolveChatChoice } = await import("./modelCatalogue.js");
const { validateTierInput, buildTierPatch } = await import("./tiersModel.js");

const ON = { OPENCODE_API_KEY: "k", OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k",
  AI_MODEL_DEFAULT: "deepseek", AI_MODEL_PICKER_ENABLED: "true" };

test("the plan's starting lists: the seven Go models, Grok only on Premium", () => {
  const all = Object.values(T.PLAN_TIER_MODELS);
  assert.ok(all.every((l) => l.includes("deepseek")));
  assert.ok(all.every((l) => !l.includes("claude-fable") && !l.includes("gpt-4o-mini") && !l.includes("gpt-4.1")), "legacy models are gone");
  assert.deepEqual([...T.PLAN_TIER_MODELS.pilot], ["deepseek"]);
  assert.deepEqual(Object.keys(T.PLAN_TIER_MODELS).filter((k) => T.PLAN_TIER_MODELS[k].includes("claude-opus")), [], "Opus is hidden until activated");
  assert.deepEqual(Object.keys(T.PLAN_TIER_MODELS).filter((k) => T.PLAN_TIER_MODELS[k].includes("grok")), ["premium"]);
  assert.ok(!T.PLAN_TIER_MODELS.pilot.includes("claude-haiku"));
  assert.ok(T.PLAN_TIER_MODELS.freemium.includes("gpt-6-luna"));
});

test("a tier row: the admin's list wins (even empty); unset uses the plan's list by name", () => {
  assert.deepEqual(T.allowedModelsOf({ name: "Premium", allowed_models: ["claude-haiku"] }), ["claude-haiku"]);
  assert.deepEqual(T.allowedModelsOf({ name: "Premium", allowed_models: [] }), [], "an admin may allow the default only");
  assert.deepEqual(T.allowedModelsOf({ name: "Trial", allowed_models: null }), ["claude-haiku", "deepseek"]);
  assert.deepEqual(T.allowedModelsOf({ name: "Gold (custom)" }), ["deepseek"], "a custom tier nobody set: the one model every tier has");
  assert.deepEqual(T.allowedModelsOf(null), [...T.PLAN_TIER_MODELS.freemium]);
});

test("admin input: a list of catalogue ids, or null to go back to the plan's list", () => {
  assert.deepEqual(T.validateAllowedModels(["claude-haiku", "claude-haiku", " deepseek "]), { value: ["claude-haiku", "deepseek"] });
  assert.deepEqual(T.validateAllowedModels(null), { value: null });
  assert.match(T.validateAllowedModels("claude-haiku").error, /list/);
  assert.match(T.validateAllowedModels(["Claude Opus!"]).error, /lower-case/);
  const { errors, values } = validateTierInput({ platform: "learner", name: "Gold", access: "free", cap: 10, allowed_models: ["claude-sonnet"] });
  assert.deepEqual(errors, {});
  assert.deepEqual(values.allowed_models, ["claude-sonnet"]);
  assert.ok(!("allowed_models" in validateTierInput({ platform: "learner", name: "Gold", access: "free", cap: 10 }).values), "left out → the plan's list");
  const cur = { name: "Gold", allowed_models: ["claude-sonnet"], price_monthly: 0, price_annual: 0 };
  assert.deepEqual(buildTierPatch(cur, { allowed_models: ["claude-sonnet"] }).patch, {}, "no change, no patch");
  assert.deepEqual(buildTierPatch(cur, { allowed_models: ["claude-sonnet", "grok"] }).patch, { allowed_models: ["claude-sonnet", "grok"] });
  assert.equal(buildTierPatch(cur, { allowed_models: "x" }).error.code, "invalid_tier_fields");
});

const TIERS = [
  { id: "t-trial", platform: "learner", name: "Trial", allowed_models: null },
  { id: "t-free", platform: "learner", name: "Freemium", allowed_models: null },
  { id: "t-prem", platform: "learner", name: "Premium", allowed_models: null },
  { id: "s-pilot", platform: "school", name: "Pilot", allowed_models: null },
  { id: "s-prem", platform: "school", name: "Premium", allowed_models: ["claude-sonnet", "deepseek"] },
];
function seed() {
  return {
    tiers: TIERS.map((t) => ({ ...t })),
    subscriptions: [
      { learner_user_id: "premium-kid", tier_id: "t-prem", status: "active", updated_at: "2026-11-01T00:00:00Z" },
      { learner_user_id: "lapsed-kid", tier_id: "t-prem", status: "canceled", updated_at: "2026-11-01T00:00:00Z" },
      { learner_user_id: "trial-kid", tier_id: "t-trial", status: "trial", updated_at: "2026-11-01T00:00:00Z" },
    ],
    school_profiles: [{ id: "pilot-school", plan_tier: "pilot" }, { id: "rich-school", plan_tier: "premium" }],
  };
}
const schools = { "pilot-kid": "pilot-school", "lapsed-kid": null };

test("whose tier: subscription, then the school (pilot learners have no record), then Freemium", async (t) => {
  const fake = installFakeDb(db, seed());
  t.after(() => fake.restore());
  const r = T.makeTierResolver({ db, schoolIdForUser: async (id) => schools[id] || null });
  const premium = await r.forUser("premium-kid");
  assert.equal(premium.tier.name, "Premium"); assert.equal(premium.source, "subscription");
  assert.ok(premium.allowedModels.includes("grok"));
  const pilot = await r.forUser("pilot-kid");
  assert.deepEqual({ tier: pilot.tier.name, platform: pilot.tier.platform, source: pilot.source, models: pilot.allowedModels },
    { tier: "Pilot", platform: "school", source: "school", models: ["deepseek"] });
  const lapsed = await r.forUser("lapsed-kid");
  assert.deepEqual({ tier: lapsed.tier.name, source: lapsed.source }, { tier: "Freemium", source: "default" }, "a cancelled subscription is no tier");
  assert.deepEqual((await r.forUser("trial-kid")).allowedModels, ["claude-haiku", "deepseek"]);
  // School-funded: the school's list applies, not the learner's own (§7.11.5a).
  const funded = await r.forUser("premium-kid", { billTo: { ownerType: "school", ownerId: "rich-school" } });
  assert.deepEqual({ source: funded.source, models: funded.allowedModels }, { source: "school", models: ["claude-sonnet", "deepseek"] });
});

test("cached for a minute; a failed read never blocks the message", async (t) => {
  const fake = installFakeDb(db, seed());
  t.after(() => fake.restore());
  let clock = 0;
  const r = T.makeTierResolver({ db, now: () => clock });
  await r.forUser("premium-kid");
  fake.rows("tiers").find((x) => x.id === "t-prem").allowed_models = ["claude-haiku"];
  assert.ok((await r.forUser("premium-kid")).allowedModels.includes("grok"), "still cached");
  clock += 61_000;
  assert.deepEqual((await r.forUser("premium-kid")).allowedModels, ["claude-haiku"], "an admin edit applies within a minute");
  r.clear();
  fake.failNext("subscriptions", "select", { message: "down" });
  const fallback = await r.forUser("someone");
  assert.equal(fallback.source, "fallback");
  assert.deepEqual(fallback.allowedModels, [...T.PLAN_TIER_MODELS.freemium]);
});

test("Scenario K: a Pilot learner can switch to DeepSeek and to nothing else; outside the tier is refused with a notice", () => {
  const pilot = [...T.PLAN_TIER_MODELS.pilot];
  const usable = publicModelList(ON, { allowedModels: pilot }).filter((m) => m.available).map((m) => m.id);
  assert.deepEqual(usable.sort(), ["deepseek"]);
  assert.equal(resolveChatChoice("deepseek", ON, { allowedModels: pilot }).apiModel, "deepseek-v4.1-flash");
  const refused = resolveChatChoice("claude-haiku", ON, { allowedModels: pilot });
  assert.equal(refused.apiModel, null);
  assert.match(refused.notice, /^Using DeepSeek: that model isn't in your plan\.$/);
  // A downgrade: a Premium pick no longer in the list falls back to the default with a notice.
  assert.match(resolveChatChoice("grok", ON, { allowedModels: [...T.PLAN_TIER_MODELS.freemium] }).notice, /isn't in your plan/);
});

test("the chat reads the payer's tier list only with the picker on, and reports the notice", () => {
  const chat = readFileSync(new URL("../modules/adaptive-learning/chat.js", import.meta.url), "utf8");
  assert.match(chat, /picked && pickerEnabled\(\) \? await allowedModelsFor\(req\.user\.id\)/);
  assert.match(chat, /if \(modelNotice && wantsStream\) status\("model", modelNotice\);/);
  assert.match(chat, /\.\.\.\(modelNotice \? \{ modelNotice \} : \{\}\),/);
  const manifest = JSON.parse(readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.schema.includes("2026-tier-allowed-models.sql"));
  const sql = readFileSync(new URL("../migrations/2026-tier-allowed-models.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS allowed_models text\[\]/);
  assert.ok((sql.match(/WHERE allowed_models IS NULL/g) || []).length === 4, "the seed never overwrites an admin's list");
});
