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
const [card, tab, api, app, shell] = await Promise.all([
  read("../../akoro-learner/src/components/tabs/studyPrep/StudyPrepChatCard.jsx"),
  read("../../akoro-learner/src/components/tabs/AgentChatTab.jsx"),
  read("../../akoro-learner/src/services/studyPrepApi.js"),
  read("../../akoro-learner/src/App.jsx"),
  read("../../akoro-learner/src/components/AppShell.jsx"),
]);

test("the session card renders inside the Agent Chat tab from the session echo", () => {
  assert.match(tab, /import StudyPrepChatCard from '\.\/studyPrep\/StudyPrepChatCard\.jsx'/);
  assert.match(tab, /entry\?\.session\?\.id && entry\?\.success\)\?\.session/);
  assert.match(tab, /msg\.studyPrepSessionId&&<StudyPrepChatCard sessionId=\{msg\.studyPrepSessionId\}\/>/);
  // the non-stream fallback carries the same echo
  assert.match(tab, /studyPrepSessionFallback/);
});

test("the durable session restores on tab mount — the card outlives chats", () => {
  assert.match(tab, /fetchActiveStudyPrepSession\(\)/);
  assert.match(tab, /studyPrepSessionId: response\.session\.id/);
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
  assert.match(card, /confirmStudyPrepTeachBack\(session\.id, activeTopic\.id\)/);
  assert.match(api, /teach-back-done/);
});

test("agent intent renders as 'agent says:' — italic, muted, never bolded", () => {
  assert.match(card, /agent says: \{event\.agentIntent\}/);
  assert.match(card, /fontStyle: 'italic'/);
  const intentLine = card.slice(card.indexOf("agent says:"), card.indexOf("agent says:") + 200);
  assert.doesNotMatch(intentLine, /fontWeight: 9|fontWeight: 8/);
});

test("honest pacing: real recorded durations render, never fabricated", () => {
  assert.match(card, /event\.durationMs != null/);
  assert.match(card, /\(\{event\.durationMs\} ms\)/);
  // The events render itself must never fabricate pacing with timers. (The
  // session-load effect may keep a network retry backoff — that is transport,
  // not a displayed duration. 2026-10-03.)
  const eventsRender = card.slice(Math.max(0, card.indexOf("durationMs") - 500), card.indexOf("durationMs") + 500);
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
  assert.match(card, /Activity \(\{events\.length\}\)/);
  assert.match(card, /\[\.\.\.events\]\.reverse\(\)\.map/);
  assert.doesNotMatch(card, /openai|chat\.completions/);
});
