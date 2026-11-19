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
const { llmFacingTools, TOOL_DEFINITIONS, TOOL_ARGS } = await import("../tools/registry.js");

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

// The decision-maker and the loop live in the shared agent runtime (Phase 2);
// Study Prep's files configure them.
const RUNTIME_AGENT = new URL("../../agent-runtime/llm-agent.js", import.meta.url);
const RUNTIME_LOOP = new URL("../../agent-runtime/loop.js", import.meta.url);

test("replies are mapped back to registry names; the call is bounded and labelled", () => {
  const src = readFileSync(RUNTIME_AGENT, "utf8");
  assert.match(src, /name: providerToolName\(tool\.name\)/);
  assert.match(src, /toRegistry\.get\(call\.function\.name\)/);
  assert.match(src, /__feature: feature, __timeoutMs: timeoutMs, __maxRetries: maxRetries/);
  const wrapper = readFileSync(new URL("./llm-agent.js", import.meta.url), "utf8");
  assert.match(wrapper, /feature = "study_prep_planning", maxTokens = 1600/, "planning is billed as planning, 1600 tokens a decision");
  assert.match(wrapper, /feature, payer, ref, timeoutMs: 60_000, maxRetries: 1, maxTokens, think: true, talk: true/);
  assert.match(readFileSync(new URL("./wiring.js", import.meta.url), "utf8"), /feature: "study_prep_wake", maxTokens: 1200, ref: `study_prep:\$\{sessionId\}`,(?! payer)/, "a wake is billed to the learner, as part of their session");
  const loop = readFileSync(new URL("./agent-loop.js", import.meta.url), "utf8");
  assert.match(loop, /action: "agent_error"/, "a provider failure is recorded in the session's events");
});

test("a Study Prep practice is charged once: flat price, platform-paid generation", () => {
  const service = readFileSync(new URL("../exam-prep/exam-prep-service.js", import.meta.url), "utf8");
  assert.match(service, /\.\.\.\(prepaid \? \{ __payer: "platform" \} : \{\}\)/);
  assert.match(service, /kind: "diagnostic", prepaid \}/);
  assert.match(service, /kind: "retest", prepaid \}/);
  const wiring = readFileSync(new URL("./wiring.js", import.meta.url), "utf8");
  assert.match(wiring, /startExamPrepRun\(\{ learnerId, request, studyPrepTopicId, prepaid: true \}\)/);
  assert.match(wiring, /startExamPrepRetest\(\{ learnerId, runId, learnerConfirmedReady, prepaid: true \}\)/);
  // The standalone exam-prep route has no flat charge, so it stays metered.
  const route = readFileSync(new URL("../exam-prep/exam-prep-confidence.js", import.meta.url), "utf8");
  assert.doesNotMatch(route, /prepaid/);
});

test("every tool tells the model its arguments; planning tools take topic ids", () => {
  for (const t of TOOL_DEFINITIONS) {
    assert.equal(TOOL_ARGS[t.name]?.type, "object", `${t.name} has an argument schema`);
  }
  for (const name of ["propose_plan", "plan.validate", "session.replan"]) {
    assert.deepEqual(TOOL_ARGS[name].required, ["topics"]);
    assert.equal(TOOL_ARGS[name].properties.topics.type, "array");
  }
  assert.ok(TOOL_ARGS["syllabus.resolve"].properties.classLevel, "classLevel, the name execute() reads");
  assert.ok(llmFacingTools().every((t) => t.args?.type === "object"));
  const src = readFileSync(RUNTIME_AGENT, "utf8");
  assert.match(src, /args: \{ \.\.\.\(tool\.args \|\| \{ type: "object" \}\)/);
});

test("the agent knows its budget and its last step can only finish", () => {
  const runtimeLoop = readFileSync(RUNTIME_LOOP, "utf8");
  assert.match(runtimeLoop, /finalOnly: iteration === maxIterations \? finals : null/);
  const loop = readFileSync(new URL("./agent-loop.js", import.meta.url), "utf8");
  assert.match(loop, /finals \|\| \(contextSetName === "planning" \? \["propose_plan"\] : terminalActions\)/);
  const src = readFileSync(RUNTIME_AGENT, "utf8");
  assert.match(src, /finalOnly\.includes\(toRegistry\.get\(t\.function\.name\)\)/);
  assert.match(src, /Iteration \$\{iteration\} of \$\{maxIterations\}/);
});

for (const [file, name] of [["./routes.js", "UUID"], ["../exam-prep/exam-prep-service.js", "RUN_ID"]]) test(`${file} ${name} accepts real ids`, async () => {
  const { randomUUID } = await import("node:crypto");
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const pattern = new RegExp(`const ${name} = \\/(.+)\\/i;`).exec(src)?.[1];
  assert.ok(pattern, `${file} defines ${name}`);
  const UUID = new RegExp(pattern, "i");
  for (let i = 0; i < 20; i++) assert.ok(UUID.test(randomUUID()));
  assert.ok(!UUID.test("not-a-uuid"));
  assert.ok(!UUID.test(`${randomUUID()}0`));
});
