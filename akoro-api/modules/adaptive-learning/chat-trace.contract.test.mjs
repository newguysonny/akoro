import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CHAT_TOOL_DISPLAY, TRACE_LIMITS, chatToolDisplay, chatToolResultLine, createChatTrace, decisionNarration,
} from "./chat-trace.js";

const chatSource = await readFile(new URL("./chat.js", import.meta.url), "utf8");
const route = chatSource.slice(chatSource.indexOf('router.post("/agent"'));
const loop = chatSource.slice(chatSource.indexOf("async function runAgentToolLoop"), chatSource.indexOf('router.post("/agent"'));

test("every Agent Chat tool has learner-language display — no backend name ever reaches a row", () => {
  const toolNames = [...chatSource.matchAll(/^\s+name: "([a-z_]+)",$/gm)].map((match) => match[1]);
  assert.ok(toolNames.length >= 40, `expected the chat tool catalogue, found ${toolNames.length}`);
  for (const name of toolNames) {
    const display = CHAT_TOOL_DISPLAY[name];
    assert.ok(display, `${name} has no display entry`);
    assert.ok(!display.headline.includes("_") && !display.description.includes("_"), `${name} leaks a code name`);
    assert.ok(["research", "action"].includes(display.category));
  }
  // An unknown tool still renders neutrally, never as its raw name.
  assert.equal(chatToolDisplay("some_new_tool").headline, "Checking your study data");
});

test("result lines are counts and outcomes only — never raw tool data", () => {
  assert.deepEqual(chatToolResultLine({ goals: [{ title: "Pass WAEC Physics" }, { title: "B" }] }), { ok: true, result: "2 found" });
  assert.deepEqual(chatToolResultLine({ items: [] }), { ok: true, result: "Nothing found" });
  assert.deepEqual(chatToolResultLine({ success: false, error: "relation does not exist" }), { ok: false, result: "Couldn't complete this step" });
  assert.deepEqual(chatToolResultLine({ needsClarification: true, question: "Which subject?" }), { ok: true, result: "Needs one detail from you" });
  assert.deepEqual(chatToolResultLine({ taskId: "t1", title: "Revise" }), { ok: true, result: "Done" });
  const line = JSON.stringify(chatToolResultLine({ email: "ada@example.com", notes: ["secret note"] }));
  assert.doesNotMatch(line, /ada@example\.com|secret note/);
});

test("decision narration describes what the agent chose, in learner language", () => {
  const text = decisionNarration([
    { function: { name: "list_my_goals" } },
    { function: { name: "get_weak_topics" } },
  ]);
  assert.match(text, /checking your goals/);
  assert.match(text, /finding your weaker topics/);
  assert.doesNotMatch(text, /list_my_goals|get_weak_topics/);
  assert.match(decisionNarration([]), /writing your answer/);
});

test("the trace interleaves thinking, tools and activity, emits live events and stays bounded", () => {
  const events = [];
  let clock = 1_000;
  const trace = createChatTrace({ send: (event, data) => events.push([event, data]), now: () => clock });

  const think = trace.thinkStart(); clock += 1_200;
  trace.thinkEnd(think, "Next: checking your goals.");
  const row = trace.toolStart("list_my_goals"); clock += 80;
  trace.toolEnd(row, { goals: [1, 2, 3] });
  trace.activity("You have three active goals — let me check what's due.");
  const think2 = trace.thinkStart(); clock += 400;
  trace.thinkEnd(think2, decisionNarration([]));

  assert.deepEqual(events.map(([event]) => event), [
    "think_start", "think_end", "tool_start", "tool_end", "activity", "think_start", "think_end",
  ]);
  const blocks = trace.blocks();
  assert.deepEqual(blocks.map((block) => block.type), ["thinking", "tool", "activity", "thinking"]);
  assert.equal(blocks[0].ms, 1_200);
  assert.equal(blocks[1].headline, "Checking your goals");
  assert.equal(blocks[1].result, "3 found");
  assert.equal(blocks[1].ms, 80);
  assert.ok(!("tool" in blocks[1]), "the raw tool name is not stored in the learner trace");

  const many = createChatTrace();
  for (let index = 0; index < TRACE_LIMITS.MAX_BLOCKS + 25; index += 1) many.activity(`step ${index}`);
  assert.equal(many.blocks().length, TRACE_LIMITS.MAX_BLOCKS);
  assert.ok(many.activity("x".repeat(10_000)) === null || many.blocks().every((block) => block.text.length <= TRACE_LIMITS.MAX_TEXT_CHARS));
});

test("a failing send never breaks the turn", () => {
  const trace = createChatTrace({ send: () => { throw new Error("socket gone"); } });
  const id = trace.thinkStart();
  assert.doesNotThrow(() => trace.thinkEnd(id, "ok"));
});

test("the tool loop streams every step and is bounded by code, not the model", () => {
  assert.match(chatSource, /export const CHAT_TOOL_LOOP_MAX_ITERATIONS = 8;/);
  assert.match(loop, /iteration < CHAT_TOOL_LOOP_MAX_ITERATIONS/);
  assert.match(loop, /trace\?\.thinkStart\(\)/);
  assert.match(loop, /trace\.thinkEnd\(thinkId, decisionNarration\(calls\)\)/);
  assert.match(loop, /trace\?\.toolStart\(tool\)/);
  assert.match(loop, /trace\.toolEnd\(traceRow, toolResult\)/);
  assert.match(loop, /trace\?\.activity\(assistant\.content\)/);
});

test("stop (■) ends the turn between steps and while the answer streams", () => {
  // Only an explicit, owner-scoped stop ends a turn — a dropped connection does
  // not, so the client's same-turnId retry replays the real, complete answer.
  assert.doesNotMatch(route, /writableEnded\) aborted = true/);
  assert.match(chatSource, /router\.post\("\/agent\/stop"/);
  assert.match(chatSource, /activeTurnStops\.get\(turnStopKey\(req\.user\.id, turnId\)\)/);
  assert.match(route, /const isAborted = \(\) => Boolean\(stopEntry\?\.stop\);/);
  assert.match(loop, /if \(isAborted\(\)\) return \{ messages: transcript, toolExecutions: executions, aborted: true \}/);
  assert.match(route, /isAborted,\n\s+\}\);/);
  assert.match(route, /if \(!reply && !stopped\(\)\)/);
  assert.match(chatSource, /if \(isAborted\(\)\) break;/);
  assert.match(route, /STOPPED_REPLY/);
});

test("the reply trace is returned and stored for reload, and history tolerates the pending column", () => {
  assert.match(route, /trace: traceBlocks/);
  assert.match(route, /saveMessageTrace\(\{ messageId: persisted\?\.assistantMessageId/);
  assert.match(route, /saveMessageTrace\(\{ messageId: saved\?\.assistantMessageId/);
  assert.match(chatSource, /loadMessages\("id, role, text, created_at, trace"\)/);
  assert.match(chatSource, /loadMessages\("id, role, text, created_at"\)/);
});

// ── Think mode: real reasoning at every step and after tools ────────────────

test("Think mode streams the model's real reasoning into the step's row; it wins over narration", () => {
  const events = [];
  const trace = createChatTrace({ send: (event, data) => events.push([event, data]) });
  const id = trace.thinkStart();
  trace.thinkDelta(id, "The learner asks about goals.");
  trace.thinkDelta(id, "\n\nCheck them first.");
  const block = trace.thinkEnd(id, "Next: checking your goals…");
  assert.deepEqual(events.map(([event]) => event), ["think_start", "think_delta", "think_delta", "think_end"]);
  assert.equal(block.source, "reasoning");
  assert.equal(block.text, "The learner asks about goals.\n\nCheck them first.");
  // Without streamed reasoning, the row keeps the harness narration.
  const plain = createChatTrace();
  const other = plain.thinkStart();
  assert.equal(plain.thinkEnd(other, "Next: checking your goals…").source, undefined);
  // A delta for a closed row is ignored.
  plain.thinkDelta(other, "late");
  assert.equal(plain.blocks()[0].text, "Next: checking your goals…");
});

test("tool results reach the reasoning model: native items for decisions, developer notes for the answer", async () => {
  const { toResponsesInput, toResponsesTools } = await import("./responses-input.js");
  const transcript = [
    { role: "system", content: "doctrine" },
    { role: "user", content: "What are my goals?" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "list_my_goals", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_1", content: '{"success":true}' },
  ];
  const native = toResponsesInput(transcript, { native: true });
  assert.deepEqual(native.slice(2), [
    { type: "function_call", call_id: "call_1", name: "list_my_goals", arguments: "{}" },
    { type: "function_call_output", call_id: "call_1", output: '{"success":true}' },
  ]);
  assert.ok(native.every((item) => !("id" in item)), "no item ids — valid without reasoning items");
  const answer = toResponsesInput(transcript);
  assert.equal(answer.length, 3, "the empty tool-call message is dropped");
  assert.equal(answer[2].role, "developer");
  assert.match(answer[2].content[0].text, /^Akoro tool result \(list_my_goals\): \{"success":true\}$/);
  const [tool] = toResponsesTools([{ type: "function", function: { name: "x", description: "d", parameters: { type: "object" } } }]);
  assert.deepEqual(tool, { type: "function", name: "x", description: "d", parameters: { type: "object" }, strict: false });
});

test("Think mode reasons at every decision, falls back per turn, and reuses a final reasoned decision", () => {
  assert.match(loop, /let reasonDecisions = think;/);
  assert.match(loop, /await thinkDecision\(\{/);
  assert.match(loop, /onReasoning: \(text\) => \{ if \(thinkId\) trace\.thinkDelta\(thinkId, text\); \}/);
  assert.match(loop, /reasonDecisions = false;/);
  assert.match(loop, /model: OPENAI_MODEL,/);
  assert.match(loop, /finalText \? \{ finalText \} : \{\}/);
  assert.match(route, /think: isThink,/);
  assert.match(chatSource, /reasoning: \{ effort: THINK_DECISION_EFFORT, summary: "auto" \}/);
});

test("Think mode answers on the reasoning model even after tools ran", () => {
  // The old gate (`!prepared.toolExecutions.length`) sent every tool turn to
  // gpt-4o-mini, so Think almost never reasoned.
  assert.doesNotMatch(route, /isThink && !prepared\.toolExecutions\.length/);
  assert.match(route, /if \(!stopped\(\) && isThink && prepared\.finalText\)/);
  assert.match(route, /streamThinkWithResponses\(\{ send, messages: finalMessages, model: THINK_MODEL, trace, isAborted \}\)/);
  assert.match(route, /thinkOnce\(\{ messages: finalMessages, model: THINK_MODEL, trace \}\)/);
  // The answer's reasoning is a saved trace row too, not a loose event.
  assert.doesNotMatch(chatSource, /send\("thinking"/);
  assert.match(chatSource, /trace\.thinkDelta\(thinkId, text\)/);
});
