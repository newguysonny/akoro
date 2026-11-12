// meteredCreate routes a call to the provider its resolved model lives on
// (§7.11.4): here the `controller` role is set to a Claude catalogue model and
// the real Anthropic SDK talks to a local stand-in for the Messages API.
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

const seen = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    seen.push({ url: req.url, key: req.headers["x-api-key"], body: JSON.parse(body || "{}") });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tu_1", name: "propose_plan", input: { intent: "Weakest first.", args: { topics: ["cells"] } } }],
      usage: { input_tokens: 120, output_tokens: 30 },
    }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.AI_MODELS = JSON.stringify([{ id: "claude-sonnet", provider: "anthropic", apiModel: "claude-sonnet-5-5", price: { in: 2, out: 10 }, caps: { tools: true, stream: true }, enabled: true, selectable: true }]);
process.env.AI_MODEL_ROLE_CONTROLLER = "claude-sonnet";
process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
process.env.AI_TELEMETRY_DB = "off";
process.env.AI_TELEMETRY = "off";

const { openai, OPENAI_MODEL } = await import("./aiModel.js");

test("a controller call without a model resolves to its role's Claude model and comes back chat-shaped", async () => {
  const res = await openai.chat.completions.create({
    __role: "controller", __feature: "test",
    max_tokens: 700, tool_choice: "required",
    messages: [{ role: "system", content: "Plan." }, { role: "user", content: "Go." }],
    tools: [{ type: "function", function: { name: "propose_plan", description: "Propose", parameters: { type: "object", properties: {} } } }],
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "/v1/messages");
  assert.equal(seen[0].key, "test-key");
  assert.equal(seen[0].body.model, "claude-sonnet-5-5");
  assert.deepEqual(seen[0].body.tool_choice, { type: "auto" }, "no forced tool choice");
  assert.equal(seen[0].body.__role, undefined, "routing keys never reach the provider");
  const call = res.choices[0].message.tool_calls[0];
  assert.equal(call.function.name, "propose_plan");
  assert.deepEqual(JSON.parse(call.function.arguments).args, { topics: ["cells"] });
  assert.deepEqual(res.usage.prompt_tokens, 120);
});

test("a call with no role keeps the default model", () => {
  assert.equal(OPENAI_MODEL, "deepseek");
});
