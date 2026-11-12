// Scenario K (§7.11.5, §7.11.4): the learner's pick reaches the Study Prep
// controller's decisions and the Teaching controller + persona replies, and
// each call is billed at the resolved model's price; locked roles stay locked;
// a Claude model never receives a forced tool_choice; a refusal becomes
// model_refusal with the fallback model's answer, never a crash.
// Providers are stand-ins (runWithProviders); nothing leaves the process.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
process.env.ANTHROPIC_API_KEY ||= "test";
process.env.AI_TELEMETRY = "on";
process.env.AI_TELEMETRY_DB = "off";
process.env.OPENCODE_API_KEY ||= "test";
// This file exercises call-site mechanics against the fixtures it was written
// with; the live catalogue (seven Go models, DeepSeek default) is covered by
// lib/modelRegistry.contract.test.mjs.
process.env.AI_MODELS = JSON.stringify([
  { id: "gpt-4o-mini", provider: "openai", apiModel: "gpt-4o-mini", price: { in: 0.15, out: 0.6 }, caps: { tools: true, stream: true, json: true }, selectable: true, enabled: true },
  { id: "claude-sonnet", provider: "anthropic", apiModel: "claude-sonnet-5-5", price: { in: 2, out: 10 }, caps: { tools: true, stream: true, json: true }, selectable: true, enabled: true },
]);
delete process.env.AI_MODEL_PICKER_ENABLED;
delete process.env.AI_MODEL_LOCKED_ROLES;
delete process.env.AI_FORCE_MODEL;

const { openai, runWithProviders, refusalOf } = await import("./aiModel.js");
const { makeAnthropicAdapter } = await import("./providers/anthropic.js");
const { usdCost } = await import("./aiPricing.js");
const { makeLlmAgent: studyPrepAgent } = await import("../modules/adaptive-learning/study-prep/llm-agent.js");
const { makeLlmAgent } = await import("../modules/agent-runtime/llm-agent.js");
const { runAgentLoop } = await import("../modules/agent-runtime/loop.js");
const { modelDecide, executeAgentTeachingTurn } = await import("../modules/adaptive-learning/teaching-session/controller.js");
const { guideTeach } = await import("../modules/adaptive-learning/teaching-session/guideTeacher.js");

const SONNET = { __learnerChoice: "claude-sonnet", __allowedModels: ["claude-sonnet", "deepseek"] };
const usage = { prompt_tokens: 1000, completion_tokens: 200 };

/** Stand-in providers that record which catalogue entry served each call, and the body it got. */
function recorder({ anthropicReply = null, openaiReply = null } = {}) {
  const calls = [];
  const toolReply = (body) => ({
    choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
      tool_calls: body.tools?.length ? [{ id: "c1", type: "function", function: { name: body.tools[0].function.name, arguments: JSON.stringify({ intent: "go", thinking: "t", message: "m", args: {}, move: "challenge" }) } }] : undefined,
      ...(body.tools?.length ? {} : { content: "A reply." }) } }],
    usage,
  });
  const make = (provider, custom) => ({
    async create(body, _opts, entry) {
      calls.push({ provider, entry: entry?.id || null, body });
      if (custom) return custom(body, entry, calls);
      if (body.stream) return (async function* () { yield { choices: [{ delta: { content: "Hello" } }] }; yield { choices: [], usage }; })();
      return toolReply(body);
    },
  });
  return { calls, providers: { openai: make("openai", openaiReply), anthropic: make("anthropic", anthropicReply) } };
}

/** The AI_CALL telemetry lines written while fn runs (the billed model and its cost). */
async function telemetry(fn) {
  const lines = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    const s = String(chunk);
    if (s.includes('"AI_CALL"')) { try { lines.push(JSON.parse(s)); } catch { /* not ours */ } return true; }
    return write(chunk, ...rest);
  };
  try { await fn(); } finally { process.stdout.write = write; }
  return lines;
}

test("Study Prep controller decisions use the learner's pick and are billed at its price", async () => {
  const r = recorder();
  const agent = studyPrepAgent({ system: "Plan.", learnerId: null, pick: async () => SONNET });
  const lines = await telemetry(() => runWithProviders(r.providers, () => agent.next({ iteration: 1, maxIterations: 3, goal: "Revise", observations: [] })));
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].entry, "claude-sonnet", "served by the picked model");
  assert.equal(r.calls[0].provider, "anthropic");
  const line = lines.find((l) => l.feature === "study_prep_planning");
  assert.equal(line.model, "claude-sonnet", "recorded (and charged) under the picked model");
  assert.equal(line.cost_usd, usdCost("claude-sonnet", 1000, 200, 0), "at the picked model's price");
  assert.notEqual(line.cost_usd, usdCost("gpt-4o-mini", 1000, 200, 0));
});

test("…the pick is asked before every decision, so a switch applies from the next one", async () => {
  const r = recorder();
  let pick = SONNET;
  const agent = studyPrepAgent({ system: "Plan.", pick: async () => pick });
  await runWithProviders(r.providers, () => agent.next({ iteration: 1, goal: "g", observations: [] }));
  pick = {};
  await runWithProviders(r.providers, () => agent.next({ iteration: 2, goal: "g", observations: [] }));
  assert.deepEqual(r.calls.map((c) => c.entry), ["claude-sonnet", "gpt-4o-mini"]);
});

test("a pick outside the payer's plan falls back to the role's model (no Sonnet bill)", async () => {
  const r = recorder();
  const agent = studyPrepAgent({ system: "Plan.", pick: async () => ({ __learnerChoice: "claude-sonnet", __allowedModels: ["deepseek"] }) });
  await runWithProviders(r.providers, () => agent.next({ iteration: 1, goal: "g", observations: [] }));
  assert.equal(r.calls[0].entry, "gpt-4o-mini");
});

const teachingContext = (modelPick) => ({
  mode: "teach_agent", topic: "Osmosis", humanMessage: "Water moves to where there is less water.", history: [], studentId: null, modelPick,
  mustKnowParts: ["Why water moves"], mustKnowIndex: 0, phaseLabels: {},
  orchestrator: { session: { phase: "PHASE_2", turnCount: 1, strategyChanges: 0 } },
  evidenceUpdate: { dialogue: { move: "clarify_core" }, current: {} },
});

test("Teaching controller decisions: the pick replaces the call site's default model", async () => {
  const r = recorder();
  const lines = await telemetry(() => runWithProviders(r.providers, () => modelDecide({ context: teachingContext(SONNET), observations: [] })));
  assert.equal(r.calls[0].entry, "claude-sonnet");
  assert.equal(lines.find((l) => l.feature === "teaching_controller")?.model, "claude-sonnet");
  const r2 = recorder();
  await runWithProviders(r2.providers, () => modelDecide({ context: teachingContext({}), observations: [] }));
  assert.equal(r2.calls[0].body.model, "gpt-4.1-mini", "no pick: the call site's own model, as before");
});

test("Teaching persona (NaNa) replies use the pick, streamed or not, billed at its price", async () => {
  for (const onChunk of [null, () => {}]) {
    const r = recorder();
    const lines = await telemetry(() => runWithProviders(r.providers, () => guideTeach({
      orchestrator: { studentId: null, session: {} }, humanMessage: "Help", topic: "Osmosis", part: "Why water moves", move: "explain",
      phaseLabel: "Must-know parts", evidence: {}, history: [], onChunk, modelPick: SONNET,
    })));
    assert.equal(r.calls[0].entry, "claude-sonnet", onChunk ? "streamed" : "plain");
    assert.equal(lines.find((l) => l.feature === "teaching_guide")?.model, "claude-sonnet");
  }
});

test("a teaching turn hands the pick to its decisions, NaNa and the protégé", async () => {
  const seen = {};
  const orchestrator = {
    studentId: "L1", teachingWorkflowId: "W1",
    session: { topic: "Osmosis", phase: "PHASE_2", mustKnowParts: ["Why water moves"], mustKnowIndex: 0, history: [], turnCount: 1, teachingMode: "teach_agent" },
    studentAgentRecord: { id: "a1" }, stats: { conceptsLearned: [], misconceptionsCleared: [] },
    studentAgent: { reply: async (...args) => { seen.protege = args[6]?.modelPick; return "Why?"; }, extractStudentKnowledge: async () => null },
  };
  const tool = (fn = () => {}) => ({ async execute(c) { await fn(c); } });
  const tools = {
    load_session_state: tool((c) => { c.state = { cognitive: { understanding: 0.4, confusion: 0.3, engagement: 0.6 } }; }),
    observe_teaching_evidence: tool((c) => { c.evidenceUpdate = { dialogue: { move: "clarify_core" }, current: {}, misconceptionRepaired: false }; }),
    assess_protege_understanding: tool((c) => { c.analysis = {}; }), persist_cognitive_state: tool(), record_verified_learning: tool(),
    coach_teaching_dialogue: tool((c) => { c.guideResult = { nextAction: "DIG_DEEPER" }; }), gate_teaching_progress: tool(),
  };
  let asked = null;
  await executeAgentTeachingTurn({
    orchestrator, humanMessage: "Water moves.", phaseLabels: {}, actionForDialogueMove: {}, tools,
    pickFor: async ({ orchestrator: o }) => { asked = o.teachingWorkflowId; return SONNET; },
    decide: async ({ context }) => { seen.decide = context.modelPick; return { tool: "protege_respond", args: { move: "challenge" } }; },
  });
  assert.equal(asked, "W1", "asked for the teaching workflow's pick");
  assert.deepEqual(seen.decide, SONNET);
  assert.deepEqual(seen.protege, SONNET);
});

test("the protégé's reply calls carry the persona role and the pick (source contract)", () => {
  const src = readFileSync(new URL("../modules/adaptive-learning/agents/student/agent.js", import.meta.url), "utf8");
  assert.match(src, /const pick = \{ __role: "persona", \.\.\.\(teachingContext\?\.modelPick \|\| \{\}\) \};/);
  assert.equal((src.match(/messages, \.\.\.pick,/g) || []).length, 2, "streamed and plain replies both");
});

test("locked roles stay locked: an assessor call with the pick keeps its own model", async () => {
  const r = recorder();
  await runWithProviders(r.providers, () => openai.chat.completions.create({ model: "gpt-4.1-mini", messages: [{ role: "user", content: "Judge." }], __role: "assessor", ...SONNET }));
  await runWithProviders(r.providers, () => openai.chat.completions.create({ messages: [{ role: "user", content: "Judge." }], __role: "evidence", ...SONNET }));
  assert.deepEqual(r.calls.map((c) => c.entry), ["gpt-4.1-mini", "gpt-4o-mini"]);
});

test("a Claude model never receives a forced tool_choice (the real adapter's request body)", async () => {
  const bodies = [];
  const client = { messages: { create: async (body) => { bodies.push(body); return { id: "m", model: body.model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: body.tools[0].name, input: { intent: "x", args: {} } }], usage: { input_tokens: 10, output_tokens: 5 } }; } } };
  const anthropic = makeAnthropicAdapter({ client });
  const agent = makeLlmAgent({ system: "s", catalogue: [{ name: "a.read", description: "read" }, { name: "a.act", description: "act" }], feature: "test", pick: async () => SONNET });
  const step = await runWithProviders({ anthropic }, () => agent.next({ iteration: 1, goal: "g", observations: [] }));
  for (const choice of ["required", { type: "function", function: { name: "a_act" } }, "auto", undefined]) {
    await runWithProviders({ anthropic }, () => openai.chat.completions.create({ model: "claude-sonnet", messages: [{ role: "user", content: "x" }], tools: [{ type: "function", function: { name: "a_act", parameters: { type: "object" } } }], ...(choice ? { tool_choice: choice } : {}) }));
  }
  assert.equal(step.tool, "a.read");
  assert.equal(bodies.length, 5);
  for (const b of bodies) {
    assert.ok(!b.tool_choice || b.tool_choice.type === "auto", `tool_choice ${JSON.stringify(b.tool_choice)}`);
    assert.ok(!["any", "tool"].includes(b.tool_choice?.type));
  }
  assert.match(bodies[0].system, /Call exactly one of the provided tools/, "the forced choice became an instruction");
});

test("a refusal becomes model_refusal: billed as it ran, answered once by the fallback model", async () => {
  const r = recorder({ anthropicReply: () => ({ choices: [{ index: 0, finish_reason: "content_filter", message: { role: "assistant", content: null, refusal: "Declined.", refusal_category: "cyber" } }], usage: { prompt_tokens: 50, completion_tokens: 0 } }) });
  const lines = await telemetry(async () => {
    const res = await runWithProviders(r.providers, () => openai.chat.completions.create({ model: "claude-sonnet", messages: [{ role: "user", content: "x" }], __feature: "refusal_test" }));
    assert.deepEqual(res.model_refusal, { model: "claude-sonnet", reason: "Declined.", category: "cyber", fallbackModel: "gpt-4o-mini" });
    assert.equal(res.choices[0].message.content, "A reply.", "the fallback's answer");
  });
  assert.deepEqual(r.calls.map((c) => c.entry), ["claude-sonnet", "gpt-4o-mini"]);
  assert.equal(r.calls[1].body.model, "gpt-4o-mini");
  assert.deepEqual(lines.filter((l) => l.feature === "refusal_test").map((l) => l.model), ["claude-sonnet", "gpt-4o-mini"], "each call recorded at its own model");
  assert.equal(refusalOf({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] }), null);
});

test("…the fallback obeys AI_FORCE_MODEL (a sandbox with OpenAI off retries on the forced model)", async () => {
  const { refusalFallbackFor } = await import("./aiModel.js");
  const { createModelRegistry } = await import("./modelRegistry.js");
  const env = { OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k", DEEPSEEK_API_KEY: "k", DEEPSEEK_MODEL: "deepseek-chat",
    AI_MODELS: JSON.stringify([
      { id: "deepseek", price: { in: 0.3, out: 1.2 } },
      { id: "gpt-4o-mini", provider: "openai", apiModel: "gpt-4o-mini", price: { in: 0.15, out: 0.6 }, caps: { tools: true, stream: true }, selectable: true, enabled: true },
      { id: "gpt-4.1", provider: "openai", apiModel: "gpt-4.1", price: { in: 2, out: 8 }, caps: { tools: true, stream: true }, selectable: true, enabled: true },
    ]), AI_FORCE_MODEL: "gpt-4.1",
    AI_MODEL_DEFAULT: "gpt-4o-mini", AI_MODEL_FALLBACK: "gpt-4o-mini" };
  const registry = createModelRegistry(env);
  const sonnet = registry.get("claude-sonnet");
  assert.equal(refusalFallbackFor(sonnet, { registry, env }).id, "gpt-4.1", "forced like every call");
  assert.equal(refusalFallbackFor(sonnet, { registry, env, noForce: true }).id, "gpt-4o-mini", "a check's stand-ins see the unforced choice");
  assert.equal(refusalFallbackFor(sonnet, { registry, env: { ...env, AI_FORCE_MODEL: "" } }).id, "gpt-4o-mini", "no force: the default");
  assert.equal(refusalFallbackFor(registry.get("deepseek"), { registry, env }).id, "gpt-4.1", "forced, never back to itself");
  // A check's stand-ins: noForce reaches the call itself.
  const r2 = recorder();
  await runWithProviders({ ...r2.providers, noForce: true }, () => openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "x" }] }));
  assert.deepEqual(r2.calls.map((c) => c.entry), ["gpt-4o-mini"]);
});

test("…and in an agent loop it is a model_refusal record and observation, not a malformed step or a crash", async () => {
  const both = recorder({
    anthropicReply: () => ({ choices: [{ index: 0, finish_reason: "content_filter", message: { role: "assistant", content: null, refusal: "No." } }], usage }),
    openaiReply: () => ({ choices: [{ index: 0, finish_reason: "content_filter", message: { role: "assistant", content: null, refusal: "No." } }], usage }),
  });
  const catalogue = [{ name: "a.done", description: "finish" }];
  const agent = makeLlmAgent({ system: "s", catalogue, feature: "test", pick: async () => SONNET });
  const records = [];
  const registry = { catalogue, validate: () => ({ ok: true }), execute: async () => ({ ok: true }) };
  const out = await runWithProviders(both.providers, () => runAgentLoop({ agent, registry, goal: "g", caps: { maxIterations: 2 }, terminalActions: ["a.done"], record: async (e) => { records.push(e); } }));
  assert.deepEqual(records.map((e) => e.kind), ["model_refusal", "model_refusal"]);
  assert.equal(records[0].model, "claude-sonnet");
  assert.equal(records[0].fallbackModel, "gpt-4o-mini");
  assert.equal(out.observations[0].code, "model_refusal", "the agent sees it");
  assert.ok(!records.some((e) => e.kind === "malformed"));

  const fine = recorder({ anthropicReply: () => ({ choices: [{ index: 0, finish_reason: "content_filter", message: { role: "assistant", content: null, refusal: "No." } }], usage }) });
  const recs = [];
  const done = await runWithProviders(fine.providers, () => runAgentLoop({ agent, registry, goal: "g", caps: { maxIterations: 2 }, terminalActions: ["a.done"], record: async (e) => { recs.push(e); } }));
  assert.equal(done.ended, "terminal", "the fallback's decision carried the step");
  assert.deepEqual(recs.map((e) => e.kind).slice(0, 2), ["model_refusal", "decision"]);
});

test("a streamed refusal: before any text the fallback's stream takes over; mid-reply it ends with the marker", async () => {
  const { withStreamRefusal } = await import("./aiModel.js");
  const entry = { id: "claude-sonnet" };
  const refused = async function* (pre = []) { for (const t of pre) yield { choices: [{ index: 0, delta: { content: t } }] }; yield { choices: [{ index: 0, delta: { refusal: "No." }, finish_reason: "content_filter" }] }; };
  const fb = async function* () { yield { choices: [{ index: 0, delta: { content: "Fallback " } }] }; yield { choices: [{ index: 0, delta: { content: "answer." }, finish_reason: "stop" }] }; };
  const collect = async (g) => { const out = []; for await (const c of g) out.push(c); return out; };

  const early = await collect(withStreamRefusal(refused(), { entry, target: () => ({ id: "gpt-4o-mini" }), second: async () => fb() }));
  assert.deepEqual(early[0].model_refusal, { model: "claude-sonnet", reason: "No.", fallbackModel: "gpt-4o-mini", streamed: true });
  assert.equal(early.slice(1).map((c) => c.choices[0]?.delta?.content || "").join(""), "Fallback answer.");

  const late = await collect(withStreamRefusal(refused(["Part of a reply"]), { entry, target: () => ({ id: "gpt-4o-mini" }), second: async () => { throw new Error("must not run"); } }));
  assert.equal(late[1].model_refusal.partial, true);
  assert.equal(late[1].model_refusal.fallbackModel, null, "text already shown: no second answer stitched on");
  assert.equal(late.at(-1).choices[0].finish_reason, "content_filter");
});
