import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Study-prep learner UI contract (Master Plan §4.10, chat-native): the whole
 * session lives in the Agent Chat tab — the tool execution rides the reply as
 * a session echo (the instructor activity-draft pattern) and the chat renders
 * the interactive card. There is NO dedicated page, route or nav entry.
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [card, tab, api, app, shell, trace] = await Promise.all([
  read("../../akoro-learner/src/components/tabs/studyPrep/StudyPrepChatCard.jsx"),
  read("../../akoro-learner/src/components/tabs/AgentChatTab.jsx"),
  read("../../akoro-learner/src/services/studyPrepApi.js"),
  read("../../akoro-learner/src/App.jsx"),
  read("../../akoro-learner/src/components/AppShell.jsx"),
  // The session's steps render in the chat turn's trace, not the card (2026-10-17).
  read("../../akoro-learner/src/lib/agentChatTrace.js"),
]);

test("the session card renders inside the Agent Chat tab from the session echo", () => {
  assert.match(tab, /import StudyPrepChatCard from '\.\/studyPrep\/StudyPrepChatCard\.jsx'/);
  assert.match(tab, /entry\?\.session\?\.id && entry\?\.success\)\?\.session/);
  // On the message (or, while it runs, pinned above the composer with a note in its place).
  assert.match(tab, /msg\.studyPrepSessionId&&\([\s\S]{0,700}<StudyPrepChatCard sessionId=\{msg\.studyPrepSessionId\} onEvents=\{onStudyPrepEvents\}/);
  assert.match(tab, /<StudyPrepChatCard sessionId=\{pinnedPrep\} onEvents=\{onStudyPrepEvents\}[^>]*pinned/);
  // the non-stream fallback carries the same echo
  assert.match(tab, /studyPrepSessionFallback/);
});

test("the durable session is found on tab mount — Continue brings its card back in a turn, never a message pushed under the latest turn", () => {
  assert.match(tab, /fetchActiveStudyPrepSession\(\)/);
  assert.match(tab, /setActivePrep\(\{ id: response\.session\.id/);
  assert.doesNotMatch(tab, /pick up where you left off/);
  assert.match(tab, /sendMessage\("Continue my study prep session\."\)/);
  // A session's card shows in full once (its latest turn); earlier copies are one line.
  assert.match(tab, /lastPrepCardIdOf\(msg\.studyPrepSessionId\)!==msg\.id/);
  // Waiting changes: this chat's only, in the bar — not stacked at the end of the chat.
  assert.match(tab, /c\.sessionId&&c\.sessionId===sessionId/);
});

test("there is NO study-prep page, route or nav entry", () => {
  assert.doesNotMatch(app, /StudyPrepPage/);
  assert.doesNotMatch(app, /study-prep/);
  assert.doesNotMatch(shell, /study-prep/);
});

test("the plan card reproduces the reference sketch: Approve & Start / Adjust", () => {
  assert.match(card, /YOUR \{session\.subject\.toUpperCase\(\)\} PLAN/);
  assert.match(card, /estimated cost: \$\{estimate\.totalCoins\} coins/);
  assert.match(card, /Approve & Start/);
  assert.match(card, />Adjust</);
  assert.match(card, /\{topic\.position\}\. \{topic\.label\}/);
});

test("the teach-back gate is the learner's own button hitting the harness endpoint", () => {
  assert.match(card, /I've taught it back — unlock retest/);
  assert.match(card, /confirmStudyPrepTeachBack\(session\.id, activeTopic\.id(, conversationId)?\)/);
  assert.match(api, /teach-back-done/);
});

test("agent intent renders as 'agent says:' — the agent's words, never a harness fact", () => {
  // A row of the turn's Study Prep steps (lib/agentChatTrace.js studyPrepEventBlocks).
  assert.match(trace, /headline: said \? `agent says: \$\{event\.agentIntent\}` : event\.narrative/);
  const intentLine = trace.slice(trace.indexOf("agent says:"), trace.indexOf("agent says:") + 200);
  assert.doesNotMatch(intentLine, /fontWeight: 9|fontWeight: 8/);
});

test("honest pacing: real recorded durations render, never fabricated", () => {
  // Only a recorded duration; none recorded, none shown (the trace row hides it).
  assert.match(trace, /ms: event\.durationMs != null \? event\.durationMs : null/);
  // The events render itself must never fabricate pacing with timers. (The
  // session-load effect may keep a network retry backoff — that is transport,
  // not a displayed duration. 2026-10-03.)
  const eventsRender = trace.slice(Math.max(0, trace.indexOf("durationMs") - 500), trace.indexOf("durationMs") + 500);
  assert.doesNotMatch(eventsRender, /setTimeout|sleep\(/);
});

test("paused states carry the honest copy from the decision register", () => {
  assert.match(card, /I got stuck — tap to retry or adjust\./);
  assert.match(card, /Not enough coins to continue\./);
  assert.match(card, /Resume session/);
});

test("the card never constructs scores or answer keys — the harness decides", () => {
  assert.doesNotMatch(card, /answerIndex\s*===|answerKey|answer_key/);
  assert.doesNotMatch(api, /answerKey|answer_key/);
  for (const endpoint of ["/sessions", "/confirm", "/adjust", "/practice", "/submit", "/advance", "/defer", "/conclude", "/pause", "/resume"]) {
    assert.ok(api.includes(endpoint), `${endpoint} is called through the seam`);
  }
});

test("replay is the events feed — the card never re-runs or calls the LLM", () => {
  // The card hands its session's recorded events to the chat, which shows them in the trace.
  assert.match(card, /onEvents\?\.\(sessionId, events\)/);
  assert.match(tab, /const reported = studyPrepEvents\[sessionId\];[\s\S]{0,80}studyPrepEventBlocks\(reported, range\)/);
  assert.doesNotMatch(card, /openai|chat\.completions/);
  assert.doesNotMatch(trace, /openai|chat\.completions/);
});
