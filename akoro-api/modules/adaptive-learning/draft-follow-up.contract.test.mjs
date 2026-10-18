import assert from "node:assert/strict";
import test from "node:test";
import { isDraftFollowUp, requiresActivityPreparation } from "./agent-chat-intent.js";

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
