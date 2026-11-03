/**
 * Phase 15 item 6 (ownership audit, 2026-11-01): a teacher lists and messages
 * only learners they teach. GET /instructor/students trusted any ?course_id=
 * (emails and phones of another course's learners), and POST
 * /students/:userId/message sent an in-app message and a platform email to any account.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./routes.js", import.meta.url), "utf8");
const route = (method, path) => {
  const at = src.indexOf(`router.${method}("${path}"`);
  assert.ok(at >= 0, `${method} ${path} found`);
  return src.slice(at, src.indexOf("\n}));", at));
};

test("instructor/students: a course_id filter must be one of the caller's courses", () => {
  const body = route("get", "/instructor/students");
  assert.match(body, /if \(course_id && !courseIds\.includes\(course_id\)\) return res403\(/);
  assert.ok(body.indexOf("courseIds.includes(course_id)") < body.indexOf("const targetIds"), "checked before the filter is used");
});

test("students/:userId/message: only a learner the teacher teaches (or as an admin)", () => {
  const body = route("post", "/students/:userId/message");
  assert.match(body, /if \(req\.user\.role !== "admin" && !\(await teachesLearner\(req\.user\.id, userId\)\)\) return res403\(/);
  assert.ok(body.indexOf("teachesLearner") < body.indexOf("from(\"notifications\")"), "checked before anything is sent");
});

test("teachesLearner: an enrolment in their courses or an active seat in their classes", () => {
  const fn = src.slice(src.indexOf("async function teachesLearner"), src.indexOf("\n}\n", src.indexOf("async function teachesLearner")));
  assert.match(fn, /from\("courses"\)\.select\("id"\)\.eq\("instructor_id", teacherId\)/);
  assert.match(fn, /from\("enrollments"\)[\s\S]*?\.eq\("user_id", userId\)\.in\("course_id", courseIds\)/);
  assert.match(fn, /from\("classrooms"\)\.select\("id"\)\.eq\("teacher_id", teacherId\)/);
  assert.match(fn, /from\("classroom_students"\)[\s\S]*?\.eq\("user_id", userId\)\.in\("classroom_id", roomIds\)\.eq\("status", "active"\)/);
});
