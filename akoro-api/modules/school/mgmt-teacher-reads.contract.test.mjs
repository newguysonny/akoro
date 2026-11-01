/**
 * Phase 15 item 1 (audit 2026-10-25): an approved teacher reads the classroom records of their school,
 * never its finance, payroll, staff, health, admissions or pupils' locations.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./mgmt.js", import.meta.url), "utf8");
const setOf = (name) => {
  const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(m, `${name} found`);
  return new Set([...m[1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]));
};

test("the generic list lets a teacher read only TEACHER_READABLE", () => {
  assert.match(src, /if \(!isSchoolAdmin\(req\) && !TEACHER_READABLE\.has\(req\.params\.resource\)\) return res\.status\(403\)/);
  const readable = new Set([...setOf("INSTRUCTOR_WRITABLE"), ...setOf("TEACHER_READABLE")]);
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
    assert.ok(src.includes(`router.get("${p}", authenticateToken, schoolAdminOnly, async`), p);
  }
  assert.match(src, /\.\.\.\(isSchoolAdmin\(req\) \? \{ fees: dues\[0\]/, "a pupil's profile hides fees from teachers");
  for (const c of ["gross", "net", "basic_salary", "net_salary"]) assert.match(src, new RegExp(`ADMIN_ONLY_COLS = \\[[^\\]]*"${c}"`));
});
