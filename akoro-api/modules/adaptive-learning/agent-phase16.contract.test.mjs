/**
 * Grand Plan Phase 16 — Agent Chat plans, checks itself, recovers, keeps its
 * context and reads intent. The pure parts here; the evals (lib/evals/
 * agentChecks.js) score the same rules, and the model-dependent ones run when
 * there is an AI provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UPDATE_PLAN_TOOL, applyPlanUpdate, nextLedger, renderLedger, planOf, summaryMarkOf } from "./taskLedger.js";
import { actionClaims, actionClaimCorrection, ledgerLeftCorrection, turnCorrections } from "./turnCheck.js";
import { TOOL_FALLBACKS, failed, shouldRetry, recoveryHint } from "./toolRecovery.js";
import { fitDialogue, unsummarised, markOf, summariseEarlier, CONTEXT_LIMITS } from "./contextBudget.js";
import { needsIntentStep, parseIntent, renderIntent, runIntentStep } from "./intentStep.js";
import { normaliseScratchpad } from "../agent-tools/conversation-context-validation.js";

/* ── 1. The task ledger ─────────────────────────────────────────────────── */

test("ledger: a step is done only when a successful call this turn backs it", () => {
  const { ledger, result } = applyPlanUpdate(null, {
    goal: "Get ready for Friday's Biology test",
    steps: [
      { step: "Create a revision task for Thursday", status: "done", tool: "create_task" },
      { step: "Schedule a check-in for Friday morning", status: "done", tool: "schedule_chat_follow_up" },
      { step: "Quiz on osmosis", status: "done" },
      { step: "Pick the weakest topics", status: "pending" },
    ],
  }, [{ tool: "create_task", success: true }, { tool: "schedule_chat_follow_up", success: false }]);
  assert.deepEqual(ledger.plan.map((s) => s.status), ["done", "in_progress", "in_progress", "pending"]);
  assert.equal(result.heldBack.length, 2);
  assert.match(result.heldBack[0].why, /schedule_chat_follow_up hasn't succeeded/);
  assert.match(result.heldBack[1].why, /no tool named/);
  assert.deepEqual(result.left, ["Schedule a check-in for Friday morning", "Quiz on osmosis", "Pick the weakest topics"]);
});

test("ledger: a step done in an earlier turn stays done; the goal carries over", () => {
  const prev = { goal: "Revise Chemistry", plan: [{ step: "Make a study plan", status: "completed", tool: "start_study_prep_session" }] };
  const { ledger } = applyPlanUpdate(prev, { steps: [{ step: "Make a study plan", status: "done" }, { step: "Book a battle", status: "pending" }] }, []);
  assert.equal(ledger.goal, "Revise Chemistry");
  assert.equal(ledger.plan[0].status, "done");
});

test("ledger: saved in the scratchpad's own shape, and the stored row passes its validation", () => {
  const { ledger } = applyPlanUpdate(null, { goal: "g", steps: [{ step: "a", status: "done", tool: "create_task" }, { step: "b", status: "pending" }] }, [{ tool: "create_task", success: true, sideEffecting: true }]);
  const saved = nextLedger(null, { ...ledger, progressSummary: "earlier", summaryMark: "0123456789abcdef" }, "msg", [{ tool: "create_task", success: true, sideEffecting: true }]);
  assert.deepEqual(saved.plan, [{ step: "a", status: "completed", tool: "create_task" }, { step: "b", status: "pending" }]);
  assert.deepEqual(saved.nextSteps, ["b"]);
  const stored = normaliseScratchpad(saved);
  assert.equal(stored.plan[0].tool, "create_task");
  assert.equal(summaryMarkOf(stored), "0123456789abcdef", "the summary mark survives the round trip");
  assert.deepEqual(planOf(stored).map((s) => s.status), ["done", "pending"], "completed reads back as done");
});

test("ledger: without a plan of the model's own, nothing is invented", () => {
  const saved = nextLedger(null, null, "What is osmosis?", [{ tool: "search_my_library", success: true }]);
  assert.deepEqual(saved.plan, []);
  assert.equal(saved.goal, "What is osmosis?");
  assert.deepEqual(saved.completed, ["Ran search my library."]);
  assert.doesNotMatch(JSON.stringify(saved), /Address the current learner request/);
});

test("ledger: shown every turn with its rule", () => {
  const text = renderLedger({ goal: "g", plan: [{ step: "a", status: "completed", tool: "create_task" }, { step: "b", status: "pending" }] });
  assert.match(text, /## Task ledger/);
  assert.match(text, /- \[done\] a \(create_task\)/);
  assert.match(text, /call update_plan first; mark a step done only after a tool call for it succeeded/);
  assert.equal(UPDATE_PLAN_TOOL.input_schema.properties.steps.maxItems, 8);
});

/* ── 2. The end-of-turn check ───────────────────────────────────────────── */

test("check: a claimed change with no successful change this turn is corrected", () => {
  assert.match(actionClaimCorrection("Done! I've created a revision task for Thursday.", []), /didn't actually make that change/);
  assert.equal(actionClaimCorrection("I've created a revision task for Thursday.", [{ tool: "create_task", success: true, sideEffecting: true }]), null);
  assert.match(actionClaimCorrection("Your task has been deleted.", [{ tool: "delete_task_tool", success: true, sideEffecting: true, confirm: { confirmationId: "c1" } }]), /tap \*\*Confirm\*\*/);
});

test("check: offers, questions and plans are not claims", () => {
  for (const s of ["I can create a task for Thursday if you like.", "Shall I schedule it for Friday?", "Once you confirm, I'll delete them.", "Want me to set up a battle?"]) {
    assert.deepEqual(actionClaims(s), [], s);
  }
});

test("check: 'all done' while the ledger has steps left gets what's left", () => {
  const ledger = { plan: [{ step: "Create the task", status: "completed" }, { step: "Book a battle", status: "pending" }] };
  assert.equal(ledgerLeftCorrection("You're all set!", ledger), "Still to do: Book a battle.");
  assert.equal(ledgerLeftCorrection("You're all set!", { plan: [{ step: "x", status: "completed" }] }), null);
  assert.deepEqual(turnCorrections("Here's what osmosis is.", { executions: [], ledger }), []);
});

/* ── 3. Recovery ────────────────────────────────────────────────────────── */

test("recovery: a temporary failure is retried once; a change only when it never ran", () => {
  assert.equal(shouldRetry("search_my_library", { success: false, error: "The search timed out — try again" }), true);
  assert.equal(shouldRetry("search_my_library", { success: false, error: "No such folder" }), false);
  assert.equal(shouldRetry("create_task", { success: false, error: "timed out" }, { sideEffecting: true }), false, "may have run — never sent twice");
  assert.equal(shouldRetry("create_task", { success: false, error: "The service is unavailable (503)" }, { sideEffecting: true }), true);
  assert.equal(failed({ success: true }), false);
});

test("recovery: the documented alternative, else say it plainly", () => {
  assert.match(recoveryHint("search_my_library", { success: false, error: "x" }).next, /Try search_my_study_knowledge/);
  assert.match(recoveryHint("create_task", { success: false, error: "x" }, { retried: true }).next, /failed twice\. Tell the learner plainly/);
  assert.match(recoveryHint("search_my_library", { success: false }, { offered: ["create_task"] }).next, /Tell the learner plainly/, "an alternative not offered isn't suggested");
});

test("recovery: every fallback is a real read tool of the chat", () => {
  const chat = readFileSync(new URL("./chat.js", import.meta.url), "utf8");
  const side = chat.slice(chat.indexOf("export const SIDE_EFFECT_TOOLS"), chat.indexOf("export const isSideEffectingAction"));
  for (const [from, to] of Object.entries(TOOL_FALLBACKS)) {
    assert.match(chat, new RegExp(`name: "${to}"`), `${to} exists`);
    assert.match(chat, new RegExp(`name: "${from}"`), `${from} exists`);
    assert.doesNotMatch(side, new RegExp(`"${to}"`), `${to} changes nothing`);
  }
});

/* ── 4. The context budget ──────────────────────────────────────────────── */

test("budget: the newest messages that fit; the rest goes to the summary", () => {
  const msgs = Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `message ${i} ${"x".repeat(4000)}` }));
  const { kept, dropped } = fitDialogue(msgs, { systemText: "s".repeat(80_000) });
  assert.ok(kept.length < 24 && kept.length > 0);
  assert.equal(kept.length + dropped.length, 24);
  assert.equal(kept.at(-1), msgs.at(-1), "the newest stays");
  const short = fitDialogue(msgs.map((m) => ({ ...m, content: "hi" })));
  assert.equal(short.kept.length, CONTEXT_LIMITS.MAX_MESSAGES, "at most 16, so what falls out of the app's 24 is summarised first");
});

test("budget: messages already summarised aren't summarised again", async () => {
  const msgs = Array.from({ length: 6 }, (_, i) => ({ role: "user", content: `m${i}` }));
  assert.deepEqual(unsummarised(msgs, markOf(msgs[3])), msgs.slice(4));
  assert.deepEqual(unsummarised(msgs, null), msgs);
  let calls = 0;
  const create = async () => { calls += 1; return { choices: [{ message: { content: "The learner is revising osmosis." } }] }; };
  const out = await summariseEarlier({ previous: "", mark: null, dropped: msgs, create });
  assert.equal(out.summary, "The learner is revising osmosis.");
  assert.equal(out.mark, markOf(msgs[5]));
  assert.equal(await summariseEarlier({ previous: out.summary, mark: out.mark, dropped: msgs, create }), null);
  assert.equal(calls, 1);
  assert.equal(await summariseEarlier({ dropped: msgs, create: async () => { throw new Error("402"); } }), null, "no model → the old summary stands");
});

/* ── 5. The intent step ─────────────────────────────────────────────────── */

test("intent: read, cleaned, shown; greetings skip the call; failures pass through", async () => {
  assert.equal(needsIntentStep("thanks!"), false);
  assert.equal(needsIntentStep("Make me a revision plan for Biology and set a task for Friday"), true);
  const i = parseIntent('{"want":"A Biology revision plan and a Friday task","kind":"action","multi_step":true,"missing":["which topics"]}');
  assert.deepEqual(i, { want: "A Biology revision plan and a Friday task", kind: "action", multiStep: true, missing: ["which topics"] });
  assert.equal(parseIntent('{"want":"x","kind":"hack"}'), null);
  assert.match(renderIntent(i), /call update_plan with the steps first/);
  assert.match(renderIntent(i), /Not said yet: which topics/);
  assert.equal(await runIntentStep({ message: "Make me a plan for Biology now", create: async () => { throw new Error("402"); } }), null);
});

/* ── Wiring ─────────────────────────────────────────────────────────────── */

test("the chat turn uses all five", () => {
  const chat = readFileSync(new URL("./chat.js", import.meta.url), "utf8");
  assert.match(chat, /if \(tool === UPDATE_PLAN_TOOL\.name\) \{[\s\S]{0,300}applyPlanUpdate\(ledgerNow, input, executions\)/);
  assert.match(chat, /scratchpad: nextLedger\(ledgerIn, prepared\.ledger \|\| null, userMessage, prepared\.toolExecutions\)/);
  assert.match(chat, /for \(const line of turnCorrections\(reply, \{ executions: prepared\.toolExecutions, ledger: prepared\.ledger \|\| ledgerIn \}\)\)/);
  assert.match(chat, /if \(shouldRetry\(tool, toolResult, \{ sideEffecting: isSideEffecting\(tool, input\) \}\)\)/);
  assert.match(chat, /toolResult = \{ \.\.\.toolResult, recovery: hint\.next \}/);
  assert.match(chat, /const fit = fitDialogue\(dialogue,/);
  assert.match(chat, /messages: \[\.\.\.fit\.kept, \{ role: "user", content: userContent \}\]/);
  assert.match(chat, /renderIntent\(intent\)/);
  // The turn's short waits live in the modules; the calls themselves get a long SDK limit, so a slow
  // provider is never counted as an outage by the shared breaker (an SDK timeout counts; circuitBreaker.js).
  assert.match(chat, /__feature: "chat_intent", __userId: req\.user\.id, __timeoutMs: 45_000/);
  assert.match(chat, /__feature: "chat_summary", __userId: req\.user\.id, __timeoutMs: 45_000/);
  assert.doesNotMatch(chat, /function nextScratchpad|Address the current learner request/);
});
