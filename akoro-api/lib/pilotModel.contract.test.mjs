/**
 * lib/pilotModel.js contract tests (plan §4.6 Phase 1, part 2): pilot-school
 * create/approve validation and cohort/school patch diffing, including the
 * prototype's "an active cohort past its end date ends itself" behavior.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { validatePilotSchoolInput, buildPilotPatch, todayStr } from "./pilotModel.js";

const SCHOOL = {
  name: "Chrisland College",
  contact_name: "Mrs. Folake Adeyemi",
  contact_email: "admin@chrisland.example.com",
  contact_phone: "+234 803 111 0001",
};

// CURRENT is built relative to today so it is a genuinely "current" pilot on
// every calendar day. A fixed window (the original Sep 2026 dates) goes stale:
// once its end_date passes, the auto-end rule fires on untouched patches, and
// when it equals todayStr() the change-detection path skips end_date — both
// broke the suite on 2026-09-30.
const T = todayStr();
const shiftDays = (n) => {
  const d = new Date(`${T}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const CURRENT = {
  id: "c1", school_id: "s1", name: "Chrisland College",
  contact: { name: "Mrs. Folake Adeyemi", email: "admin@chrisland.example.com", phone: "+234 803 111 0001" },
  start_date: shiftDays(-14), end_date: shiftDays(45),
  student_cap: 200, instructor_cap: 400,
  status: "active", archived: false,
};

/* ── validatePilotSchoolInput ──────────────────────────────────────────────── */

test("validatePilotSchoolInput: valid input normalizes and defaults caps", () => {
  const { errors, values } = validatePilotSchoolInput({
    name: "  Greenfield Academy ", start_date: "2026-10-01", end_date: "2026-10-31",
    contact_name: " Mrs. Amina Yusuf ", contact_email: " HEAD@Greenfield.example.com ", contact_phone: "+234 803 111 0003",
  });
  assert.deepEqual(errors, {});
  assert.equal(values.name, "Greenfield Academy");
  assert.equal(values.student_cap, 200);   // defaults from the Pilot tier
  assert.equal(values.instructor_cap, 400);
  assert.equal(values.contact_email, "HEAD@Greenfield.example.com");
});

test("validatePilotSchoolInput: rejects missing name/dates, reversed window, bad caps/email", () => {
  const bad = validatePilotSchoolInput({ name: "   ", start_date: "2026-10-05", end_date: "2026-10-01", student_cap: -1, contact_email: "nope" });
  for (const f of ["name", "end_date", "student_cap", "contact_email"]) assert.ok(bad.errors[f], `expected error for ${f}`);
  assert.ok(validatePilotSchoolInput({ name: "X", start_date: "not-a-date", end_date: "2026-10-01" }).errors.start_date);
  assert.ok(validatePilotSchoolInput({ name: "X", start_date: "2026-10-01", end_date: "2026-10-01" }).errors.end_date === undefined, "same-day window is valid");
});

/* ── buildPilotPatch ───────────────────────────────────────────────────────── */

test("buildPilotPatch: identical values produce empty patches", () => {
  const { cohortPatch, schoolPatch, errors } = buildPilotPatch(CURRENT, SCHOOL, {
    start_date: CURRENT.start_date, end_date: CURRENT.end_date,
    student_cap: 200, instructor_cap: 400, contact_email: CURRENT.contact.email,
  });
  assert.deepEqual(errors, {});
  assert.deepEqual(cohortPatch, {});
  assert.deepEqual(schoolPatch, {});
});

test("buildPilotPatch: dates validate as a pair — changing only end before start is rejected", () => {
  const newEnd = shiftDays(60);   // always after the fixture's own end
  const okEnd = buildPilotPatch(CURRENT, SCHOOL, { end_date: newEnd });
  assert.deepEqual(okEnd.errors, {});
  assert.equal(okEnd.cohortPatch.end_date, newEnd);
  assert.equal(okEnd.cohortPatch.start_date, undefined);

  const bad = buildPilotPatch(CURRENT, SCHOOL, { end_date: shiftDays(-15) });  // day before the fixture's start
  assert.ok(bad.errors.end_date, "end before the untouched start must fail");
});

test("buildPilotPatch: active cohort whose end date moved into the past auto-ends", () => {
  // Valid window (end >= start) but entirely in the past.
  const { cohortPatch, errors } = buildPilotPatch(CURRENT, SCHOOL, { start_date: "2024-01-01", end_date: "2024-01-31" });
  assert.deepEqual(errors, {});
  assert.equal(cohortPatch.status, "ended");
  assert.equal(cohortPatch.start_date, "2024-01-01");

  // Even without edits, an active cohort already past its end date ends on save.
  const stale = { ...CURRENT, start_date: "2024-01-01", end_date: "2024-01-31" };
  const untouched = buildPilotPatch(stale, SCHOOL, {});
  assert.equal(untouched.cohortPatch.status, "ended");
});

test("buildPilotPatch: rename goes to the school, caps/dates/status/archived to the cohort", () => {
  const { cohortPatch, schoolPatch, errors } = buildPilotPatch(CURRENT, SCHOOL, {
    name: "Chrisland College Lagos", student_cap: 250, archived: true,
    contact_name: "New Contact", contact_phone: "",
  });
  assert.deepEqual(errors, {});
  assert.deepEqual(schoolPatch, { name: "Chrisland College Lagos", contact_name: "New Contact", contact_phone: null });
  assert.deepEqual(cohortPatch, { student_cap: 250, archived: true });
});

test("buildPilotPatch: end pilot now = today's end date, and rejects invalid fields", () => {
  const { cohortPatch, errors } = buildPilotPatch(CURRENT, SCHOOL, { end_date: todayStr(), status: "ended" });
  assert.deepEqual(errors, {});
  assert.equal(cohortPatch.end_date, todayStr());
  assert.equal(cohortPatch.status, "ended");

  const bad = buildPilotPatch(CURRENT, SCHOOL, { status: "paused", instructor_cap: -5, name: "  ", archived: "yes" });
  for (const f of ["status", "instructor_cap", "name", "archived"]) assert.ok(bad.errors[f], `expected error for ${f}`);
});

test("buildPilotPatch: an ended cohort is not resurrected by the auto-end rule", () => {
  const ended = { ...CURRENT, status: "ended", end_date: "2026-08-31" };
  const { cohortPatch } = buildPilotPatch(ended, SCHOOL, { student_cap: 300 });
  assert.equal(cohortPatch.status, undefined);
  assert.equal(cohortPatch.student_cap, 300);
});
