// Model switching backend (Grand Plan §7.11.6 steps 1-4): the catalogue and
// its prices, role resolution, no new OPENAI_MODEL imports, and the
// openai_compatible / anthropic adapters (tool-call round trip, no forced
// tool choice, streaming usage, refusal and error mapping, billing price).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { createModelRegistry, checkEntry } from "./modelRegistry.js";
import { usdCost, coinsForUsage } from "./aiPricing.js";
import { makeAnthropicAdapter, toAnthropicMessages, toAnthropicParams, toChatChunks, toChatCompletion, mapError } from "./providers/anthropic.js";
import { makeOpenAICompatibleAdapter } from "./providers/openaiCompatible.js";

const CLAUDE = { id: "claude-sonnet", provider: "anthropic", apiModel: "claude-sonnet-5-5", label: "Claude Sonnet", price: { in: 2, out: 10, cachedIn: 0.2 }, caps: { tools: true, stream: true, json: true }, selectable: true };
const OPUS = { id: "claude-opus", provider: "anthropic", apiModel: "claude-opus-5-5", label: "Claude Opus", price: { in: 4, out: 20 }, caps: { tools: true, stream: true }, selectable: true };
const NO_TOOLS = { id: "plain", provider: "openai", apiModel: "plain-1", price: { in: 1, out: 1 }, caps: { stream: true }, selectable: true };
const GROK = { id: "grok", provider: "openai_compatible", apiModel: "grok-x", baseURL: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY", price: { in: 3, out: 15 }, caps: { tools: true, stream: true }, selectable: true };
const reg = (env = {}) => createModelRegistry({ AI_MODELS: JSON.stringify([CLAUDE, OPUS, NO_TOOLS, GROK]), ...env });

test("unset AI_MODELS: today's catalogue and default — nothing changes", () => {
  const r = createModelRegistry({});
  assert.equal(r.defaultId, "gpt-4o-mini");
  assert.equal(r.resolveModel({ role: "controller" }).id, "gpt-4o-mini");
  assert.deepEqual(r.catalogue.filter((e) => e.selectable).map((e) => e.id),
    ["gpt-4o-mini", "gpt-4.1", "claude-haiku", "claude-sonnet", "claude-opus", "claude-fable", "grok", "deepseek"], "the picker's models live here now");
  assert.ok(r.catalogue.filter((e) => !e.selectable).every((e) => e.provider === "openai"), "the rest of the price table: OpenAI, not pickable");
  assert.ok(!r.get("text-embedding-3-small"), "embeddings are not chat models");
  assert.equal(createModelRegistry({ OPENAI_MODEL: "gpt-4.1" }).defaultId, "gpt-4.1", "legacy OPENAI_MODEL is honoured");
  assert.equal(createModelRegistry({ OPENAI_MODEL: "gpt-4.1", AI_MODEL_DEFAULT: "gpt-4o" }).defaultId, "gpt-4o");
});

test("a model without a price (or provider) fails boot", () => {
  assert.throws(() => checkEntry({ id: "x", provider: "anthropic", apiModel: "x" }), /price/);
  assert.throws(() => checkEntry({ id: "x", provider: "anthropic", price: { in: 1 } }), /price/);
  assert.throws(() => checkEntry({ id: "x", provider: "mystery", price: { in: 1, out: 1 } }), /provider/);
  assert.throws(() => checkEntry({ id: "x", provider: "openai_compatible", price: { in: 1, out: 1 } }), /baseURL/);
  assert.throws(() => createModelRegistry({ AI_MODELS: "not json" }), /valid JSON/);
  assert.throws(() => createModelRegistry({ AI_MODELS: JSON.stringify([{ id: "bad", provider: "anthropic" }]) }), /price/);
});

test("a catalogue model is billed at its own price, never the gpt-4o-mini fallback", () => {
  reg();
  // 1M in + 1M out on Sonnet = $2 + $10; on gpt-4o-mini it would be $0.75.
  assert.equal(usdCost("claude-sonnet", 1e6, 1e6), 12);
  assert.equal(usdCost("claude-sonnet-5-5", 1e6, 1e6), 12, "under its API model name too");
  // Cache reads at the entry's own cached rate.
  assert.equal(usdCost("claude-sonnet", 1e6, 0, 1e6), 0.2);
  assert.ok(coinsForUsage("claude-opus", 10_000, 1_000) > coinsForUsage("gpt-4o-mini", 10_000, 1_000) * 20);
});

test("resolution: locked role → learner's choice (only when allowed) → role env → default", () => {
  const off = reg();
  assert.equal(off.resolveModel({ role: "chat", learnerChoice: "claude-sonnet" }).id, "gpt-4o-mini", "picker off: the choice is ignored");
  assert.match(off.resolve({ role: "chat", learnerChoice: "claude-sonnet" }).notice, /model choice is off/);

  const KEYS = { OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k", XAI_API_KEY: "k" };
  assert.equal(reg({ AI_MODEL_PICKER_ENABLED: "true" }).resolveModel({ role: "chat", learnerChoice: "claude-sonnet" }).id, "gpt-4o-mini", "no Claude key here: not set up, so not used");
  const on = reg({ ...KEYS, AI_MODEL_PICKER_ENABLED: "true", AI_MODEL_ROLE_PERSONA: "claude-opus" });
  assert.equal(on.resolveModel({ role: "chat", learnerChoice: "claude-sonnet" }).id, "claude-sonnet");
  assert.equal(on.resolve({ role: "chat", learnerChoice: "claude-sonnet" }).source, "learner");
  assert.equal(on.resolveModel({ role: "chat", learnerChoice: "claude-sonnet", allowedModels: ["grok"] }).id, "gpt-4o-mini", "not in the plan's list");
  assert.equal(on.resolveModel({ role: "controller", learnerChoice: "plain" }).id, "gpt-4o-mini", "a controller needs tool calling");
  assert.equal(on.resolveModel({ role: "chat", learnerChoice: "gpt-4o" }).id, "gpt-4o-mini", "price-table models aren't selectable");
  // Grading is fixed by env, whatever the learner picks.
  assert.equal(on.resolveModel({ role: "assessor", learnerChoice: "claude-sonnet" }).id, "gpt-4o-mini");
  assert.equal(reg({ AI_MODEL_ROLE_ASSESSOR: "claude-opus" }).resolveModel({ role: "assessor" }).id, "claude-opus");
  // Role env default, and extra locked roles.
  assert.equal(on.resolveModel({ role: "persona" }).id, "claude-opus");
  const locked = reg({ ...KEYS, AI_MODEL_PICKER_ENABLED: "true", AI_MODEL_LOCKED_ROLES: "chat" });
  assert.equal(locked.resolveModel({ role: "chat", learnerChoice: "claude-sonnet" }).id, "gpt-4o-mini");
  assert.throws(() => on.resolveModel({ role: "boss" }), /Unknown model role/);
  // What the picker may list.
  assert.deepEqual(on.selectable().map((e) => e.id).sort(),
    ["claude-fable", "claude-haiku", "claude-opus", "claude-sonnet", "gpt-4.1", "gpt-4o-mini", "grok", "plain"], "DeepSeek: no key here");
  assert.deepEqual(on.selectable(["grok"]).map((e) => e.id), ["grok"]);
});

test("no new OPENAI_MODEL imports: new code names a role (§7.11.6 step 3)", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  // The call sites that still import it — to move to roles. Shrink this list; never grow it.
  const ALLOWED = new Set([
    "lib/aiModel.js", "lib/modelRegistry.js",
    "modules/adaptive-learning/chat.js", "modules/adaptive-learning/draw.js", "modules/adaptive-learning/exam-prep-service.js",
    "modules/adaptive-learning/peerConsult.js", "modules/adaptive-learning/study-prep/syllabus-generator.js",
    "modules/agent-network/messaging.js", "modules/autonomy/cycle.js", "modules/battle/questionSource.js", "modules/battle/routes.js",
    "modules/instructor/routes.js", "modules/instructor/tools.js", "modules/records/routes.js", "modules/school/aiConcierge.js",
    "modules/school/websiteAiSync.js", "modules/self-study/submissionArtifacts.js", "modules/tasks/lib/agentLoop.js", "modules/tasks/lib/ocr.js",
    "modules/tasks/routes.js", "modules/tasks/tools/_llm.js", "modules/tasks/tools/dynamic.js", "modules/tasks/tools/explain-concept.js",
    "modules/tasks/tools/export-report.js", "modules/tasks/tools/generate-quiz.js", "modules/tasks/tools/grade-submissions.js",
    "modules/tasks/tools/quiz-me.js", "modules/tasks/tools/study-plan.js", "modules/tasks/worker.js", "modules/teaching/tools.js",
    "services/agentService.js",
  ]);
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs)$/.test(name) && !/\.test\.mjs$/.test(name) && /OPENAI_MODEL/.test(readFileSync(full, "utf8"))) found.push(path.relative(root, full));
    }
  };
  for (const dir of ["lib", "modules", "services"]) walk(path.join(root, dir));
  const extra = found.filter((f) => !ALLOWED.has(f));
  assert.deepEqual(extra, [], "use __role on the call (lib/modelRegistry.js ROLES) instead of OPENAI_MODEL");
  assert.ok(!found.includes("modules/agent-runtime/llm-agent.js"), "the shared agent runtime resolves the controller role");
});

// ── the anthropic adapter ───────────────────────────────────────────────────

const entry = checkEntry(CLAUDE);

test("messages and tools convert; 'required' becomes auto + one-tool instruction (no forced choice)", () => {
  const params = {
    messages: [
      { role: "system", content: "You plan studies." },
      { role: "user", content: "Plan Biology." },
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "syllabus_resolve", arguments: "{\"args\":{}}" } }] },
      { role: "tool", tool_call_id: "t1", content: "{\"topics\":[\"cells\"]}" },
    ],
    tools: [{ type: "function", function: { name: "syllabus_resolve", description: "List topics", parameters: { type: "object", properties: {} } } }],
    tool_choice: "required", max_tokens: 700, temperature: 0.2,
  };
  const out = toAnthropicParams(params, entry);
  assert.equal(out.model, "claude-sonnet-5-5");
  assert.deepEqual(out.tool_choice, { type: "auto" });
  assert.match(out.system, /You plan studies\.[\s\S]*Call exactly one of the provided tools/);
  assert.equal(out.max_tokens, 4000, "room for thinking, which shares max_tokens");
  assert.deepEqual(out.output_config, { effort: "low" });
  assert.equal(out.temperature, undefined, "sampling params are not sent");
  assert.deepEqual(out.tools, [{ name: "syllabus_resolve", description: "List topics", input_schema: { type: "object", properties: {} } }]);
  assert.deepEqual(out.messages.map((m) => [m.role, m.content.map((b) => b.type)]), [["user", ["text"]], ["assistant", ["tool_use"]], ["user", ["tool_result"]]]);
  assert.deepEqual(out.messages[1].content[0].input, { args: {} });
  assert.equal(toAnthropicParams({ ...params, tool_choice: "none" }, entry).tool_choice.type, "none");
  assert.equal(toAnthropicMessages([{ role: "assistant", content: "hi" }]).messages[0].role, "user", "the first message is the user's");
});

test("a response with a tool call, thinking and cache reads maps to a chat completion", () => {
  const res = toChatCompletion({
    id: "msg_1", model: "claude-sonnet-5-5", stop_reason: "tool_use",
    content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Checking." }, { type: "tool_use", id: "tu_1", name: "propose_plan", input: { args: { topics: ["cells"] }, intent: "Start." } }],
    usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
  });
  const msg = res.choices[0].message;
  assert.equal(res.choices[0].finish_reason, "tool_calls");
  assert.equal(msg.content, "Checking.", "thinking is never passed on");
  assert.deepEqual(JSON.parse(msg.tool_calls[0].function.arguments), { args: { topics: ["cells"] }, intent: "Start." });
  assert.deepEqual(res.usage, { prompt_tokens: 1000, completion_tokens: 40, total_tokens: 1040, prompt_tokens_details: { cached_tokens: 900 } });
});

test("a refusal maps to content_filter with the reason, not a crash", () => {
  const res = toChatCompletion({ id: "m", model: "claude-sonnet-5-5", stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: "Declined." }, content: [], usage: { input_tokens: 5, output_tokens: 0 } });
  assert.equal(res.choices[0].finish_reason, "content_filter");
  assert.equal(res.choices[0].message.refusal, "Declined.");
  assert.equal(res.choices[0].message.refusal_category, "cyber");
  assert.equal(res.choices[0].message.content, null);
});

test("streaming: text and tool-call deltas, thinking dropped, a final usage chunk", async () => {
  async function* events() {
    yield { type: "message_start", message: { usage: { input_tokens: 50, cache_read_input_tokens: 10, output_tokens: 1 } } };
    yield { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } };
    yield { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "secret" } };
    yield { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } };
    yield { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hel" } };
    yield { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "lo" } };
    yield { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "tu_1", name: "advance_topic", input: {} } };
    yield { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"args\":" } };
    yield { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{}}" } };
    yield { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 30 } };
    yield { type: "message_stop" };
  }
  const chunks = [];
  for await (const c of toChatChunks(events())) chunks.push(c);
  const text = chunks.map((c) => c.choices[0]?.delta?.content || "").join("");
  assert.equal(text, "Hello");
  assert.ok(!JSON.stringify(chunks).includes("secret"), "thinking never streams");
  const args = chunks.flatMap((c) => c.choices[0]?.delta?.tool_calls || []).map((t) => t.function?.arguments || "").join("");
  assert.equal(args, "{\"args\":{}}");
  assert.equal(chunks.at(-2).choices[0].finish_reason, "tool_calls");
  assert.deepEqual(chunks.at(-1).usage, { prompt_tokens: 60, completion_tokens: 30, total_tokens: 90, prompt_tokens_details: { cached_tokens: 10 } });
});

test("errors keep their HTTP status; the adapter calls the SDK with the converted body", async () => {
  const sent = [];
  const fake = { messages: { create: async (body) => { sent.push(body); return { id: "m", model: body.model, stop_reason: "end_turn", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 3, output_tokens: 2 } }; } } };
  const adapter = makeAnthropicAdapter({ client: fake });
  const res = await adapter.create({ messages: [{ role: "user", content: "hi" }], max_tokens: 50 }, undefined, entry);
  assert.equal(res.choices[0].message.content, "ok");
  assert.equal(sent[0].model, "claude-sonnet-5-5");
  const apiErr = new Anthropic.RateLimitError(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers());
  const mapped = mapError(apiErr);
  assert.equal(mapped.status, 429);
  assert.equal(mapped.provider, "anthropic");
  // A 400 is our request's fault: the status reaches the caller and the breaker stays shut.
  // (A 429 or 5xx counts as provider trouble and can open it — as on the OpenAI path.)
  const badRequest = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "bad field" } }, "bad field", new Headers());
  const failing = makeAnthropicAdapter({ client: { messages: { create: async () => { throw badRequest; } } } });
  await assert.rejects(() => failing.create({ messages: [{ role: "user", content: "hi" }] }, undefined, entry), (e) => e.status === 400 && /Claude: /.test(e.message));
  // No key: a clear 401, not a crash at boot.
  const keyless = makeAnthropicAdapter({ env: {} });
  await assert.rejects(() => keyless.create({ messages: [{ role: "user", content: "hi" }] }, undefined, entry), (e) => e.status === 401 && /ANTHROPIC_API_KEY/.test(e.message));
});

test("openai_compatible: the provider's own address and key; a missing key is a clear 401", async () => {
  const seen = [];
  const adapter = makeOpenAICompatibleAdapter({ clientFor: (e) => ({ chat: { completions: { create: async (p) => { seen.push([e.baseURL, p.model]); return { choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }; } } } }) });
  const grok = checkEntry(GROK);
  const res = await adapter.create({ model: "grok-x", messages: [] }, undefined, grok);
  assert.equal(res.choices[0].message.content, "hi");
  assert.deepEqual(seen, [["https://api.x.ai/v1", "grok-x"]]);
  const keyless = makeOpenAICompatibleAdapter({ env: {} });
  await assert.rejects(() => keyless.create({ model: "grok-x", messages: [] }, undefined, grok), (e) => e.status === 401 && /XAI_API_KEY/.test(e.message));
});
