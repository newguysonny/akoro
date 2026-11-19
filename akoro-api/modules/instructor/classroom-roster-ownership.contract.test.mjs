/**
 * Phase 15 item 6 (ownership audit, 2026-11-01): GET /api/instructor/classrooms/:id/students
 * lists a class only to someone who may list it in GET /classrooms — its teacher,
 * the admin of its school, or a platform admin. It used to answer any class id.
 *
 * Phase 19 split: the handlers live in service-dashboard.js and the queries in
 * store-people.js, so the assertions follow them there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(new URL("./service-dashboard.js", import.meta.url), "utf8");
const store = readFileSync(new URL("./store-people.js", import.meta.url), "utf8");
const body = service.slice(service.indexOf("export const listClassroomStudents"));

test("the roster checks the class before reading its students", () => {
  assert.match(store, /from\("classrooms"\)\s*\.select\("id, teacher_id, school_id"\)\.eq\("id", id\)/);
  assert.match(body, /let allowed = req\.user\.role === "admin" \|\| room\.teacher_id === req\.user\.id;/);
  assert.match(store, /\.eq\("admin_user_id", userId\)\.eq\("id", schoolId\)/);
  assert.match(body, /if \(!allowed\) return err403\(/);
  assert.ok(body.indexOf("if (!allowed)") < body.indexOf("classroomStudentsForClass"), "checked before the roster is read");
});

test("it matches who GET /classrooms lists", () => {
  const list = service.slice(service.indexOf("export const listClassrooms"), service.indexOf("export const listClassroomStudents"));
  assert.match(list, /classroomsListed\(/);
  assert.match(store, /teacher_id\.eq\.\$\{userId\},school_id\.eq\.\$\{schoolId\}/);
});
