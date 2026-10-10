import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { buildSuggestionMessages, shapeSuggestions, SUGGESTION_LIMITS } = await import("./chatSuggestions.js");
const { chatIdeas, versionIdeas, STARTERS } = await import("../../../akoro-instructor/src/lib/chatIdeas.js");
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [chat, chatPage, draftCard] = await Promise.all([read("./chat.js"), read("../../../akoro-instructor/src/pages/ChatPage.jsx"), read("../../../akoro-instructor/src/components/paper/DraftCard.jsx")]);

test("the suggestion prompt: three short next things, never assigning", () => {
  const [sys, user] = buildSuggestionMessages({ role: "instructor", ask: "5 MCQ on fractions", reply: "Draft ready — preview it to assign." });
  assert.match(sys.content, /exactly 3 short things/);
  assert.match(sys.content, /Never suggest assigning, sending or publishing/);
  assert.match(sys.content, /The user is a teacher/);
  assert.match(user.content, /The user said: 5 MCQ on fractions/);
  assert.match(buildSuggestionMessages({ reply: "x" })[0].content, /The user is a learner/);
  assert.ok(buildSuggestionMessages({ reply: "y".repeat(9000) })[1].content.length < SUGGESTION_LIMITS.replyChars + 200);
});

test("suggestions are cleaned: numbering and quotes gone, no duplicates, no assigning, at most 3", () => {
  assert.deepEqual(shapeSuggestions(JSON.stringify({ suggestions: ["1. Make question 2 harder", "\"Add a case study\"", "make question 2 harder!", "Assign it to JSS 2", "x".repeat(90), "Show my classes", "Add true/false"] })),
    ["Make question 2 harder", "Add a case study", "Show my classes"]);
  assert.deepEqual(shapeSuggestions("not json"), []);
  assert.deepEqual(shapeSuggestions({ suggestions: "nope" }), []);
});

const ready = (questions, extra = {}) => ({ n: 2, status: "ready", paper: { questions }, ...extra });

test("ideas for a draft version read its questions", () => {
  const qs = [
    { q: "a", type: "MCQ", options: ["1", "2", "3", "4"], correct: 0, difficulty: "Medium", max_points: 2 },
    { q: "b", type: "MCQ", options: ["1", "2", "3", "4"], correct: 0, difficulty: "Easy", max_points: 2 },
    { q: "c", type: "Theory", difficulty: "Hard", max_points: 5 },
  ];
  const ideas = versionIdeas(ready(qs, { summary: { totalPoints: 9 } }));
  assert.deepEqual(ideas.map((i) => i.label), ["Make Q2 harder", "Add a diagram question", "Marks total 10", "Add true/false", "Add a case study"]);
  assert.equal(ideas[0].fill, "Make question 2 harder");
  // What the draft missed comes first; kinds it already has aren't offered.
  const withAll = versionIdeas(ready([
    { q: "t", format: "true_false", options: ["True", "False"], difficulty: "Easy", max_points: 1 },
    { q: "d", figure: { svg: "<svg/>" }, difficulty: "Hard", max_points: 4 },
    { q: "c", format: "case_study", passage: 0, difficulty: "Hard", max_points: 5 },
  ], { warning: "Asked for 3 MCQ, got 2. Asked for 5 questions, got 3.", summary: { totalPoints: 10 } }));
  assert.equal(withAll[0].label, "Fix what was missed");
  assert.equal(withAll[0].fill, "Fix version 2: Asked for 3 MCQ, got 2");
  for (const l of ["Add a diagram question", "Add true/false", "Add a case study", "Make Q1 harder"]) assert.ok(!withAll.some((i) => i.label === l), l);
  assert.ok(withAll.length <= 5);
  // Marks off a round number → a nudge to the next one.
  assert.ok(versionIdeas(ready(qs, { summary: { totalPoints: 9 } })).length === 5);
  assert.ok(versionIdeas(ready([qs[2]], { summary: { totalPoints: 17 } })).some((i) => i.fill === "Change the marks so they total 20"));
});

test("which chips show: newest version only, nothing while drafting, what's next after assigning, starters otherwise", () => {
  const draft = { id: "d", type: "assignment", payload: { versions: [ready([{ q: "a", difficulty: "Easy" }], { n: 1 }), { n: 2, status: "drafting" }] } };
  assert.deepEqual(chatIdeas({ latest: { draft, version: 2 } }), [], "drafting — wait");
  assert.deepEqual(chatIdeas({ latest: { draft, version: 1 } }), STARTERS, "an older card's ideas would build on the wrong version");
  draft.payload.versions[1] = ready([{ q: "b", difficulty: "Easy" }]);
  assert.equal(chatIdeas({ latest: { draft, version: 2 } })[0].label, "Make Q1 harder");
  assert.equal(chatIdeas({ latest: { draft, version: 2, state: "assigned" } })[0].label, "A follow-up for next week");
  assert.equal(chatIdeas({ latest: { draft: { id: "x", type: "self_study", payload: {} } } })[0].label, "Add a due date");
  assert.equal(chatIdeas({ tools: ["check_activity_outcomes"] })[0].label, "Revision on the weak areas");
  assert.equal(chatIdeas(), STARTERS);
});

test("wiring: every reply gets suggestions, after it arrives", () => {
  assert.match(chat, /router\.post\("\/suggestions"/);
  assert.match(chat, /__timeoutMs: 12_000, __maxRetries: 0/);
  assert.match(chat, /res\.json\(\{ success: true, suggestions: \[\] \}\);/, "a failure is just no chips");
  assert.match(chatPage, /apiPost\('\/api\/adaptive\/chat\/suggestions', \{ ask: bodyText, reply: replyText, role: 'instructor' \}\)/);
  assert.match(chatPage, /const isLatestReply = !isMe && mi === messages\.length - 1/);
  assert.match(chatPage, /onClick=\{\(\) => \{ setInput\(it\.fill\); inputRef\.current\?\.focus\(\); \}\}/, "a chip fills the box, it doesn't send");
  assert.match(draftCard, /if \(next\) onDraft\?\.\(next\);/);
});
