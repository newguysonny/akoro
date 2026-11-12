import assert from "node:assert/strict";
import test from "node:test";
import { aiContext } from "../aiContext.js";
import { availabilityOf, checkEntry, createModelRegistry, openCodeBaseURL } from "../modelRegistry.js";
import { attachOpenCodeMeta, makeOpenCodeAdapter, openCodeMeta } from "./opencode.js";

const GO_IDS = ["deepseek", "glm-5-3-flash", "qwen3-8-flash", "claude-haiku", "gpt-6-luna", "gpt-5-6-luna", "grok"];
const LEGACY_IDS = ["gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "claude-sonnet", "claude-opus", "claude-fable"];
const VISION_IDS = ["qwen3-8-flash", "claude-haiku", "gpt-6-luna", "gpt-5-6-luna"];
const env = { OPENCODE_API_KEY: "oc-key" };
const deepseek = checkEntry({
  id: "deepseek", provider: "opencode", lane: "go", family: "chat", apiModel: "deepseek-v4.1-flash",
  price: { in: 0.30, out: 1.20, cachedIn: 0.006 },
  caps: { tools: true, stream: true, json: true, vision: false },
}, { env });

// ── registry ────────────────────────────────────────────────────────────────

test("the seven Go models are enabled, priced and on the Go lane", () => {
  const reg = createModelRegistry(env);
  for (const id of GO_IDS) {
    const e = reg.get(id);
    assert.ok(e, `${id} exists`);
    assert.equal(e.provider, "opencode", `${id} provider`);
    assert.equal(e.lane, "go", `${id} lane`);
    assert.equal(e.family, "chat", `${id} family`);
    assert.equal(e.enabled, true, `${id} enabled`);
    assert.equal(e.selectable, true, `${id} selectable`);
    assert.ok(e.apiModel, `${id} has a vendor apiModel`);
    assert.ok(e.price && e.price.in >= 0 && e.price.out >= 0, `${id} is priced`);
    assert.equal(e.caps.tools, true);
    assert.equal(e.caps.stream, true);
    assert.equal(e.caps.json, true);
    assert.equal(e.caps.vision, VISION_IDS.includes(id), `${id} vision`);
    assert.equal(e.apiKeyEnv, "OPENCODE_API_KEY");
    assert.equal(e.baseURL, "https://opencode.ai/inference/go");
  }
  assert.deepEqual(
    GO_IDS.map((id) => reg.get(id).fallbackModel).filter((id) => id !== null),
    ["deepseek", "deepseek", "deepseek", "deepseek", "deepseek", "deepseek"],
  );
  assert.equal(reg.get("deepseek").fallbackModel, null, "DeepSeek is the global fallback");
});

test("legacy OpenAI and Claude rows stay resolvable but are switched off", () => {
  const reg = createModelRegistry(env);
  for (const id of LEGACY_IDS) {
    const e = reg.get(id);
    assert.ok(e, `${id} still resolves`);
    assert.equal(e.enabled, false, `${id} disabled`);
    assert.equal(e.selectable, false, `${id} not selectable`);
  }
});

test("availability needs OPENCODE_API_KEY; enabled, priced and with an apiModel", () => {
  const reg = createModelRegistry(env);
  for (const id of GO_IDS) {
    assert.equal(availabilityOf(reg.get(id), {}).available, false, `${id} without a key`);
    assert.equal(availabilityOf(reg.get(id), env).available, true, `${id} with a key`);
  }
});

test("opencode entries need a real apiModel and derive the lane base URL", () => {
  assert.throws(() => checkEntry({ id: "x", provider: "opencode", price: { in: 1, out: 1 } }), /apiModel/);
  assert.throws(() => checkEntry({ id: "x", provider: "opencode", apiModel: "x", lane: "mars", price: { in: 1, out: 1 } }), /lane/);
  assert.throws(() => checkEntry({ id: "x", provider: "opencode", apiModel: "x", family: "gemini", price: { in: 1, out: 1 } }), /family/);
  const go = checkEntry({ id: "x", provider: "opencode", apiModel: "vendor-x", price: { in: 1, out: 1 } }, { env: {} });
  assert.equal(go.lane, "go", "default lane");
  assert.equal(go.family, "chat", "default family");
  assert.equal(go.baseURL, "https://opencode.ai/inference/go");
  const consoleLane = checkEntry({ id: "x", provider: "opencode", apiModel: "vendor-x", lane: "console", family: "messages", price: { in: 1, out: 1 } }, { env: { OPENCODE_BASE_URL: "https://oc.test/inference/" } });
  assert.equal(consoleLane.baseURL, "https://oc.test/inference/console");
  assert.equal(openCodeBaseURL("go", { OPENCODE_BASE_URL: "https://oc.test/inference/go" }), "https://oc.test/inference/go");
});

test("the default is DeepSeek from env, and legacy gpt-4o-mini falls back to it", () => {
  assert.equal(createModelRegistry(env).defaultId, "deepseek", "disabled gpt-4o-mini is not defaultable");
  const reg = createModelRegistry({ ...env, AI_MODEL_DEFAULT: "deepseek" });
  assert.equal(reg.defaultId, "deepseek");
  assert.equal(reg.resolveModel({ role: "chat" }).id, "deepseek");
  assert.equal(reg.resolveModel({ role: "chat" }).provider, "opencode");
  assert.equal(createModelRegistry({ ...env, OPENAI_MODEL: "gpt-4.1" }).defaultId, "deepseek", "a disabled legacy default falls back");
});

// ── adapter ─────────────────────────────────────────────────────────────────

const adapterEnv = { ...env, OPENCODE_BASE_URL: "https://oc.test/inference", OPENCODE_USER_AGENT: "akoro-test/2" };
const completion = {
  id: "r1", object: "chat.completion", model: "deepseek-v4.1-flash",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0012, opencode: { billing_source: "go", list_cost: 0.0015, allowance: 99.5 } },
};

function fakeClient(onCreate) {
  return { chat: { completions: { create: onCreate } } };
}

test("the adapter calls OpenAI chat completions at /<lane>/openai/v1 with Go headers", async () => {
  const seen = [];
  let captured = null;
  const adapter = makeOpenCodeAdapter({
    env: adapterEnv,
    clientFor: (entry, config) => { captured = { entry, config }; return fakeClient(async (params, opts) => { seen.push({ params, opts }); return completion; }); },
  });
  const res = await aiContext.run({ sessionId: "sess-42" }, () => adapter.create({ model: deepseek.apiModel, messages: [{ role: "user", content: "hi" }] }, undefined, deepseek));

  assert.equal(captured.config.baseURL, "https://oc.test/inference/go/openai/v1");
  assert.equal(captured.config.apiKey, "oc-key");
  assert.equal(captured.entry.baseURL, "https://oc.test/inference/go/openai/v1");
  assert.equal(seen[0].params.model, "deepseek-v4.1-flash");
  assert.equal(seen[0].opts.headers["User-Agent"], "akoro-test/2");
  assert.equal(seen[0].opts.headers["x-opencode-session"], "sess-42");
  assert.equal(res.choices[0].message.content, "ok");
  assert.deepEqual(res.__opencode, { costUsd: 0.0012, billingSource: "go", listCostUsd: 0.0015, allowanceUsd: 99.5 });
  assert.ok(res.usage.cost, "usage is never stripped");
  assert.ok(!Object.keys(res).includes("__opencode"), "metadata stays out of serialisation");
});

test("the session header falls back to the request id, then a stable default", async () => {
  const headers = [];
  const adapter = makeOpenCodeAdapter({
    env: adapterEnv,
    clientFor: () => fakeClient(async (params, opts) => { headers.push({ ...opts.headers }); return completion; }),
  });
  await aiContext.run({ requestId: "req-7" }, () => adapter.create({ model: deepseek.apiModel, messages: [] }, undefined, deepseek));
  await adapter.create({ model: deepseek.apiModel, messages: [] }, undefined, deepseek);
  assert.equal(headers[0]["x-opencode-session"], "req-7");
  assert.equal(headers[1]["x-opencode-session"], "akoro-api");
  assert.equal(headers[0]["User-Agent"], "akoro-test/2", "user agent comes from OPENCODE_USER_AGENT");
  const plain = makeOpenCodeAdapter({ env: { OPENCODE_API_KEY: "k" }, clientFor: () => fakeClient(async (p, o) => { headers.push({ ...o.headers }); return completion; }) });
  await plain.create({ model: deepseek.apiModel, messages: [] }, undefined, deepseek);
  assert.equal(headers[2]["User-Agent"], "akoro-api/1.0", "default user agent");
});

test("a streamed call keeps usage and attaches the gateway cost to the final usage chunk", async () => {
  const chunks = [
    { choices: [{ index: 0, delta: { content: "hi" } }] },
    { choices: [], usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.0001, opencode: { billing_source: "go", list_cost: 0.0002, allowance: 10 } } },
  ];
  const adapter = makeOpenCodeAdapter({
    env: { ...adapterEnv, OPENCODE_USER_AGENT: "" },
    clientFor: () => fakeClient(async (params) => {
      assert.equal(params.stream, true);
      return (async function* () { for (const chunk of chunks) yield chunk; })();
    }),
  });
  const out = [];
  for await (const chunk of await adapter.create({ model: deepseek.apiModel, messages: [], stream: true }, undefined, deepseek)) out.push(chunk);
  assert.equal(out.length, 2);
  assert.deepEqual(out[1].__opencode, { costUsd: 0.0001, billingSource: "go", listCostUsd: 0.0002, allowanceUsd: 10 });
  assert.deepEqual(out[1].usage.opencode, { billing_source: "go", list_cost: 0.0002, allowance: 10 });
});

test("no key is a clear 401; the metadata helpers keep missing costs out", async () => {
  const keyless = makeOpenCodeAdapter({ env: {} });
  await assert.rejects(() => keyless.create({ model: "deepseek-v4.1-flash", messages: [] }, undefined, deepseek), (e) => e.status === 401 && /OPENCODE_API_KEY/.test(e.message));
  assert.equal(openCodeMeta({ prompt_tokens: 1 }), null);
  assert.equal(openCodeMeta({ cost: 0, opencode: { billing_source: "free" } }).costUsd, 0, "a zero cost is a real cost");
  const target = {};
  attachOpenCodeMeta(target, { cost: 0.5 });
  assert.deepEqual(target.__opencode, { costUsd: 0.5, billingSource: null, listCostUsd: null, allowanceUsd: null });
});
