/**
 * prompt-perf.contract.test.mjs — the 2026-11-17 performance package:
 *   1. the prompt-cache tail layout (volatile context rides AFTER the
 *      transcript; the static system leads),
 *   2. the final-iteration answer force (tool_choice "none" on the loop's
 *      last step, so no separate answer call is needed),
 *   3. the composite progress read (one tool, four parts, errors in place).
 * Run: node --test modules/adaptive-learning/prompt-perf.contract.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-key";
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

// ── Fake OpenAI chat-completions server (SSE), scripted per test ────────────
const requests = [];
let script = () => ({});
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}");
    requests.push(parsed);
    const out = script(parsed, requests.length);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunks = out.tool
      ? [
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: out.tool, arguments: "{}" } }] } }] },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        ]
      : [
          { choices: [{ delta: { content: out.text || "Done." } }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ];
    for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;

test.after(() => {
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
});

const { runAgentToolLoop, CHAT_TOOLS, CHAT_TOOL_LOOP_MAX_ITERATIONS } = await import("./chat.js");
const { materialsFrom } = await import("./chat-materials.js");
const { TOOL_EXAMPLES } = await import("../agent-capabilities/examples.js");

const READ_DEF = {
  type: "function",
  function: { name: "check_progress", description: "read", parameters: { type: "object", properties: {}, required: [] } },
};
const instantTool = async () => ({ ok: true });

test("tail layout: static system leads, transcript follows, volatile tail is last", async () => {
  requests.length = 0;
  script = (_body, n) => (n === 1 ? { tool: "check_progress" } : { text: "Here is your progress." });
  const result = await runAgentToolLoop({
    systemContent: "STATIC-SYSTEM",
    tailContent: "VOLATILE-TAIL",
    messages: [{ role: "user", content: "How am I doing?" }],
    studentId: "learner-1",
    tools: [READ_DEF],
    callTool: instantTool,
    status: null,
  });
  assert.equal(result.finalText, "Here is your progress.");
  assert.equal(requests.length, 2);
  for (const body of requests) {
    const msgs = body.messages;
    assert.deepEqual(msgs[0], { role: "system", content: "STATIC-SYSTEM" }, "static system leads");
    assert.deepEqual(msgs.at(-1), { role: "system", content: "VOLATILE-TAIL" }, "volatile tail is the last message");
    const userAt = msgs.findIndex((m) => m.role === "user");
    assert.ok(userAt > 0 && userAt < msgs.length - 1, "transcript sits between static and tail");
  }
  // The tail never enters the returned transcript (it is not saved dialogue).
  assert.ok(!result.messages.some((m) => m.content === "VOLATILE-TAIL"), "tail is not part of the transcript");
});

test("no tail: requests keep the legacy single-system shape", async () => {
  requests.length = 0;
  script = () => ({ text: "Plain answer." });
  const result = await runAgentToolLoop({
    systemContent: "ONLY-SYSTEM",
    messages: [{ role: "user", content: "Hi" }],
    studentId: "learner-1",
    tools: [READ_DEF],
    callTool: instantTool,
    status: null,
  });
  assert.equal(result.finalText, "Plain answer.");
  assert.equal(requests[0].messages.length, 2);
  assert.deepEqual(requests[0].messages[0], { role: "system", content: "ONLY-SYSTEM" });
});

test("answer force: a turn that never stops calling tools answers on the last iteration", async () => {
  requests.length = 0;
  script = (body) => (body.tool_choice === "none" ? { text: "Final answer from what I have." } : { tool: "check_progress" });
  const result = await runAgentToolLoop({
    systemContent: "SYS",
    messages: [{ role: "user", content: "Keep digging" }],
    studentId: "learner-1",
    tools: [READ_DEF],
    callTool: instantTool,
    status: null,
  });
  assert.equal(result.finalText, "Final answer from what I have.", "the forced decision becomes the reply — no separate answer call needed");
  assert.equal(requests.length, CHAT_TOOL_LOOP_MAX_ITERATIONS, "exactly the capped number of decisions, no extra call");
  assert.equal(requests.at(-1).tool_choice, "none", "the last decision forbids tools");
  assert.ok(requests.slice(0, -1).every((b) => b.tool_choice === "auto"), "earlier decisions are unforced");
  assert.equal(result.toolExecutions.length, CHAT_TOOL_LOOP_MAX_ITERATIONS - 1, "every earlier decision's tool ran");
});

test("composite progress read: registered, steered, taxonomy-placed, materials merge", async () => {
  // Registered in the catalogue with the steering description.
  const def = CHAT_TOOLS.find((d) => d.name === "get_progress_overview");
  assert.ok(def, "get_progress_overview is in the chat tool catalogue");
  assert.match(def.description, /ONE call/);
  assert.match(def.description, /check_progress/);
  // Taxonomy: the composite lives in the progress area with its siblings.
  assert.equal(TOOL_EXAMPLES.get_progress_overview?.area, "progress");
  // Materials: the bundle's course links ride from its progress + overview parts.
  const mats = materialsFrom("get_progress_overview", {
    progress: { courses: [{ title: "Biology", slug: "biology-101" }] },
    overview: { courses: [{ title: "Chemistry", slug: "chem-101" }] },
    ranking: {},
    knowledgeMap: {},
  });
  assert.deepEqual(mats.map((m) => m.href), ["/course/biology-101", "/course/chem-101"]);
});
