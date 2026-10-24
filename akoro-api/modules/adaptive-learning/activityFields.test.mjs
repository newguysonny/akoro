// node --test modules/adaptive-learning/activityFields.test.mjs — the activity's subject, audience and topic come from the teacher.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { subjectNamed, topicNamed, unnamedFields, askFor, teacherTextOf } from "./activityFields.js";

test("subjectNamed: the name, an alias, or its own word — never the topic", () => {
  assert.ok(subjectNamed("Mathematics", "a maths assignment on fractions"));
  assert.ok(subjectNamed("Mathematics", "Mathematics, please"));
  assert.ok(subjectNamed("Basic Science", "a science self study"));
  assert.ok(subjectNamed("Chemistry", "chemistry homework on moles"));
  assert.ok(subjectNamed("English Language", "an English comprehension"));
  assert.ok(!subjectNamed("Mathematics", "an assignment on fractions"));
  assert.ok(!subjectNamed("Basic Science", "a self study on measurement"));
  assert.ok(!subjectNamed("Basic Science", "basic arithmetic"));   // "basic" alone names nothing
  assert.ok(!subjectNamed("", "anything"));
});

test("topicNamed: one of its words, loosely", () => {
  assert.ok(topicNamed("Fractions", "an assignment on fraction work"));
  assert.ok(topicNamed("The Water Cycle", "a self study on the water cycle"));
  assert.ok(topicNamed("Photosynthesis", "photosynthesis please"));
  assert.ok(!topicNamed("Equivalent Fractions", "make an assignment for my class"));
});

test("unnamedFields: subject, audience, topic — each only when the teacher said it", () => {
  const text = "Prepare an assignment on fractions for @tester01 and @tester02 in Tester Class A";
  const base = { type: "assignment", topic: "Fractions", audience: { usernames: ["tester01", "@tester02"], classroom_name: "Tester Class A" } };
  assert.deepEqual(unnamedFields({ ...base, subject: "Mathematics" }, text).map((m) => m.field), ["subject"]);
  assert.deepEqual(unnamedFields({ ...base, subject: "Mathematics" }, `${text}. Maths.`), []);
  // A learner the teacher never named.
  assert.deepEqual(unnamedFields({ ...base, subject: "Mathematics", audience: { usernames: ["tester01", "tester09"] } }, `${text} maths`).map((m) => m.field), ["audience"]);
  // …named by their real name instead of the handle.
  assert.deepEqual(unnamedFields({ ...base, subject: "Mathematics", audience: { user_ids: ["u1"] } }, "maths on fractions for Adaeze", { known: { learners: { u1: { username: "tester01", name: "Adaeze Okafor" } } } }), []);
  // A class: by name (spacing aside), its id's name, or "the whole class".
  assert.deepEqual(unnamedFields({ type: "self_study", topic: "Fractions", subject: "Mathematics", audience: { classroom_name: "JSS 2" } }, "maths fractions for jss2"), []);
  assert.deepEqual(unnamedFields({ type: "self_study", topic: "Fractions", subject: "Mathematics", audience: { classroom_id: "c1" } }, "maths fractions for JSS 2", { known: { classes: { c1: "JSS 2" } } }), []);
  assert.deepEqual(unnamedFields({ type: "self_study", topic: "Fractions", subject: "Mathematics", audience: { whole_class: true, classroom_id: "c1" } }, "maths fractions for my whole class"), []);
  assert.deepEqual(unnamedFields({ type: "self_study", topic: "Fractions", subject: "Mathematics", audience: { classroom_id: "c1" } }, "maths fractions", { known: { classes: { c1: "JSS 2" } } }).map((m) => m.field), ["audience"]);
  // A topic the teacher never gave.
  assert.deepEqual(unnamedFields({ type: "assignment", topic: "Equivalent Fractions", subject: "Mathematics", audience: { whole_class: true } }, "make a maths assignment for my class").map((m) => m.field), ["topic"]);
  // Battles have no subject; an empty audience or subject is the tool's own question.
  assert.deepEqual(unnamedFields({ type: "battle", topic: "Fractions", audience: { classroom_name: "JSS 2" } }, "a fractions battle for JSS 2"), []);
  assert.deepEqual(unnamedFields({ type: "assignment", topic: "Fractions", audience: {} }, "fractions"), []);
  // A revise only checks a new audience.
  assert.deepEqual(unnamedFields({ audience: { usernames: ["tester07"] } }, "make it harder", { check: ["audience"] }).map((m) => m.field), ["audience"]);
});

test("askFor: one question for one field, one line for several", () => {
  assert.equal(askFor([]), null);
  assert.equal(askFor([{ field: "subject", question: 'Which subject is "Fractions" for?' }]), 'Which subject is "Fractions" for?');
  assert.match(askFor([{ field: "subject", question: "Which subject is it for?" }, { field: "audience", question: "Who is this for — which class, or which learners?" }]), /^Before I prepare it, tell me: which subject is it for; who is this for/);
});

test("teacherTextOf: every user message, text parts of mixed content", () => {
  assert.equal(teacherTextOf([{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: [{ type: "text", text: "c" }, { type: "image_url" }] }]), "a\nc");
});

test("the chat loop runs it before the activity tools", () => {
  const src = readFileSync(new URL("./chat.js", import.meta.url), "utf8");
  assert.match(src, /const unsaid = role === "instructor" \? await unsaidActivityFields\(tool, input, transcript\)/);
  assert.match(src, /if \(unsaid\) toolResult = unsaid;/);
  assert.match(src, /tool === "prepare_activity"\) \{ fields = input; check = \["topic", "subject", "audience"\]/);
});

test("some of a class is not the class: who, by name, or 'the whole class' said outright", () => {
  const cls = { type: "battle", topic: "Fractions", audience: { classroom_name: "Tester Class A" } };
  assert.deepEqual(unnamedFields(cls, "a fractions battle for my three strongest learners in Tester Class A").map((m) => m.field), ["audience"]);
  assert.deepEqual(unnamedFields(cls, "fractions battle for a few students in Tester Class A").map((m) => m.field), ["audience"]);
  assert.deepEqual(unnamedFields(cls, "fractions battle for my three strongest learners in Tester Class A\nJust do the whole class then."), []);
  assert.deepEqual(unnamedFields(cls, "fractions battle for Tester Class A"), []);
  assert.deepEqual(unnamedFields(cls, "fractions battle for all the learners in Tester Class A"), []);
  // Named learners are fine whatever else was said.
  assert.deepEqual(unnamedFields({ ...cls, audience: { usernames: ["tester01", "tester02", "tester03"] } }, "my three strongest learners in Tester Class A on fractions: @tester01, @tester02, @tester03"), []);
});
