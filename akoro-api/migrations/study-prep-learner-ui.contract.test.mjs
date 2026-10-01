import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Study-prep learner UI contract (Master Plan §4.10): the plan card matches
 * the reference sketch (S1 step 13), agent intent renders as "agent says:"
 * (never bolded), pacing is honest, replay reads events only, and the human
 * gates are real buttons hitting harness endpoints.
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [page, api, app, shell] = await Promise.all([
  read("../../akoro-learner/src/pages/StudyPrepPage.jsx"),
  read("../../akoro-learner/src/services/studyPrepApi.js"),
  read("../../akoro-learner/src/App.jsx"),
  read("../../akoro-learner/src/components/AppShell.jsx"),
]);

test("the plan card reproduces the reference sketch: title, topic count, cost, numbered list, Approve & Start / Adjust", () => {
  assert.match(page, /YOUR \{session\.subject\.toUpperCase\(\)\} PLAN/);
  assert.match(page, /topics\{estimate \? ` · estimated cost: \$\{estimate\.totalCoins\} coins/);
  assert.match(page, /Approve & Start/);
  assert.match(page, />Adjust</);
  assert.match(page, /\{topic\.position\}\. \{topic\.label\}/);
});

test("agent intent renders as 'agent says:' — italic, muted, never bolded", () => {
  assert.match(page, /agent says: \{event\.agentIntent\}/);
  assert.match(page, /fontStyle: 'italic'/);
  // the intent line is never inside a fontWeight: 900/800 block
  const intentLine = page.slice(page.indexOf("agent says:"), page.indexOf("agent says:") + 200);
  assert.doesNotMatch(intentLine, /fontWeight: 9|fontWeight: 8/);
});

test("honest pacing: real recorded durations render, never fabricated", () => {
  assert.match(page, /event\.durationMs != null/);
  assert.match(page, /\(\{event\.durationMs\} ms\)/);
  assert.doesNotMatch(page, /setTimeout|sleep\(/);
});

test("the teach-back gate is the learner's own button hitting the harness endpoint", () => {
  assert.match(page, /I've taught it back — unlock retest/);
  assert.match(page, /confirmStudyPrepTeachBack\(session\.id, activeTopic\.id\)/);
  assert.match(api, /teach-back-done/);
});

test("the page never constructs scores or answer keys — everything comes from the harness", () => {
  assert.doesNotMatch(page, /answerIndex\s*===|answerKey|answer_key/);
  assert.doesNotMatch(api, /answerKey|answer_key/);
  // every API call maps to one harness endpoint
  for (const endpoint of ["/sessions", "/confirm", "/adjust", "/practice", "/submit", "/next", "/advance", "/defer", "/conclude", "/pause", "/resume", "/cancel"]) {
    assert.ok(api.includes(`\`${endpoint}`) || api.includes(`\${sessionId}${endpoint}`) || api.includes(endpoint), `${endpoint} is called through the seam`);
  }
});

test("paused states carry the honest copy from the decision register", () => {
  assert.match(page, /I got stuck — tap to retry or adjust\./);
  assert.match(page, /Not enough coins to continue\./);
  assert.match(page, /Resume session/);
});

test("replay is the events feed — the page never re-runs or re-calls the LLM", () => {
  assert.match(page, /ACTIVITY/);
  assert.match(page, /feed\.map/);
  assert.doesNotMatch(page, /openai|chat\.completions/);
});

test("the route and nav entry exist", () => {
  assert.match(app, /StudyPrepPage/);
  assert.match(app, /path="\/study-prep"/);
  assert.match(shell, /to: '\/study-prep'/);
  assert.match(shell, /key: 'nav\.study'/);
});
