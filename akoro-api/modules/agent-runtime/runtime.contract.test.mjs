// The shared agent runtime (Grand Plan §7.2, Phase 2) with stub agents — no
// model in the test path: the iteration cap, timeout → fallback, malformed →
// recorded and moved on from, terminal stop, stop codes, the tool-call cap,
// the generic checks as observations, and the persona level.
import assert from "node:assert/strict";
import test from "node:test";
import { DecisionTimeout, runAgentLoop } from "./loop.js";
import { argsProblem, bindRegistry } from "./tools.js";
import { capsFor, WORKFLOW_CAPS } from "./caps.js";

const script = (steps) => { let i = 0; return { calls: 0, async next(step) { this.calls += 1; this.last = step; const s = steps[Math.min(i++, steps.length - 1)]; return typeof s === "function" ? s(step) : s; } }; };
const recorder = () => { const log = []; return { log, record: async (e) => { log.push(e); } }; };

function toyRegistry({ handlers: extra = {} } = {}) {
  const calls = [];
  const definitions = [
    { name: "notes.read", level: "read", description: "Read the notes", display: { headline: "Reading your notes", description: "What you wrote" } },
    { name: "plan.make", level: "propose", description: "Make a plan" },
    { name: "wallet.spend", level: "execute", description: "Spend coins" },
    { name: "tutor.say", level: "persona", description: "The tutor speaks" },
  ];
  const args = {
    "plan.make": { type: "object", properties: { topics: { type: "array", items: { type: "string" } } }, required: ["topics"] },
    "wallet.spend": { type: "object", properties: { coins: { type: "integer" }, mode: { type: "string", enum: ["fast", "slow"] } }, required: ["coins"] },
  };
  const handlers = {
    "notes.read": async () => { calls.push("notes.read"); return { notes: ["cells"] }; },
    "plan.make": async (a) => { calls.push("plan.make"); return { planned: a.topics.length }; },
    "wallet.spend": async () => { calls.push("wallet.spend"); throw Object.assign(new Error("No coins"), { code: "insufficient_balance" }); },
    "tutor.say": async () => { calls.push("tutor.say"); return "Well done."; },
    ...extra,
  };
  // A workflow names the policy its agent's changes run under (Phase 18 item 6).
  return { calls, registry: bindRegistry({ definitions, args, harnessOnly: ["wallet.charge"], handlers, basis: { basis: "inferred", rule: "workflow:toy" } }) };
}

const caps = { maxIterations: 4, maxToolCalls: 10, decisionTimeoutMs: 200 };

test("caps are per workflow and code constants", () => {
  assert.equal(WORKFLOW_CAPS.study_prep.maxIterations, 6);
  assert.equal(WORKFLOW_CAPS.study_prep.maxToolCalls, 40);
  assert.equal(WORKFLOW_CAPS.teaching.maxIterations, 3);
  assert.equal(WORKFLOW_CAPS.teaching.onTimeout, "fallback");
  assert.equal(capsFor("practice", { maxIterations: 2 }).maxIterations, 2);
  assert.throws(() => capsFor("made_up"), /No caps/);
  assert.ok(Object.isFrozen(WORKFLOW_CAPS.study_prep));
});

test("a terminal action ends the step once it succeeds", async () => {
  const { registry, calls } = toyRegistry();
  const agent = script([{ tool: "notes.read", args: {} }, { tool: "plan.make", action: "plan.make", args: { topics: ["a", "b"] }, intent: "Weakest first." }]);
  const { log, record } = recorder();
  const out = await runAgentLoop({ agent, registry, goal: "g", caps, terminalActions: ["plan.make"], record });
  assert.equal(out.ended, "terminal");
  assert.equal(out.terminal, "plan.make");
  assert.equal(out.iterations, 2);
  assert.deepEqual(calls, ["notes.read", "plan.make"]);
  assert.deepEqual(log.map((e) => e.kind), ["decision", "observation", "decision", "observation"]);
  assert.deepEqual(out.observations.map((o) => o.tool), ["notes.read", "plan.make"]);
});

test("the iteration cap: no terminal action → the workflow's cap policy runs, honestly", async () => {
  const { registry } = toyRegistry();
  let capped = null;
  const agent = script([{ tool: "notes.read", args: {} }]);
  const out = await runAgentLoop({ agent, registry, goal: "g", caps, terminalActions: ["plan.make"], onLoopCap: async (info) => { capped = info; } });
  assert.equal(out.ended, "agent_loop_cap");
  assert.equal(out.iterations, 4);
  assert.deepEqual(capped, { iterations: 4 });
  // The last iteration offered only what ends the step.
  assert.deepEqual(agent.last.finalOnly, ["plan.make"]);
});

test("a decision timeout falls back where the workflow has a fallback", async () => {
  const { registry } = toyRegistry();
  const { log, record } = recorder();
  const agent = { next: () => new Promise(() => {}) };   // never answers
  const out = await runAgentLoop({ agent, registry, goal: "g", caps: { ...caps, decisionTimeoutMs: 30 }, record,
    fallback: async ({ iteration }) => ({ step: "ask_a_simple_question", at: iteration }) });
  assert.equal(out.ended, "fallback");
  assert.deepEqual(out.fallback, { step: "ask_a_simple_question", at: 1 });
  assert.equal(log[0].kind, "timeout");
});

test("…and is recorded as an agent error, then thrown, where it has none", async () => {
  const { registry } = toyRegistry();
  const { log, record } = recorder();
  const agent = { next: () => new Promise(() => {}) };
  await assert.rejects(() => runAgentLoop({ agent, registry, goal: "g", caps: { ...caps, decisionTimeoutMs: 30 }, record }), (e) => e instanceof DecisionTimeout);
  assert.equal(log[0].kind, "agent_error");
  // A provider failure the same way.
  const failing = { next: async () => { throw new Error("provider 500"); } };
  const { log: log2, record: record2 } = recorder();
  await assert.rejects(() => runAgentLoop({ agent: failing, registry, goal: "g", caps, record: record2 }), /provider 500/);
  assert.deepEqual(log2.map((e) => [e.kind, e.reason]), [["agent_error", "provider 500"]]);
});

test("a malformed decision is recorded and the loop moves on — it never crashes", async () => {
  const { registry } = toyRegistry();
  const { log, record } = recorder();
  const agent = script([{}, null, { tool: "plan.make", args: { topics: ["a"] } }]);
  const out = await runAgentLoop({ agent, registry, goal: "g", caps, terminalActions: ["plan.make"], record });
  assert.equal(out.ended, "terminal");
  assert.equal(out.iterations, 3);
  assert.deepEqual(log.slice(0, 2).map((e) => e.kind), ["malformed", "malformed"]);
});

test("the generic checks reject as observations: unknown tool, bad arguments — and the handler never runs", async () => {
  const { registry, calls } = toyRegistry();
  const agent = script([
    { tool: "wallet.charge", args: {} },                       // harness-only
    { tool: "made.up", args: {} },                             // unknown
    { tool: "plan.make", args: {} },                           // missing required
    { tool: "plan.make", args: { topics: "cells" } },          // wrong type
    { tool: "plan.make", args: { topics: ["cells"], extra: 1 } },
  ]);
  const out = await runAgentLoop({ agent, registry, goal: "g", caps: { ...caps, maxIterations: 5 }, terminalActions: ["plan.make"] });
  assert.deepEqual(out.observations.slice(0, 4).map((o) => o.code), ["tool_not_permitted", "tool_not_permitted", "tool_schema_invalid", "tool_schema_invalid"]);
  assert.equal(out.ended, "terminal", "an extra key is ignored, not rejected");
  assert.deepEqual(calls, ["plan.make"], "nothing ran until the call was valid");
});

test("a stop code ends the step; the agent still sees the rejection", async () => {
  const { registry } = toyRegistry();
  const agent = script([{ tool: "wallet.spend", args: { coins: 2 } }, { tool: "plan.make", args: { topics: ["a"] } }]);
  const out = await runAgentLoop({ agent, registry, goal: "g", caps, terminalActions: ["plan.make"], stopCodes: ["insufficient_balance"] });
  assert.equal(out.ended, "stop:insufficient_balance");
  assert.equal(out.observations[0].code, "insufficient_balance");
});

test("the tool-call cap ends the step before the call over it runs", async () => {
  const { registry, calls } = toyRegistry();
  let capped = false;
  const agent = script([{ tool: "notes.read", args: {} }]);
  const out = await runAgentLoop({ agent, registry, goal: "g", caps: { ...caps, maxToolCalls: 2 }, onToolCallCap: async () => { capped = true; } });
  assert.equal(out.ended, "tool_call_cap");
  assert.equal(capped, true);
  assert.equal(calls.length, 2);
});

test("a persona speaks or judges and never moves state — its output is marked as such", async () => {
  const { registry } = toyRegistry();
  assert.deepEqual(await registry.execute("tutor.say", {}), { persona: true, text: "Well done." });
  assert.deepEqual(registry.display("notes.read"), { headline: "Reading your notes", description: "What you wrote" });
  assert.ok(registry.display("plan.make").headline, "a tool without its own text still gets learner language");
  assert.throws(() => bindRegistry({ definitions: [{ name: "x", level: "boss", description: "?" }], handlers: {} }), /unknown level/);
  assert.throws(() => bindRegistry({ definitions: [{ name: "wallet.charge", level: "execute", description: "?" }], harnessOnly: ["wallet.charge"], handlers: {} }), /harness-only/);
});

test("argsProblem: required, types, enums, list items; lenient on extra keys", () => {
  const schema = { type: "object", properties: { n: { type: "integer" }, m: { type: "string", enum: ["a", "b"] }, l: { type: "array", items: { type: "string" } } }, required: ["n"] };
  assert.equal(argsProblem(schema, { n: 1 }), null);
  assert.match(argsProblem(schema, {}), /"n" is required/);
  assert.match(argsProblem(schema, { n: 1.5 }), /integer/);
  assert.match(argsProblem(schema, { n: 1, m: "c" }), /one of a, b/);
  assert.match(argsProblem(schema, { n: 1, l: ["x", 2] }), /item must be a string/);
  assert.equal(argsProblem(schema, { n: 1, other: true }), null);
  assert.match(argsProblem(schema, "nope"), /object/);
});

test("a workflow's own checks plug in after the generic ones", async () => {
  const definitions = [{ name: "teach.start", level: "propose", description: "Start teaching" }];
  let state = "planning";
  const registry = bindRegistry({ definitions, handlers: { "teach.start": async () => ({ started: true }) }, basis: { basis: "inferred", rule: "workflow:teaching" },
    checks: [(name) => (state !== "ready" ? { code: "operation_not_permitted", message: `${name} is not allowed while ${state}` } : null)] });
  assert.deepEqual(registry.validate("teach.start", {}), { ok: false, code: "operation_not_permitted", message: "teach.start is not allowed while planning" });
  state = "ready";
  assert.deepEqual(registry.validate("teach.start", {}), { ok: true });
  // Unknown names still fail the generic check first.
  assert.equal(registry.validate("nope", {}).code, "tool_not_permitted");
});

test("harness core: a workflow's checks run in order; the first failure is logged, then rejected with its code and HTTP status", async () => {
  const { HarnessRejection, createChecker, createRejector, stateIs } = await import("./harness.js");
  const logged = [];
  const reject = createRejector({ httpFor: { invalid_state_transition: 409, plan_too_large: 422 }, onReject: async (s, code, facts) => logged.push([s.id, code, facts]) });
  const check = createChecker({ reject, checks: {
    start: [stateIs("active", "Not active"), stateIs("open", "Topic closed", { key: "topic" }), (ctx) => (ctx.n > 3 ? { code: "plan_too_large", message: "Too many", facts: { n: ctx.n } } : null)],
  } });
  assert.equal(await check("start", { session: { id: "s", status: "active" }, topic: { status: "open" }, n: 1 }), null);
  assert.equal(await check("unknown_action", {}), null, "an action with no checks passes");
  await assert.rejects(check("start", { session: { id: "s", status: "paused" }, topic: { status: "open" } }),
    (e) => e instanceof HarnessRejection && e.code === "invalid_state_transition" && e.httpStatus === 409 && e.message === "Not active");
  await assert.rejects(check("start", { session: { id: "s", status: "active" }, topic: { status: "done" } }), { message: "Topic closed" });
  await assert.rejects(check("start", { session: { id: "s", status: "active" }, topic: { status: "open" }, n: 9 }), (e) => e.httpStatus === 422);
  assert.deepEqual(logged.map((l) => l[1]), ["invalid_state_transition", "invalid_state_transition", "plan_too_large"]);
  assert.deepEqual(logged[2][2], { n: 9 });
  await assert.rejects(createRejector()(null, "x", "no subject"), (e) => e.httpStatus === 409, "no subject: nothing logged, still rejects");
});

test("think: the agent's notes come back to it on its next step, never into what is recorded", async () => {
  const seen = [];
  const recorded = [];
  const agent = { next: async ({ observations }) => { seen.push(observations.map((o) => o.yourNotes || null)); return seen.length < 3 ? { tool: "read", args: {}, intent: "Read.", thinking: `note ${seen.length}` } : { action: "finish", args: {}, intent: "Done.", thinking: "final" }; } };
  const registry = { catalogue: [], execute: async () => ({ ok: true }) };
  await runAgentLoop({ agent, registry, goal: "g", caps: { maxIterations: 5 }, terminalActions: ["finish"], record: async (e) => recorded.push(JSON.stringify(e.kind === "decision" ? { tool: e.step.tool, args: e.step.args } : e)) });
  assert.deepEqual(seen, [[], ["note 1"], ["note 1", "note 2"]]);
  assert.ok(recorded.every((r) => !r.includes("note ")), "notes never reach the recorded log through what the workflow stores");
});

test("fact filter: a sentence with a number the agent never saw is dropped; the rest is kept, capped", async () => {
  const { keepFactual } = await import("./factFilter.js");
  const seen = JSON.stringify({ topics: 6, found: true, weakest: "Cells 21" });
  assert.equal(keepFactual("I found 6 topics. Your weakest is Cells at 21%. You scored 90% last week.", seen), "I found 6 topics. Your weakest is Cells at 21%.");
  assert.equal(keepFactual("Next I'll check what you already know.", ""), "Next I'll check what you already know.");
  assert.equal(keepFactual("You got 7 of 10.", seen), "");
  assert.ok(keepFactual("word ".repeat(200), "", { max: 50 }).length <= 50);
});
