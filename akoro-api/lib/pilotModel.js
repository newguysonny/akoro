/**
 * lib/pilotModel.js — pure validation + patch logic for the Pilot Schools
 * admin (plan §4.6 Phase 1, part 2). No db/express imports so contract tests
 * can load it directly (same pattern as lib/tiersModel.js).
 *
 *   validatePilotSchoolInput(body)          → { errors, values }  create/approve
 *   buildPilotPatch(cohort, school, body)   → { cohortPatch, schoolPatch, errors }
 */

const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const todayStr = () => new Date().toISOString().slice(0, 10);

const isDate = (s) => typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

const toInt = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
};

const str = (v) => (typeof v === "string" ? v.trim() : v === undefined || v === null ? "" : String(v).trim());

/* ── Create / approve validation ───────────────────────────────────────────── */

export function validatePilotSchoolInput(body = {}) {
  const errors = {};
  const values = {};

  const name = str(body.name);
  if (!name) errors.name = "Fill in the school name";
  else if (name.length > 200) errors.name = "School name is too long (200 max)";
  else values.name = name;

  if (!isDate(body.start_date)) errors.start_date = "Start date is required (YYYY-MM-DD)";
  else values.start_date = body.start_date;

  if (!isDate(body.end_date)) errors.end_date = "End date is required (YYYY-MM-DD)";
  else if (values.start_date && body.end_date < values.start_date) errors.end_date = "End date must be after start date";
  else values.end_date = body.end_date;

  for (const key of ["student_cap", "instructor_cap"]) {
    if (body[key] === undefined || body[key] === null || body[key] === "") { values[key] = key === "student_cap" ? 200 : 400; continue; }
    const n = toInt(body[key]);
    if (Number.isNaN(n) || n < 0) errors[key] = "Cap must be 0 or more";
    else values[key] = n;
  }

  const contactName = str(body.contact_name);
  if (contactName.length > 200) errors.contact_name = "Contact name is too long (200 max)";
  else values.contact_name = contactName || null;

  const email = str(body.contact_email);
  if (email && !EMAIL_RE.test(email)) errors.contact_email = "Enter a valid contact email";
  else values.contact_email = email || null;

  const phone = str(body.contact_phone);
  if (phone.length > 30) errors.contact_phone = "Contact phone is too long";
  else values.contact_phone = phone || null;

  return { errors, values };
}

/* ── PATCH diffing (dates validated as a pair against current values) ──────── */

/**
 * Build PATCH payloads for a cohort + its pilot school.
 * Mirrors the prototype's saveSchoolSettings behavior: an active cohort whose
 * (possibly updated) end_date is in the past is auto-ended.
 */
export function buildPilotPatch(cohort, school, body = {}) {
  const cohortPatch = {};
  const schoolPatch = {};
  const errors = {};

  if (body.name !== undefined) {
    const name = str(body.name);
    if (!name) errors.name = "Name cannot be empty";
    else if (name.length > 200) errors.name = "School name is too long (200 max)";
    else if (name !== school.name) schoolPatch.name = name;
  }

  if (body.start_date !== undefined || body.end_date !== undefined) {
    const start = body.start_date !== undefined ? body.start_date : cohort.start_date;
    const end   = body.end_date   !== undefined ? body.end_date   : cohort.end_date;
    if (!isDate(start)) errors.start_date = "Start date is required (YYYY-MM-DD)";
    else if (!isDate(end)) errors.end_date = "End date is required (YYYY-MM-DD)";
    else if (end < start) errors.end_date = "End date must be after start date";
    else {
      if (start !== cohort.start_date) cohortPatch.start_date = start;
      if (end !== cohort.end_date) cohortPatch.end_date = end;
    }
  }

  for (const key of ["student_cap", "instructor_cap"]) {
    if (body[key] === undefined) continue;
    const n = toInt(body[key]);
    if (n === null || Number.isNaN(n) || n < 0) { errors[key] = "Cap must be 0 or more"; continue; }
    if (n !== cohort[key]) cohortPatch[key] = n;
  }

  for (const key of ["contact_name", "contact_email", "contact_phone"]) {
    if (body[key] === undefined) continue;
    const v = str(body[key]);
    if (key === "contact_email" && v && !EMAIL_RE.test(v)) { errors.contact_email = "Enter a valid contact email"; continue; }
    if (v.length > (key === "contact_phone" ? 30 : 200)) { errors[key] = "Too long"; continue; }
    if (v !== (school[key] ?? "")) schoolPatch[key] = v || null;
  }

  if (body.status !== undefined) {
    if (!["active", "ended"].includes(body.status)) errors.status = "status must be active or ended";
    else if (body.status !== cohort.status) cohortPatch.status = body.status;
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean") errors.archived = "archived must be true or false";
    else if (body.archived !== cohort.archived) cohortPatch.archived = body.archived;
  }

  // Prototype behavior: an active cohort whose end date is now in the past ends.
  const endResult   = cohortPatch.end_date   ?? cohort.end_date;
  const statusResult = cohortPatch.status ?? cohort.status;
  if (statusResult === "active" && endResult < todayStr()) cohortPatch.status = "ended";

  return { cohortPatch, schoolPatch, errors };
}
