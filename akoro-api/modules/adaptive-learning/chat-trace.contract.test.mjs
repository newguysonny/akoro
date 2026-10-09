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
