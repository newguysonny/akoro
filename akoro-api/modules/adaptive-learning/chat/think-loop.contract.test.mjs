// Think mode end to end through the real tool loop, against a local stand-in
// for OpenAI: every decision runs on the reasoning model, its reasoning
// summary streams into that step's row, the streamed function call executes,
// and a final decision with no tool call becomes the answer.
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-key";
process.env.AI_TELEMETRY_DB = "off";
process.env.AI_TELEMETRY = "off";
// chat.js loads the auth module; give it the same stubs the other route tests use.
process.env.JWT_SECRET ||= "stub-jwt-secret";
process.env.JWT_ISSUER ||= "https://api.akoro.app";
process.env.JWT_AUDIENCE ||= "https://akoro.app";
process.env.GOOGLE_CLIENT_ID ||= "stub-google-id";
process.env.GOOGLE_CLIENT_SECRET ||= "stub-google-secret";
delete process.env.PRIVATE_KEY;
delete process.env.PUBLIC_KEY;

let responsesUp = true;
const requests = [];
const sse = (res, events) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const ev of events) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  res.end();
};
const completed = { type: "response.completed", response: { usage: { input_tokens: 50, output_tokens: 80 } } };

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const params = JSON.parse(body || "{}");
    requests.push({ url: req.url, params });
    if (req.url.endsWith("/responses")) {
      if (!responsesUp) { res.writeHead(404, { "content-type": "application/json" }); res.end('{"error":{"message":"model not found"}}'); return; }
      const sawResult = (params.input || []).some((item) => item.type === "function_call_output");
      if (!sawResult) {
        return sse(res, [
          { type: "response.reasoning_summary_part.added", summary_index: 0 },
          { type: "response.reasoning_summary_text.delta", delta: "They ask what I can do." },
          { type: "response.reasoning_summary_part.added", summary_index: 1 },
          { type: "response.reasoning_summary_text.delta", delta: "Check the live list." },
          { type: "response.output_item.done", item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "get_agent_capabilities", arguments: "{}" } },
          completed,
        ]);
      }
      return sse(res, [
        { type: "response.reasoning_summary_text.delta", delta: "I have the list; answer." },
        { type: "response.output_text.delta", delta: "I can explain concepts " },
        { type: "response.output_text.delta", delta: "and plan your study." },
        completed,
      ]);
    }
    // chat.completions (standard model, streamed): the first decision writes a
    // few words and calls a tool in pieces; once a result is in, it answers.
    const sawToolResult = (params.messages || []).some((message) => message.role === "tool");
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
    if (!sawToolResult) {
      chunk({ role: "assistant", content: "Let me " });
      chunk({ content: "check." });
      chunk({ tool_calls: [{ index: 0, id: "call_9", type: "function", function: { name: "get_agent_", arguments: "" } }] });
      chunk({ tool_calls: [{ index: 0, function: { name: "capabilities", arguments: "{}" } }] });
    } else {
      chunk({ role: "assistant", content: "Here is " });
      chunk({ content: "what I can do." });
    }
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(0, resolve));
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
test.after(() => {
  // Importing chat.js loads the real auth/db modules, whose background handles
  // keep this subprocess alive (same shutdown as detail-responds.test.mjs).
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
});

const { runAgentToolLoop } = await import("../chat.js");
const { createChatTrace } = await import("./chat-trace.js");
const tools = [{ type: "function", function: { name: "get_agent_capabilities", description: "What the agent can do", parameters: { type: "object", properties: {} } } }];

test("Think mode: real reasoning per step, the tool runs, the last decision is the answer", async () => {
  requests.length = 0;
  const events = [];
  const trace = createChatTrace({ send: (event, data) => events.push([event, data]) });
  const result = await runAgentToolLoop({
    systemContent: "doctrine", messages: [{ role: "user", content: "What can you do?" }],
    studentId: "00000000-0000-4000-8000-000000000001", tools, trace, think: true,
  });
  assert.equal(result.finalText, "I can explain concepts and plan your study.");
  assert.deepEqual(result.toolExecutions.map((entry) => [entry.tool, entry.success]), [["get_agent_capabilities", true]]);
  assert.deepEqual(events.map(([event]) => event), [
    "think_start", "think_delta", "think_delta", "think_delta", "think_end",
    "tool_start", "tool_end",
    // The answer's words stream live, then move to the reply.
    "think_start", "think_delta", "think_end",
    "activity_start", "activity_delta", "activity_delta", "activity_promote",
  ]);
  assert.equal(trace.blocks().filter((block) => block.type === "activity").length, 0, "the promoted answer is not stored twice");
  const [first, , second] = trace.blocks();
  assert.equal(first.source, "reasoning");
  assert.equal(first.text, "They ask what I can do.\n\nCheck the live list.");
  assert.equal(second.text, "I have the list; answer.");
  // Both decisions went to the reasoning model with the tools declared; the
  // second carried the tool result as a native function_call_output.
  assert.equal(requests.length, 2);
  assert.ok(requests.every((r) => r.url.endsWith("/responses") && r.params.model === "o4-mini" && r.params.tools?.[0]?.strict === false));
  assert.deepEqual(requests[0].params.tool_choice, "auto");
  assert.ok(requests[1].params.input.some((item) => item.type === "function_call_output" && item.call_id === "call_1"));
});

test("Think mode: an unavailable reasoning model falls back to the standard model for the turn", async () => {
  requests.length = 0;
  responsesUp = false;
  try {
    const trace = createChatTrace();
    const result = await runAgentToolLoop({
      systemContent: "doctrine", messages: [{ role: "user", content: "hi" }],
      studentId: "00000000-0000-4000-8000-000000000001", tools, trace, think: true,
    });
    assert.ok(requests.some((r) => r.url.endsWith("/chat/completions")));
    assert.equal(result.finalText, "Here is what I can do.");
    assert.equal(trace.blocks()[0].source, undefined, "the row falls back to narration");
  } finally { responsesUp = true; }
});

test("standard mode streams words between steps, assembles streamed tool calls, and the last words become the reply", async () => {
  requests.length = 0;
  const events = [];
  const trace = createChatTrace({ send: (event, data) => events.push([event, data]) });
  const result = await runAgentToolLoop({
    systemContent: "doctrine", messages: [{ role: "user", content: "hi" }],
    studentId: "00000000-0000-4000-8000-000000000001", tools, trace,
  });
  assert.ok(requests.length === 2 && requests.every((r) => r.url.endsWith("/chat/completions") && r.params.stream === true));
  assert.deepEqual(result.toolExecutions.map((entry) => entry.tool), ["get_agent_capabilities"]);
  assert.equal(result.finalText, "Here is what I can do.");
  assert.equal(result.promoted, true);
  assert.deepEqual(events.map(([event]) => event), [
    "think_start", "think_end", "activity_start", "activity_delta", "activity_delta", "activity_end",
    "tool_start", "tool_end",
    "think_start", "think_end", "activity_start", "activity_delta", "activity_delta", "activity_promote",
  ]);
  // Words alongside a tool call stay between the steps; the answer does not.
  assert.deepEqual(trace.blocks().filter((block) => block.type === "activity").map((block) => block.text), ["Let me check."]);
});

test("research mode buffers words (its answer is regenerated) and never promotes", async () => {
  requests.length = 0;
  const events = [];
  const result = await runAgentToolLoop({
    systemContent: "doctrine", messages: [{ role: "user", content: "hi" }],
    studentId: "00000000-0000-4000-8000-000000000001", tools,
    trace: createChatTrace({ send: (event) => events.push(event) }), streamText: false,
  });
  assert.equal(result.finalText, undefined);
  assert.ok(!events.some((event) => event.startsWith("activity_")));
  assert.ok(events.includes("activity"), "words alongside a tool call still show, whole");
});
