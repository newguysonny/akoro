/**
 * Phase 15 item 6 (ownership audit, 2026-11-01): GET /api/instructor/classrooms/:id/students
 * lists a class only to someone who may list it in GET /classrooms — its teacher,
 * the admin of its school, or a platform admin. It used to answer any class id.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./routes.js", import.meta.url), "utf8");
const body = src.slice(src.indexOf("const listClassroomStudents"), src.indexOf("router.get   (\"/classrooms\""));

test("the roster checks the class before reading its students", () => {
  assert.match(body, /from\("classrooms"\)\s*\.select\("id, teacher_id, school_id"\)\.eq\("id", req\.params\.id\)/);
  assert.match(body, /let allowed = req\.user\.role === "admin" \|\| room\.teacher_id === req\.user\.id;/);
  assert.match(body, /\.eq\("admin_user_id", req\.user\.id\)\.eq\("id", room\.school_id\)/);
  assert.match(body, /if \(!allowed\) return err403\(/);
  assert.ok(body.indexOf("if (!allowed)") < body.indexOf("from(\"classroom_students\")"), "checked before the roster is read");
});

test("it matches who GET /classrooms lists", () => {
  const list = src.slice(src.indexOf("const listClassrooms"), src.indexOf("const listClassroomStudents"));
  assert.match(list, /teacher_id\.eq\.\$\{req\.user\.id\},school_id\.eq\.\$\{school\.id\}/);
});
