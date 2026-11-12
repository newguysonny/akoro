import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { modelCatalogue, modelAvailability, publicModel, publicModelList, resolveChatModel, SUPPORTED_PROVIDERS } from "./modelCatalogue.js";
import { PLAN_TIER_MODELS } from "./modelTiers.js";

const chat = await readFile(new URL("../modules/adaptive-learning/chat.js", import.meta.url), "utf8");

test("the final Go catalogue: seven public models, DeepSeek the default", () => {
  const list = modelCatalogue({});
  assert.deepEqual(list.map((m) => m.id), ["deepseek", "glm-5-3-flash", "qwen3-8-flash", "claude-haiku", "gpt-6-luna", "gpt-5-6-luna", "grok"]);
  assert.equal(list.find((m) => m.default).id, "deepseek");
});

test("available only when configured AND callable here; everything else is coming soon", () => {
  const env = { OPENCODE_API_KEY: "k" };
  const list = publicModelList(env);
  const by = Object.fromEntries(list.map((m) => [m.id, m]));
  assert.equal(by.deepseek.available, true);
  assert.equal(by["gpt-6-luna"].available, true);
  assert.equal(by.grok.available, true);
  const noKey = publicModelList({});
  assert.ok(noKey.every((m) => m.available === false));
  assert.match(noKey.find((m) => m.id === "claude-haiku").note, /Coming soon/);
  assert.ok(list.every((m) => !("provider" in m) && !("apiModel" in m) && !("envModel" in m) && !("baseURL" in m) && !("apiKeyEnv" in m)));
  for (const provider of ["anthropic", "openai", "openai_compatible", "opencode"]) assert.ok(SUPPORTED_PROVIDERS.includes(provider));
});

test("AI_MODELS adds, overrides and switches off entries; bad JSON or a missing price fails boot", () => {
  const env = { OPENAI_API_KEY: "k", OPENCODE_API_KEY: "k", AI_MODELS: JSON.stringify([
    { id: "gpt-4.1", enabled: false },
    { id: "gpt-4.1-mini", provider: "openai", apiModel: "gpt-4.1-mini", label: "GPT-4.1 mini", enabled: true, price: { in: 0.4, out: 1.6 }, selectable: true },
    { id: "grok", price: { in: 3, out: 15 } },
    { id: "deepseek", selectable: false },
  ]) };
  const list = publicModelList(env);
  assert.ok(!list.some((m) => m.id === "gpt-4.1"));
  assert.equal(list.find((m) => m.id === "gpt-4.1-mini").available, true);
  assert.ok(!list.some((m) => m.id === "deepseek"));
  assert.equal(list.find((m) => m.id === "grok").available, true);
  assert.throws(() => modelCatalogue({ AI_MODELS: "{nope" }), /valid JSON/);
  assert.throws(() => modelCatalogue({ AI_MODELS: JSON.stringify([{ id: "x", provider: "openai", apiModel: "x" }]) }), /price/);
  assert.equal(modelAvailability({ provider: "openai", apiModel: "x", enabled: false }, env).available, false);
});

test("a learner's pick resolves to an API model only when available", () => {
  const env = { OPENCODE_API_KEY: "k" };
  assert.equal(resolveChatModel("gpt-6-luna", env), "gpt-6-luna");
  assert.equal(resolveChatModel("claude-haiku", env), "claude-haiku-5-5");
  assert.equal(resolveChatModel("claude-haiku", { OPENCODE_API_KEY: "" }), null);   // no key → keep the default
  assert.equal(resolveChatModel("gpt-4o", env), null);                              // hidden legacy row
  assert.equal(resolveChatModel("gpt-5-ultra-free", env), null);
  assert.equal(resolveChatModel({ id: "x" }, env), null);
});

test("the chat: the pick drives the standard mode only, and /models lists the catalogue", () => {
  assert.match(chat, /const picked = mode === "default" && typeof req\.body\?\.model === "string"/);
  assert.match(chat, /resolveChatChoice\(picked, process\.env, \{ allowedModels: tierModels\?\.allowedModels \?\? null \}\)/);
  assert.match(chat, /model: chatModel,/);
  assert.match(chat, /model: model \|\| OPENAI_MODEL,/);
  assert.match(chat, /models: publicModelList\(process\.env, \{ allowedModels: tier\?\.allowedModels \?\? null \}\),/);
  assert.match(chat, /picker: \{ \.\.\.pickerInfo\(\),/);
});

test("the catalogue exposes public fields only", () => {
  const list = modelCatalogue({});
  assert.ok(list.length > 0);
  for (const m of list) {
    assert.deepEqual(Object.keys(m).sort(), [
      "caps", "default", "description", "enabled", "id", "label", "price", "selectable", "tier",
    ].sort());
    for (const key of ["provider", "apiModel", "baseURL", "apiKeyEnv", "flags"]) assert.ok(!(key in m), `${m.id}: ${key}`);
  }
});

test("publicModel maps a registry entry and drops internals", () => {
  const entry = {
    id: "deepseek", label: "DeepSeek", description: "DeepSeek", tier: "freemium",
    provider: "opencode", apiModel: "deepseek-v4.1-flash", baseURL: "https://opencode.ai/inference/go",
    apiKeyEnv: "OPENCODE_API_KEY", family: "chat", lane: "go", fallbackModel: "deepseek",
    price: { in: 0.30, out: 1.20, cachedIn: 0.006 }, caps: { tools: true, stream: true, json: true },
    selectable: true, enabled: true,
  };
  assert.deepEqual(publicModel(entry), {
    id: "deepseek", label: "DeepSeek", description: "DeepSeek", tier: "freemium",
    price: { in: 0.30, out: 1.20, cachedIn: 0.006 }, caps: { tools: true, stream: true, json: true },
    selectable: true, enabled: true,
  });
  assert.equal(publicModel({ ...entry, enabled: false }).enabled, false);
});

test("AI_MODEL_DEFAULT=deepseek marks only DeepSeek as the default", () => {
  const list = modelCatalogue({ AI_MODEL_DEFAULT: "deepseek", OPENCODE_API_KEY: "k" });
  assert.equal(list.filter((m) => m.default).map((m) => m.id).join(","), "deepseek");
});

test("plan tier lists carry only the final catalogue ids", () => {
  assert.deepEqual([...PLAN_TIER_MODELS.pilot], ["deepseek"]);
  assert.deepEqual([...PLAN_TIER_MODELS.trial], ["claude-haiku", "deepseek"]);
  assert.deepEqual([...PLAN_TIER_MODELS.freemium], ["glm-5-3-flash", "qwen3-8-flash", "gpt-6-luna", "gpt-5-6-luna", "deepseek", "claude-haiku"]);
  assert.deepEqual([...PLAN_TIER_MODELS.premium], [...PLAN_TIER_MODELS.freemium, "grok"]);
  const all = Object.values(PLAN_TIER_MODELS).flat();
  assert.ok(all.every((id) => !/^(gpt-4o|gpt-4\.1)$/.test(id)));
});
