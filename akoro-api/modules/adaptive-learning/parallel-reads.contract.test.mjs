// Parallel read batches in the real tool loop, against a local stand-in for
// OpenAI: a decision carrying several independent READ calls runs them
// together (results still applied in the model's order), a side-effecting
// call stays a serial barrier, and AKORO_PARALLEL_READS=false restores the
// old one-at-a-time execution.
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-key";
process.env.AI_TELEMETRY_DB = "off";
process.env.AI_TELEMETRY = "off";
process.env.JWT_SECRET ||= "stub-jwt-secret";
process.env.JWT_ISSUER ||= "https://api.akoro.app";
process.env.JWT_AUDIENCE ||= "https://akoro.app";
process.env.GOOGLE_CLIENT_ID ||= "stub-google-id";
process.env.GOOGLE_CLIENT_SECRET ||= "stub-google-secret";
delete process.env.PRIVATE_KEY;
delete process.env.PUBLIC_KEY;

// The scripted decision for the current test: tool names in call order.
let script = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const params = JSON.parse(body || "{}");
    const sawToolResult = (params.messages || []).some((message) => message.role === "tool");
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
    if (!sawToolResult) {
      chunk({ role: "assistant", content: "" });
      script.forEach((name, index) => {
        chunk({ tool_calls: [{ index, id: `call_${index + 1}`, type: "function", function: { name, arguments: "" } }] });
        chunk({ tool_calls: [{ index, function: { arguments: "{}" } }] });
      });
    } else {
      chunk({ role: "assistant", content: "Here is " });
      chunk({ content: "your answer." });
    }
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(0, resolve));
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
test.after(() => {
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
});

const { runAgentToolLoop } = await import("./chat.js");

const DELAYS = { check_progress: 600, list_my_goals: 200, list_tasks: 400, get_weak_topics: 250, create_task: 150 };
const defs = (names) => names.map((name) => ({ type: "function", function: { name, description: name, parameters: { type: "object", properties: {} } } }));

async function runTurn(names) {
  script = names;
  const stamps = [];
  const callTool = async (tool) => {
    const start = Date.now();
    await new Promise((resolve) => setTimeout(resolve, DELAYS[tool] ?? 100));
    stamps.push({ tool, start, end: Date.now() });
    return { success: true, echo: tool };
  };
  const t0 = Date.now();
  const result = await runAgentToolLoop({
    systemContent: "doctrine", messages: [{ role: "user", content: "How am I doing?" }],
    studentId: "00000000-0000-4000-8000-000000000001", tools: defs(names), callTool,
  });
  return { result, stamps, wallMs: Date.now() - t0 };
}
const byTool = (stamps, tool) => stamps.find((s) => s.tool === tool);

test("independent reads in one decision run together; outcomes land in call order", async () => {
  delete process.env.AKORO_PARALLEL_READS;
  const names = ["check_progress", "list_my_goals", "list_tasks", "get_weak_topics"];
  const { result, stamps, wallMs } = await runTurn(names);
  // Executions and transcript tool messages keep the model's order, even
  // though list_my_goals (200ms) finished long before check_progress (600ms).
  assert.deepEqual(result.toolExecutions.map((e) => e.tool), names);
  assert.ok(result.toolExecutions.every((e) => e.success));
  assert.deepEqual(
    result.messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id),
    ["call_1", "call_2", "call_3", "call_4"],
  );
  // They really overlapped: the later reads started before the slowest ended.
  const slow = byTool(stamps, "check_progress");
  assert.ok(byTool(stamps, "list_tasks").start < slow.end, "list_tasks started while check_progress was still running");
  assert.ok(byTool(stamps, "get_weak_topics").start < slow.end, "get_weak_topics started while check_progress was still running");
  // Serial would cost 600+200+400+250 = 1450ms of tool time alone.
  assert.ok(wallMs < 1100, `turn took ${wallMs}ms — the reads did not run together`);
});

test("a side-effecting call is a barrier: reads never cross it", async () => {
  const names = ["list_my_goals", "create_task", "list_tasks"];
  const { result, stamps } = await runTurn(names);
  assert.deepEqual(result.toolExecutions.map((e) => e.tool), names);
  const write = byTool(stamps, "create_task");
  assert.ok(write.start >= byTool(stamps, "list_my_goals").end, "the write waited for the read before it");
  assert.ok(byTool(stamps, "list_tasks").start >= write.end, "the read after the write waited for it");
});

test("AKORO_PARALLEL_READS=false restores one-at-a-time execution", async () => {
  process.env.AKORO_PARALLEL_READS = "false";
  try {
    const names = ["check_progress", "list_my_goals", "list_tasks", "get_weak_topics"];
    const { stamps, wallMs } = await runTurn(names);
    const ordered = names.map((n) => byTool(stamps, n));
    for (let i = 1; i < ordered.length; i += 1) {
      assert.ok(ordered[i].start >= ordered[i - 1].end, `${names[i]} started before ${names[i - 1]} finished`);
    }
    assert.ok(wallMs >= 1350, `turn took ${wallMs}ms — the kill switch did not serialise the reads`);
  } finally {
    delete process.env.AKORO_PARALLEL_READS;
  }
});
