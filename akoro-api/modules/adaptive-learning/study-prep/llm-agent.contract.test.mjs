// The planning agent's provider adapter: tool names the provider accepts,
// mapped back to the registry's own names (the 400 that killed every
// planning step), and provider failures leave a trace in the session log.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

process.env.OPENAI_API_KEY ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";

const { providerToolName } = await import("./llm-agent.js");
const { llmFacingTools } = await import("../tools/registry.js");

const PROVIDER_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

test("every tool the planner is offered has a provider-valid, unique name", () => {
  for (const includeContentSearch of [false, true]) {
    const tools = llmFacingTools({ includeContentSearch });
    const names = tools.map((t) => providerToolName(t.name));
    for (const n of names) assert.match(n, PROVIDER_NAME, n);
    assert.equal(new Set(names).size, names.length, "no collisions after making names safe");
  }
  assert.equal(providerToolName("syllabus.resolve"), "syllabus_resolve");
  assert.equal(providerToolName("propose_plan"), "propose_plan", "already-safe names are unchanged");
});

test("replies are mapped back to registry names; the call is bounded and labelled", () => {
  const src = readFileSync(new URL("./llm-agent.js", import.meta.url), "utf8");
  assert.match(src, /name: providerToolName\(tool\.name\)/);
  assert.match(src, /toRegistry\.get\(call\.function\.name\)/);
  assert.match(src, /__feature: "study_prep_planning", __timeoutMs: 45_000, __maxRetries: 1/);
  const loop = readFileSync(new URL("./agent-loop.js", import.meta.url), "utf8");
  assert.match(loop, /action: "agent_error"/, "a provider failure is recorded in the session's events");
});

test("a Study Prep practice is charged once: flat price, platform-paid generation", () => {
  const service = readFileSync(new URL("../exam-prep-service.js", import.meta.url), "utf8");
  assert.match(service, /\.\.\.\(prepaid \? \{ __payer: "platform" \} : \{\}\)/);
  assert.match(service, /kind: "diagnostic", prepaid \}/);
  assert.match(service, /kind: "retest", prepaid \}/);
  const wiring = readFileSync(new URL("./wiring.js", import.meta.url), "utf8");
  assert.match(wiring, /startExamPrepRun\(\{ learnerId, request, studyPrepTopicId, prepaid: true \}\)/);
  assert.match(wiring, /startExamPrepRetest\(\{ learnerId, runId, learnerConfirmedReady, prepaid: true \}\)/);
  // The standalone exam-prep route has no flat charge, so it stays metered.
  const route = readFileSync(new URL("../exam-prep-confidence.js", import.meta.url), "utf8");
  assert.doesNotMatch(route, /prepaid/);
});
