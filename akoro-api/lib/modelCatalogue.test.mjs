import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { modelCatalogue, modelAvailability, publicModelList, resolveChatModel, SUPPORTED_PROVIDERS } from "./modelCatalogue.js";

const chat = await readFile(new URL("../modules/adaptive-learning/chat.js", import.meta.url), "utf8");

test("the plan's catalogue: GPT, Claude Haiku/Sonnet/Opus/Fable, Grok, DeepSeek — default gpt-4o-mini", () => {
  const ids = modelCatalogue({}).map((m) => m.id);
  assert.deepEqual(ids, ["gpt-4o-mini", "gpt-4.1", "claude-haiku", "claude-sonnet", "claude-opus", "claude-fable", "grok", "deepseek"]);
  assert.equal(modelCatalogue({}).find((m) => m.default).id, "gpt-4o-mini");
});

test("available only when configured AND callable here; everything else is coming soon", () => {
  const env = { OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k", XAI_API_KEY: "k", XAI_MODEL: "grok-x" };
  const list = publicModelList(env);
  const by = Object.fromEntries(list.map((m) => [m.id, m]));
  assert.equal(by["gpt-4.1"].available, true);
  assert.equal(by["claude-sonnet"].available, false);          // key set, but no Anthropic adapter yet
  assert.match(by["claude-sonnet"].note, /Coming soon/);
  assert.equal(by.grok.available, false);
  assert.equal(by.deepseek.available, false);
  assert.equal(publicModelList({}).find((m) => m.id === "gpt-4.1").available, false);   // no OpenAI key → not offered
  assert.ok(list.every((m) => !("apiModel" in m) && !("envModel" in m)));                // no internals to the browser
  assert.deepEqual(SUPPORTED_PROVIDERS, ["openai"]);
});

test("AI_MODELS adds, overrides and switches off entries; bad JSON keeps the built-ins", () => {
  const env = { OPENAI_API_KEY: "k", AI_MODELS: JSON.stringify([
    { id: "gpt-4.1", enabled: false },
    { id: "gpt-4.1-mini", provider: "openai", apiModel: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { id: "deepseek", selectable: false },
  ]) };
  const list = publicModelList(env);
  assert.equal(list.find((m) => m.id === "gpt-4.1").available, false);
  assert.equal(list.find((m) => m.id === "gpt-4.1-mini").available, true);
  assert.ok(!list.some((m) => m.id === "deepseek"));
  assert.equal(modelCatalogue({ AI_MODELS: "{nope" }).length, 8);
  assert.equal(modelAvailability({ provider: "openai", apiModel: "x", enabled: false }, env).available, false);
});

test("a learner's pick resolves to an API model only when available", () => {
  const env = { OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k" };
  assert.equal(resolveChatModel("gpt-4.1", env), "gpt-4.1");
  assert.equal(resolveChatModel("claude-opus", env), null);
  assert.equal(resolveChatModel("gpt-5-ultra-free", env), null);
  assert.equal(resolveChatModel({ id: "x" }, env), null);
});

test("the chat: the pick drives the standard mode only, and /models lists the catalogue", () => {
  assert.match(chat, /const chatModel = mode === "default" \? resolveChatModel\(req\.body\?\.model\) : null;/);
  assert.match(chat, /model: chatModel,/);
  assert.match(chat, /model: model \|\| OPENAI_MODEL,/);
  assert.match(chat, /res\.json\(\{ modes: chatModelMenu\(\), models: publicModelList\(\) \}\);/);
});
