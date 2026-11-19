/**
 * Phase 15 item 6 (ownership audit, 2026-11-01): a teacher lists and messages
 * only learners they teach. GET /instructor/students trusted any ?course_id=
 * (emails and phones of another course's learners), and POST
 * /students/:userId/message sent an in-app message and a platform email to any account.
 *
 * The routes were split into routes.js → service-*.js → store-*.js in Phase 19;
 * the checks below follow the code to the service handler and the store query
 * that carries each ownership predicate. No assertion was dropped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes   = readFileSync(new URL("./routes.js", import.meta.url), "utf8");
const service  = readFileSync(new URL("./service-students.js", import.meta.url), "utf8");
const invites  = readFileSync(new URL("./store-invites.js", import.meta.url), "utf8");
const teaching = readFileSync(new URL("./store-teaching.js", import.meta.url), "utf8");
const users    = readFileSync(new URL("./store-users.js", import.meta.url), "utf8");
const dbSrc    = `${invites}\n${teaching}`;
const handler = (name) => {
  const at = service.indexOf(`export async function ${name}`);
  assert.ok(at >= 0, `${name} handler found`);
  return service.slice(at, service.indexOf("\n}\n", at));
};

test("instructor/students: a course_id filter must be one of the caller's courses", () => {
  assert.match(routes, /router\.get\("\/instructor\/students"/);
  const body = handler("listInstructorStudents");
  assert.match(body, /if \(course_id && !courseIds\.includes\(course_id\)\) return res403\(/);
  assert.ok(body.indexOf("courseIds.includes(course_id)") < body.indexOf("const targetIds"), "checked before the filter is used");
});

test("students/:userId/message: only a learner the teacher teaches (or as an admin)", () => {
  assert.match(routes, /router\.post\("\/students\/:userId\/message"/);
  const body = handler("sendStudentMessage");
  assert.match(body, /if \(req\.user\.role !== "admin" && !\(await teachesLearner\(req\.user\.id, userId\)\)\) return res403\(/);
  assert.ok(body.indexOf("teachesLearner") < body.indexOf("insertNotification"), "checked before anything is sent");
  assert.match(users, /from\("notifications"\)\.insert\(row\)/);
});

test("teachesLearner: an enrolment in their courses or an active seat in their classes", () => {
  const fn = service.slice(service.indexOf("export async function teachesLearner"), service.indexOf("\n}\n", service.indexOf("export async function teachesLearner")));
  assert.match(fn, /listOwnedCourseIds\(teacherId\)/);
  assert.match(fn, /findEnrollmentForLearner\(userId, courseIds\)/);
  assert.match(fn, /listTeacherClassroomIds\(teacherId\)/);
  assert.match(fn, /findActiveSeat\(userId, roomIds\)/);
  assert.match(dbSrc, /from\("courses"\)\.select\("id"\)\.eq\("instructor_id", teacherId\)/);
  assert.match(dbSrc, /from\("enrollments"\)[\s\S]*?\.eq\("user_id", userId\)\.in\("course_id", courseIds\)/);
  assert.match(dbSrc, /from\("classrooms"\)\.select\("id"\)\.eq\("teacher_id", teacherId\)/);
  assert.match(dbSrc, /from\("classroom_students"\)[\s\S]*?\.eq\("user_id", userId\)\.in\("classroom_id", roomIds\)\.eq\("status", "active"\)/);
});
