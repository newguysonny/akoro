import assert from "node:assert/strict";
import test from "node:test";
import { compatParams } from "./openaiCompatible.js";
import { createModelRegistry, forcedModelFor } from "../modelRegistry.js";

test("OpenAI-compatible providers: json_schema becomes json_object plus the schema as an instruction", () => {
  const schema = { type: "object", required: ["a"], properties: { a: { type: "string" } } };
  const out = compatParams({ model: "deepseek-chat", messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }],
    response_format: { type: "json_schema", json_schema: { name: "x", strict: true, schema } } });
  assert.deepEqual(out.response_format, { type: "json_object" });
  assert.match(out.messages[0].content, /^Be brief\.\n\nReturn only a JSON object that matches this JSON schema/);
  assert.ok(out.messages[0].content.includes(JSON.stringify(schema)));
  const noSystem = compatParams({ messages: [{ role: "user", content: "hi" }], response_format: { type: "json_schema", json_schema: { schema } } });
  assert.equal(noSystem.messages[0].role, "system");
  const plain = { messages: [{ role: "user", content: "x" }], response_format: { type: "json_object" } };
  assert.deepEqual(compatParams(plain), plain, "anything else is unchanged");
});

test("AI_FORCE_MODEL sends OpenAI-bound chat calls to a configured DeepSeek, and only when it is callable", async () => {
  const env = {
    AI_FORCE_MODEL: "deepseek", DEEPSEEK_API_KEY: "k", DEEPSEEK_MODEL: "deepseek-chat",
    AI_MODELS: JSON.stringify([{ id: "deepseek", provider: "deepseek", price: { in: 0.28, out: 0.42 } }]),
  };
  const registry = createModelRegistry(env);
  const mini = registry.get("gpt-4o-mini");
  const forced = forcedModelFor(mini, "gpt-4o-mini", { registry, env });
  assert.equal(forced?.apiModel, "deepseek-chat");
  assert.equal(forced?.provider, "openai_compatible");
  assert.equal(forcedModelFor(registry.get("claude-haiku"), "claude-haiku", { registry, env }), null, "other providers keep their model");
  assert.equal(forcedModelFor(mini, "gpt-4o-mini", { registry, env: { ...env, AI_FORCE_MODEL: "" } }), null, "unset: nothing changes");
  const noKey = { ...env, DEEPSEEK_API_KEY: "" };
  assert.equal(forcedModelFor(mini, "gpt-4o-mini", { registry: createModelRegistry(noKey), env: noKey }), null, "no key: not forced");
});
