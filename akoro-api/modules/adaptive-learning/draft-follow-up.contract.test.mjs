import assert from "node:assert/strict";
import test from "node:test";
import { isDraftFollowUp, requiresActivityPreparation } from "./intent/agent-chat-intent.js";

// What teachers say after the first draft: each revises it (the next version).
const FOLLOW_UPS = [
  "Add a new part with 2 true or false questions.",
  "Make question 2 harder, and change question 5 into a fill in the gap question.",
  "Give question 7 5 marks.",
  "Go back to version 1 and add one essay question at the end.",
  "Add a diagram question: a ray diagram of light hitting a plane mirror, where the learners label the incident ray, the reflected ray and the normal.",
  "Now add a calculation question with a diagram of a concave mirror.",
  "Remove question 3.",
  "Change question 1 to a true or false question.",
  "Please replace Q4 with a word problem",
  "ok, swap the order of part A and part B",
  "Thanks, can you make it easier for younger students",
  "Use version 2 but add two more MCQs",
];
// New requests and questions about drafts: not a revision.
const NOT_FOLLOW_UPS = [
  "Create an assignment for @tester19 in Mathematics on linear equations (JSS3): 4 MCQ",
  "Make a new quiz on fractions for JSS1",
  "Add another assignment for my SS2 class on osmosis",
  "What does question 3 say?",
  "Show me my drafts",
  "How did the last assignment go?",
  "Hello",
];

test("teachers' follow-ups on a draft are revisions", () => {
  for (const m of FOLLOW_UPS) assert.equal(isDraftFollowUp(m), true, m);
});

test("new activity requests and questions are not revisions", () => {
  for (const m of NOT_FOLLOW_UPS) assert.equal(isDraftFollowUp(m), false, m);
});

test("a follow-up naming questions still matches the prepare guard (why the revise force is checked first)", () => {
  assert.equal(requiresActivityPreparation("Add a new part with 2 true or false questions."), true);
});

test("the revision writer sees questions numbered from 1, as the teacher counts them", async () => {
  const { buildRevisionMessages } = await import("../self-study/questionPaper.js");
  const base = { questions: [{ q: "First?", type: "MCQ", options: ["a", "b", "c", "d"], correct: 0 }, { q: "Second?", type: "Short answer" }] };
  const [sys, user] = buildRevisionMessages({ topic: "T", subject: "S", request: "Make question 2 harder", base });
  assert.match(user.content, /"index":1,"number":2,"text":"Second\?"/);
  assert.match(sys.content, /"question 2" or "Q2" is the one with "number": 2 \(its index is 1\)/);
});

test("true or false questions get a part of their own", async () => {
  const { layoutPaper } = await import("../self-study/paperTemplate.js");
  const { paper } = layoutPaper({ questions: [
    { q: "Pick one", type: "MCQ", options: ["a", "b", "c", "d"] },
    { q: "x = 2 is a solution of 2x = 4.", type: "True or false", format: "true_false", options: ["True", "False"] },
    { q: "Solve 3x = 9", type: "Calculation", answer_space: "working" },
  ] });
  assert.deepEqual(paper.sections.map((s) => s.title), ["Part A – Multiple Choice", "Part B – True or False", "Part C – Calculations"]);
});

test("a follow-up's own words reach the paper writer (the model's paraphrase is replaced)", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./chat.js", import.meta.url), "utf8");
  assert.match(src, /if \(tool === "revise_activity_draft" && teacherWords && input\?\.question_request\) input = \{ \.\.\.input, question_request: teacherWords \};/);
  assert.match(src, /teacherWords: draftFollowUp \? userMessage\.slice\(0, 1500\) : null,/);
});
