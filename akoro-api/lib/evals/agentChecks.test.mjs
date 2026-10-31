import { test } from "node:test";
import assert from "node:assert/strict";
process.env.OPENAI_API_KEY ||= "test";
process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";
const { agentChecksSuite, intentSuite } = await import("./agentChecks.js");

test("agent-checks: every recorded case passes its rule (no model call)", async () => {
  const failed = [];
  for (const c of agentChecksSuite.cases) {
    const r = await c.run({});
    if (!r.passed) failed.push({ case: c.name, expected: r.expected, actual: r.actual });
  }
  assert.deepEqual(failed, []);
  assert.ok(agentChecksSuite.cases.length >= 20);
  assert.equal(agentChecksSuite.estimatedCalls, 0);
});

test("intent: one case per kind at least, hand-offs included", () => {
  const kinds = new Set(intentSuite.cases.map((c) => c.name.split(" — ")[0]));
  for (const k of ["question", "look_up", "action", "change", "handoff", "chat"]) assert.ok(kinds.has(k), k);
});
