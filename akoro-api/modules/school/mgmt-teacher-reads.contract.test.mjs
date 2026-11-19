/**
 * Phase 15 item 1 (audit 2026-10-25): an approved teacher reads the classroom records of their school,
 * never its finance, payroll, staff, health, admissions or pupils' locations.
 *
 * The mgmt router was split into route/service/rules layers (Phase 19 step 4);
 * this test follows the code to the file that owns each rule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const rules = read("./mgmt-rules.js");
const routes = read("./mgmt-routes.js");
const generic = read("./mgmt-service-generic.js");
const students = read("./mgmt-service-students.js");

const setOf = (src, name) => {
  const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(m, `${name} found`);
  return new Set([...m[1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]));
};

test("the generic list lets a teacher read only TEACHER_READABLE", () => {
  assert.match(generic, /if \(!isSchoolAdmin\(req\) && !TEACHER_READABLE\.has\(req\.params\.resource\)\) return res\.status\(403\)/);
  const readable = new Set([...setOf(rules, "INSTRUCTOR_WRITABLE"), ...setOf(rules, "TEACHER_READABLE")]);
  for (const r of ["payroll-records", "staff-loans", "salary-templates", "appraisals", "health-records", "bank-accounts",
    "expenses", "incomes", "fee-payments", "complaints", "admission-applications", "staff", "vehicle-locations", "result-pins", "student-documents"]) {
    assert.ok(!readable.has(r), `${r} is not readable by a teacher`);
  }
  for (const r of ["students", "classes", "subjects", "timetable-slots", "exams", "exam-marks", "notices"]) assert.ok(readable.has(r), `${r} stays readable`);
});

test("finance, HR, documents, the website and pupils' locations are school-admin only", () => {
  for (const p of ["/dashboard/:area", "/fees/dues", "/students/:id/fees", "/students/:id/transport", "/hr/attendance/register",
    "/transport/latest-locations", "/site-pages", "/site-pages/:id", "/site-media", "/site-media/:id",
    "/document-templates", "/document-templates/:id/html", "/document-records/:id/html"]) {
    assert.ok(routes.includes(`router.get("${p}", authenticateToken, schoolAdminOnly,`), p);
  }
  assert.match(students, /\.\.\.\(isSchoolAdmin\(req\) \? \{ fees: dues\[0\]/, "a pupil's profile hides fees from teachers");
  for (const c of ["gross", "net", "basic_salary", "net_salary"]) assert.match(rules, new RegExp(`ADMIN_ONLY_COLS = \\[[^\\]]*"${c}"`));
});
