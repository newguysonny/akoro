// Verification Gate: verdict rules, redaction, policy, and the wiring.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createExpect, repeatVerdict, combineRepeats, combineSuite, BlockedError } from "./assertions.js";
import { redact, capEvidence } from "./evidence.js";

test("fail closed: only all-passing assertions are PASS", () => {
  assert.equal(repeatVerdict({ assertions: [{ passed: true }, { passed: true }] }), "PASS");
  assert.equal(repeatVerdict({ assertions: [{ passed: true }, { passed: false }] }), "FAIL");
  assert.equal(repeatVerdict({ assertions: [] }), "ERROR", "a scenario that checked nothing verified nothing");
  assert.equal(repeatVerdict({ assertions: [], error: new BlockedError("redis down") }), "BLOCKED");
  assert.equal(repeatVerdict({ assertions: [{ passed: true }], error: new Error("boom") }), "ERROR");
});

test("repeats: disagreement is INCONCLUSIVE; suites take the worst", () => {
  assert.equal(combineRepeats(["PASS", "PASS", "PASS"]), "PASS");
  assert.equal(combineRepeats(["PASS", "FAIL", "PASS"]), "INCONCLUSIVE");
  assert.equal(combineRepeats(["FAIL", "FAIL"]), "FAIL");
  assert.equal(combineRepeats(["PASS", "BLOCKED"]), "BLOCKED");
  assert.equal(combineSuite(["PASS", "PASS"]), "PASS");
  assert.equal(combineSuite(["PASS", "BLOCKED", "FAIL"]), "FAIL");
  assert.equal(combineSuite(["PASS", "INCONCLUSIVE"]), "INCONCLUSIVE");
  assert.equal(combineSuite([]), "ERROR");
});

test("expect records every check (doesn't stop at the first failure) and reads tool calls", () => {
  const sink = [];
  const e = createExpect(sink);
  const turn = { tools: [{ tool: "schedule_chat_follow_up", success: true, input: { where: "here", inMinutes: 10 } }] };
  e.toolCalled(turn, "schedule_chat_follow_up");
  e.toolNotCalled(turn, "create_task");
  assert.equal(e.toolArgs(turn, "schedule_chat_follow_up", { where: "chat", inMinutes: 5 }), false);
  assert.deepEqual(sink.map((a) => a.passed), [true, true, false, false], "both wrong arguments reported");
  e.toolArgs(turn, "schedule_chat_follow_up", { where: "here", inMinutes: 10 });
  assert.deepEqual(sink.slice(-2).map((a) => a.passed), [true, true]);
  assert.throws(() => e.blocked("no tester"), BlockedError);
});

test("noBackendNames flags tool names but not @usernames", () => {
  const sink = [];
  const e = createExpect(sink);
  e.noBackendNames("a", "I scheduled it with schedule_chat_follow_up.");
  e.noBackendNames("b", "Ask @jss1_mate3 — they're online. I'll message you here in 10 minutes.");
  assert.deepEqual(sink.map((a) => a.passed), [false, true]);
});

test("redaction: secrets, emails, tokens; real users minimised harder", () => {
  const r = redact({ authorization: "Bearer x", password: "p", note: "mail me at ada@gmail.com, tester01@demo.akoro.app", t: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlMTIz" });
  assert.equal(r.authorization, "[redacted]");
  assert.equal(r.password, "[redacted]");
  assert.match(r.note, /\[email\]/);
  assert.match(r.note, /tester01@demo\.akoro\.app/, "test accounts stay readable");
  assert.equal(r.t, "[token]");
  const long = "x".repeat(1000);
  assert.ok(redact(long, { realUser: true }).length <= 201);
  assert.match(redact("call 0803 123 4567", { realUser: true }), /\[phone\]/);
});

test("evidence is size-capped", () => {
  const big = { logs: Array.from({ length: 500 }, () => "y".repeat(300)), http: [], agent: [] };
  assert.ok(Buffer.byteLength(JSON.stringify(capEvidence(big, 30_000))) <= 30_000);
});

test("wiring: guarded mount, policy rules, inspected tool calls, persisted runs", () => {
  const app = readFileSync(new URL("../../app.js", import.meta.url), "utf8");
  const policy = readFileSync(new URL("./policy.js", import.meta.url), "utf8");
  const chat = readFileSync(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");
  const runner = readFileSync(new URL("./runner.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("./routes.js", import.meta.url), "utf8");
  assert.match(app, /app\.use\("\/api\/verify",\s+standardLimit, verifyModule\)/);
  assert.match(routes, /router\.use\(guard\);/);
  assert.match(policy, /Real users are read-only to the gate/);
  assert.match(policy, /VERIFY_ALLOW_WRITES/);
  assert.match(chat, /req\.get\("x-agent-console-inspect"\) === key/);
  assert.match(chat, /\.\.\.\(isInspected\(\) \? \{ input, result: inspectResult\(toolResult\) \} : \{\}\)/);
  assert.match(runner, /stale deploy: expected/);
  assert.match(runner, /action: "verify\.run_as_user"/);
  const manifest = JSON.parse(readFileSync(new URL("../../migrations/manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.schema.includes("2026-verify-gate.sql"));
});
