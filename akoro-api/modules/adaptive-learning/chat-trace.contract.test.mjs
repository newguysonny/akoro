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
    assert.ok(["research", "read", "action"].includes(display.category));
    // Every action has a past-tense change label for its change row.
    if (display.category === "action") assert.ok(display.done && !display.done.includes("_"), `${name} has no change label`);
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
  assert.match(loop, /closeThink\(decisionNarration\(calls\)\)/);
  assert.match(loop, /trace\?\.toolStart\(tool, input\)/);
  assert.match(loop, /trace\.toolEnd\(traceRow, toolResult\)/);
  // Words stream live as they are written; research mode buffers them.
  assert.match(loop, /trace\.activityDelta\(liveId, text\)/);
  assert.match(loop, /else if \(content\) trace\?\.activity\(content\)/);
  assert.match(route, /streamText: !isResearch,/);
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
  assert.match(route, /await saveTurn\(persisted\?\.assistantMessageId\)/);
  assert.match(route, /await saveTurn\(saved\?\.assistantMessageId\)/);
  assert.match(route, /saveMessageTrace\(\{ messageId, userId: req\.user\.id, trace: traceBlocks/);
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
  assert.match(loop, /onReasoning: \(text\) => \{ if \(thinkOpen\) trace\.thinkDelta\(thinkId, text\); \}/);
  assert.match(loop, /reasonDecisions = false;/);
  assert.match(chatSource, /async function streamDecision[\s\S]*?model: OPENAI_MODEL,/);
  assert.match(loop, /finalText \? \{ finalText, promoted: Boolean\(liveId\) \} : \{\}/);
  assert.match(route, /think: isThink,/);
  assert.match(chatSource, /reasoning: \{ effort: THINK_DECISION_EFFORT, summary: "auto" \}/);
});

test("Think mode answers on the reasoning model even after tools ran", () => {
  // The old gate (`!prepared.toolExecutions.length`) sent every tool turn to
  // gpt-4o-mini, so Think almost never reasoned.
  assert.doesNotMatch(route, /isThink && !prepared\.toolExecutions\.length/);
  assert.match(route, /if \(!stopped\(\) && prepared\.finalText\)/);
  assert.match(route, /if \(!prepared\.promoted\) send\("delta", \{ text: reply \}\)/);
  assert.match(route, /streamThinkWithResponses\(\{ send, messages: finalMessages, model: THINK_MODEL, trace, isAborted \}\)/);
  assert.match(route, /thinkOnce\(\{ messages: finalMessages, model: THINK_MODEL, trace \}\)/);
  // The answer's reasoning is a saved trace row too, not a loose event.
  assert.doesNotMatch(chatSource, /send\("thinking"/);
  assert.match(chatSource, /trace\.thinkDelta\(thinkId, text\)/);
});

// ── Found items, read groups, change rows, developer view ───────────────────

test("a research row shows a few short labels of what was found — never whole records", async () => {
  const { chatToolFoundItems } = await import("./chat-trace.js");
  assert.deepEqual(chatToolFoundItems({ goals: [{ id: "g1", title: "Pass WAEC Physics", notes: "private" }, { name: "Read daily" }, { id: "x" }] }),
    ["Pass WAEC Physics", "Read daily"]);
  assert.equal(chatToolFoundItems({ topics: Array.from({ length: 20 }, (_, i) => `Topic ${i}`) }).length, 6);
  assert.deepEqual(chatToolFoundItems({ ok: true }), []);
  assert.ok(chatToolFoundItems({ items: ["x".repeat(500)] })[0].length <= 80);
});

test("a successful action is a change row with its title and whitelisted fields only", async () => {
  const { chatToolChange } = await import("./chat-trace.js");
  const change = chatToolChange("create_task", { taskId: "t1", title: "Revise photosynthesis", internalScore: 9 }, { title: "x", due_at: "2026-10-12T19:00:00+01:00", priority: "high", secret: "no" });
  assert.deepEqual(change, {
    label: "Created a task", title: "Revise photosynthesis",
    fields: [{ label: "Due", value: "2026-10-12T19:00:00+01:00" }, { label: "Priority", value: "high" }],
  });
  assert.equal(chatToolChange("create_task", { error: "nope" }, {}), null, "a failed action is not a change");
  assert.equal(chatToolChange("create_task", { needsClarification: true }, {}), null);
  assert.equal(chatToolChange("list_my_goals", { goals: [] }, {}), null, "reads never make change rows");
});

test("the trace carries found items and changes; raw tool I/O only in developer mode and never stored", () => {
  const events = [];
  const dev = createChatTrace({ send: (event, data) => events.push([event, data]), developer: true });
  const row = dev.toolStart("create_goal", { title: "Score 80%" });
  const block = dev.toolEnd(row, { created: true, goalId: "g1", title: "Score 80%", targetDate: "2026-12-01" });
  assert.equal(block.change.label, "Saved a goal");
  assert.equal(events[0][1].raw.name, "create_goal");
  assert.match(events[0][1].raw.args, /Score 80%/);
  assert.match(events[1][1].raw.output, /"goalId": "g1"/);
  assert.ok(!("raw" in block), "raw I/O is never in the stored trace");
  assert.ok(!JSON.stringify(dev.blocks()).includes("goalId"));

  const plain = [];
  const learner = createChatTrace({ send: (event, data) => plain.push(data) });
  const read = learner.toolStart("list_my_goals", {});
  learner.toolEnd(read, { goals: [{ title: "A" }, { title: "B" }] });
  assert.ok(plain.every((data) => !("raw" in data)), "no raw I/O without developer mode");
  assert.deepEqual(learner.blocks()[0].items, ["A", "B"]);
  assert.equal(chatToolDisplay("read_blog_post").category, "read");
});

test("streamed words: promoted text moves to the reply, dropped text vanishes, ended text is kept with its line breaks", () => {
  const events = [];
  const trace = createChatTrace({ send: (event, data) => events.push([event, data]) });
  const kept = trace.activityStart();
  trace.activityDelta(kept, "Line one.\n\n");
  trace.activityDelta(kept, "Line two.");
  trace.activityEnd(kept, "Line one.\n\nLine two.");
  const answer = trace.activityStart();
  trace.activityDelta(answer, "The answer.");
  trace.activityPromote(answer);
  const failed = trace.activityStart();
  trace.activityDelta(failed, "half");
  trace.activityDrop(failed);
  assert.deepEqual(trace.blocks().map((block) => block.text), ["Line one.\n\nLine two."]);
  assert.deepEqual(events.map(([event]) => event), [
    "activity_start", "activity_delta", "activity_delta", "activity_end",
    "activity_start", "activity_delta", "activity_promote",
    "activity_start", "activity_delta", "activity_drop",
  ]);
});

test("after a Library search, a reader tool or the past papers, the agent says what it found (2026-10-19)", async () => {
  const { talkAfterTool, TALK_AFTER_TOOLS } = await import("./chat-trace.js");
  assert.deepEqual([...TALK_AFTER_TOOLS], ["search_my_library", "analyse_past_papers"]);
  assert.equal(talkAfterTool("search_my_library", {}, { records: [] }), "Nothing in your Library matches that.");
  assert.match(talkAfterTool("search_my_library", { tool: "flashcards" }, { records: [{ name: "BIO111 Cell Structure.pdf", tool: "flashcards" }] }), /^Found your \*\*BIO111 Cell Structure\.pdf\*\* — I'll open it in the reader's flashcards/);
  assert.equal(talkAfterTool("search_my_library", {}, { records: [{ name: "BIO111 notes", page: 12 }, { name: "BIO111 notes", page: 14 }] }), "Found 2 matches in your Library, starting with **BIO111 notes** (p.12, p.14).");
  assert.equal(talkAfterTool("analyse_past_papers", {}, { papers: 2, topics: [{ topic: "Ecology" }, { topic: "Cells" }] }), "I've looked across 2 past papers; the most recurring: **Ecology** and **Cells**.");
  assert.equal(talkAfterTool("check_progress", {}, {}), null, "other tools stay as they are");
  assert.equal(talkAfterTool("search_my_library", {}, { error: "x" }), null);
});
