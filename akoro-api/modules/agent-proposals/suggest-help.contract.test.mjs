/**
 * suggest-help.contract.test.mjs — the suggest_help redesign (2026-11-14):
 *  1. the repeated-computation sweep lands in the Suggestions LIST
 *     (agent_suggestions rows — unchanged, asserted so it cannot drift);
 *  2. suggest_help filings land as a NEW CHAT (priority), never in the list;
 *  3. the in-turn tool carries concrete filing triggers, not "use sparingly";
 *  4. a nightly chat sweep (21:30 Africa/Lagos, the planner window) reviews
 *     the day's chats and files through the same new-chat delivery.
 */
import "../../test-env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const chat = read("../adaptive-learning/chat.js");
const toolCatalogue = read("../adaptive-learning/chat/tool-catalogue-core.js");
const trace = read("../adaptive-learning/chat/chat-trace.js");
const resumeQueue = read("../self-tooling/resumeQueue.js");
const toolSuggestions = read("../self-tooling/toolSuggestions.js");
const suggestHelp = read("./suggestHelp.js");
const sweep = read("./suggestHelpSweep.js");

test("the tools sweep still lands in the Suggestions list", () => {
  assert.match(toolSuggestions, /from\("agent_suggestions"\)\.insert/);
  assert.match(toolSuggestions, /kind: "conversation"/);
  assert.match(toolSuggestions, /source: "proactive"/);
});

test("the in-turn tool describes the new-chat filing with concrete triggers", () => {
  assert.match(toolCatalogue, /Open a NEW CHAT for the learner with one proactive idea/);
  assert.match(toolCatalogue, /not in the Suggestions list, so it gets priority/);
  assert.match(toolCatalogue, /something they put off or turned down for now but still need/);
  assert.doesNotMatch(toolCatalogue, /Use sparingly — at most one per reply/);
});

test("the in-turn handler delivers a new chat, not a list row", () => {
  const block = chat.slice(chat.indexOf('case "suggest_help"'), chat.indexOf('case "schedule_chat_follow_up"'));
  assert.match(block, /openSuggestHelpChat\(studentId/);
  assert.match(block, /delivered: "new_chat"/);
  assert.doesNotMatch(block, /agent_suggestions"\)\.insert/);
});

test("the trace calls it what it is now", () => {
  assert.match(trace, /suggest_help:.*done: "Opened a new chat"/);
});

test("delivery opens a session and posts the agent's opening message", () => {
  assert.match(suggestHelp, /from\("chat_sessions"\)\s*\n?\s*\.insert\(\{ user_id: userId, title/);
  assert.match(suggestHelp, /role: "agent", text, meta/);
  assert.match(suggestHelp, /openTitles\(userId\)/); // dedupe against the list stays
});

test("the nightly sweep is registered with the planner window", () => {
  assert.match(resumeQueue, /registerTick\("suggest-help-sweep", helpSweep\)/);
  assert.match(resumeQueue, /cron\.schedule\("30 20 \* \* \*"/); // 21:30 Africa/Lagos
  assert.match(resumeQueue, /cron\.schedule\("25 20 \* \* \*"/); // tools sweep moved into the window too
});

test("the sweep verdict parser only accepts grounded filings", async () => {
  const { parseSweepVerdict } = await import("./suggestHelpSweep.js");
  assert.equal(parseSweepVerdict('{"file": false}'), null);
  assert.equal(parseSweepVerdict("no json here"), null);
  assert.equal(parseSweepVerdict('{"file": true, "kind": "task", "title": "Short", "rationale": "too short"}'), null);
  const ok = parseSweepVerdict('noise {"file": true, "kind": "goal", "title": "Aim for a distinction in English", "rationale": "Her last three essays all scored top marks and her exam is in June."} tail');
  assert.equal(ok.kind, "goal");
  assert.match(ok.title, /distinction/);
  const coerced = parseSweepVerdict('{"file": true, "kind": "weird", "title": "Talk through the BECE plan", "rationale": "He mentioned the exam twice but never made a plan."}');
  assert.equal(coerced.kind, "conversation");
});

test("the opening message is code-written from the filing's facts", async () => {
  const { suggestHelpMessage } = await import("./suggestHelp.js");
  const goal = suggestHelpMessage({ kind: "goal", title: "Aim for a distinction", rationale: "Her essays keep scoring top marks." });
  assert.match(goal, /One thing I noticed: Her essays keep scoring top marks\./);
  assert.match(goal, /\*\*Aim for a distinction\*\*/);
  assert.match(goal, /make this a goal/);
  const task = suggestHelpMessage({ kind: "task", title: "Practise fractions daily", rationale: "" });
  assert.match(task, /I've got this ready/);
  const convo = suggestHelpMessage({ kind: "conversation", title: "Talk through the BECE plan", rationale: "He raised it twice." });
  assert.match(convo, /talk it through here/);
});
