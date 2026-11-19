// Phase 22 Part E — the planning contract in Agent Chat: "done when" on the plan,
// the next-step decision from the intent step, and a starting plan for multi-step work.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyPlanUpdate, doneWhenOf, meetDoneWhen, nextLedger, renderDraftPlan, renderLedger, UPDATE_PLAN_TOOL } from "./taskLedger.js";
import { parseIntent, renderIntent, NEXT_STEPS } from "../intent/intentStep.js";
import { turnCorrections } from "./turnCheck.js";
import { normaliseScratchpad } from "../../agent-tools/conversation-context-validation.js";

const plan = { goal: "Revise for Friday", steps: [{ step: "Create the Friday task", status: "pending" }, { step: "Schedule a battle", status: "pending" }],
  done_when: [{ condition: "A revision task exists for Friday", tool: "create_task" }, { condition: "A battle is scheduled", tool: "challenge_agent" }] };

test("update_plan takes up to 3 done_when conditions, each with the tool that proves it", () => {
  const dw = UPDATE_PLAN_TOOL.input_schema.properties.done_when;
  assert.equal(dw.maxItems, 3);
  assert.deepEqual(dw.items.required, ["condition", "tool"]);
  const { ledger, result } = applyPlanUpdate(null, plan, []);
  assert.deepEqual(ledger.doneWhen.map((d) => d.met), [false, false]);
  assert.ok(result.left.includes("Not yet true: A battle is scheduled"));
});

test("a condition is met only by a successful call of its tool, and stays met", () => {
  const first = applyPlanUpdate(null, plan, [{ tool: "create_task", success: true }]).ledger;
  assert.deepEqual(first.doneWhen.map((d) => d.met), [true, false]);
  assert.deepEqual(meetDoneWhen(first.doneWhen, [{ tool: "challenge_agent", success: false }]).map((d) => d.met), [true, false], "a failed call proves nothing");
  const saved = nextLedger(null, first, "msg", [{ tool: "challenge_agent", success: true }]);
  assert.deepEqual(doneWhenOf(saved).map((d) => d.met), [true, true], "saved with this turn's calls counted");
  assert.match(renderLedger(saved), /Done when:\n- \[true\] A revision task exists for Friday \(create_task\)/);
});

test("the saved conditions pass the scratchpad validation (one done_when entry beside the tool results)", () => {
  const saved = nextLedger(null, applyPlanUpdate(null, plan, []).ledger, "msg", [1, 2, 3, 4].map((i) => ({ tool: `tool_${i}`, success: true })));
  const clean = normaliseScratchpad(saved);
  const dw = (clean.toolState || []).find((t) => t.tool === "done_when");
  assert.equal(dw?.items?.length, 2);
});

test("'all done' with a condition not yet true gets what is left — and nothing when all hold", () => {
  const ledger = applyPlanUpdate(null, plan, [{ tool: "create_task", success: true }]).ledger;
  ledger.plan = ledger.plan.map((s) => ({ ...s, status: "done" }));
  assert.deepEqual(turnCorrections("You're all set!", { executions: [], ledger }), ["Still to do: A battle is scheduled."]);
  assert.deepEqual(turnCorrections("You're all set!", { executions: [{ tool: "challenge_agent", success: true }], ledger }), []);
});

test("the next-step decision: ask only when something is missing; missing means ask (unless stop)", () => {
  const p = (j) => parseIntent(JSON.stringify({ want: "do it", kind: "action", multi_step: false, missing: [], ...j }));
  assert.deepEqual(NEXT_STEPS, ["proceed", "gather", "ask", "stop"]);
  assert.equal(p({ next: "ask" }).next, "proceed", "nothing missing → no question");
  assert.equal(p({ next: "proceed", missing: ["subject"] }).next, "ask");
  assert.equal(p({ next: "stop", missing: ["subject"] }).next, "stop");
  assert.equal(parseIntent(JSON.stringify({ want: "show my tasks", kind: "look_up", missing: [] })).next, "gather");
  assert.match(renderIntent(p({ next: "proceed" })), /Next: act now — call the tools it needs; don't ask first/);
  assert.match(renderIntent(p({ next: "stop" })), /Next: this is outside what you can do here, or needs a person/);
});

test("a multi-step request gets a starting plan to adopt; never over an open plan, never saved unless adopted", () => {
  const intent = parseIntent(JSON.stringify({ want: "task and battle", kind: "action", multi_step: true, missing: [], steps: ["Create the task", "Schedule the battle"] }));
  assert.deepEqual(intent.steps, ["Create the task", "Schedule the battle"]);
  assert.match(renderDraftPlan(intent.steps, null), /## A starting plan[\s\S]*1\. Create the task\n2\. Schedule the battle\nAdopt it with update_plan/);
  assert.equal(renderDraftPlan(intent.steps, { plan: [{ step: "Something open", status: "pending" }] }), "", "an open plan wins");
  assert.equal(renderDraftPlan(["One step"], null), "", "one step is not a plan");
  assert.equal(parseIntent(JSON.stringify({ want: "x", kind: "action", multi_step: false, steps: ["a", "b"] })).steps.length, 0);
});

test("wiring: the chat turn shows the starting plan for multi-step requests; the intent call has room for the steps", async () => {
  const chat = await readFile(new URL("./turn-answer.js", import.meta.url), "utf8");
  const intent = await readFile(new URL("../intent/intentStep.js", import.meta.url), "utf8");
  assert.match(chat, /\+ \(intent\?\.multiStep \? renderDraftPlan\(intent\.steps, conversation\?\.scratchpad \|\| null\) : ""\)/);
  assert.match(intent, /max_tokens: 320/);
});

test("plan first is enforced on the first step of a multi-step action turn — not when asking, stopping or with an open plan", async () => {
  const chat = await readFile(new URL("../chat.js", import.meta.url), "utf8");
  const loop = await readFile(new URL("./agent-loop.js", import.meta.url), "utf8");
  const toolRuntime = await readFile(new URL("./tool-runtime.js", import.meta.url), "utf8");
  const bench = await readFile(new URL("../../../lib/evals/benchmark.js", import.meta.url), "utf8");
  assert.match(toolRuntime, /export const shouldPlanFirst = \(intent\) => !!\(intent\?\.multiStep && intent\.next === "proceed" && \["action", "change"\]\.includes\(intent\.kind\)\);/);
  assert.match(loop, /const planStep = iteration === 0 && !requiredTool && planFirst && !\(Array\.isArray\(ledgerNow\?\.plan\)/);
  assert.match(loop, /planStep \? \{ type: "function", function: \{ name: UPDATE_PLAN_TOOL\.name \} \} : "auto"/);
  assert.match(chat, /planFirst: shouldPlanFirst\(intent\),/);
  assert.match(bench, /planFirst: shouldPlanFirst\(intent\),/, "the benchmark runs the turn as chat does");
});
