/**
 * modules/admin/pilotSchools.js — Pilot Schools admin (plan §4.6 Phase 1, part 2)
 *
 * All routes require role=admin. Mounted at /api/admin (see modules/admin/index.js).
 *
 *   GET   /api/admin/pilot-schools                       cohort roster (schools list)
 *   POST  /api/admin/pilot-schools                       "Add pilot school"
 *   PATCH /api/admin/pilot-schools/:id                   edit window / caps / contact /
 *                                                        rename / end / archive
 *   POST  /api/admin/pilot-applications/:id/approve      approve & create the pilot
 *   POST  /api/admin/pilot-applications/:id/reject       reject (with reason)
 *
 *   (GET /api/admin/pilot-applications + PATCH .../status live in ./tiers.js)
 *
 * The roster (pilot_schools) is deliberately separate from platform
 * school_profiles — see migrations/2026-pilot-schools-cohorts.sql.
 *
 * Also runs the plan §4.3 `pilot-expiry-check` daily job (03:30 UTC): active
 * cohorts past their end_date are ended and audit-logged.
 *
 * Every mutation is written to public.admin_audit_log. Validation/patch logic
 * lives in lib/pilotModel.js (pure, contract-tested).
 */

import { Router } from "express";
import cron from "node-cron";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { validatePilotSchoolInput, buildPilotPatch, todayStr } from "../../lib/pilotModel.js";

const router    = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const ok        = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ── Audit (works for both request context and the cron job) ───────────────── */
async function audit({ req = null, action, entityType, entityId, before = null, after = null }) {
  const entry = {
    actor: req?.user?.id ?? null,
    actor_label: req?.user ? (req.user.full_name || req.user.email || "admin") : "system (pilot-expiry-check)",
    action, entity_type: entityType, entity_id: entityId,
    before, after,
  };
  const { error } = await db.from("admin_audit_log").insert(entry);
  if (error) console.error("[admin:pilot-schools] audit insert failed:", error.message);
}

/* ── Row shaping: flatten the cohort + school join for the UI ──────────────── */
const COHORT_SELECT =
  "id, school_id, start_date, end_date, student_cap, instructor_cap, status, archived, " +
  "source_application_id, created_at, updated_at, " +
  "pilot_schools!pilot_cohorts_school_id_fkey(id, name, contact_name, contact_email, contact_phone, school_profile_id), " +
  "pilot_applications!pilot_cohorts_source_application_id_fkey(est_students, state_city)";

const shape = (row) => {
  const school = row.pilot_schools ?? {};
  const app    = row.pilot_applications ?? null;
  return {
    id: row.id,
    school_id: row.school_id,
    name: school.name,
    contact: {
      name: school.contact_name ?? "",
      email: school.contact_email ?? "",
      phone: school.contact_phone ?? "",
    },
    start_date: row.start_date,
    end_date: row.end_date,
    student_cap: row.student_cap,
    instructor_cap: row.instructor_cap,
    status: row.status,
    archived: row.archived,
    est_students: app?.est_students ?? null,
    state_city: app?.state_city ?? null,
    source_application_id: row.source_application_id ?? null,
    created_at: row.created_at,
  };
};

/* ── GET /pilot-schools — the roster ───────────────────────────────────────── */
router.get("/pilot-schools", ...adminOnly, asyncHandler(async (req, res) => {
  const { data, error } = await db.from("pilot_cohorts")
    .select(COHORT_SELECT)
    .order("archived", { ascending: true })
    .order("status", { ascending: true })
    .order("end_date", { ascending: true });
  if (error) return res.status(500).json({ success: false, message: error.message });
  return ok(res, (data ?? []).map(shape));
}));

/* ── POST /pilot-schools — add a pilot school manually ────────────────────── */
router.post("/pilot-schools", ...adminOnly, asyncHandler(async (req, res) => {
  const { errors, values } = validatePilotSchoolInput(req.body ?? {});
  if (Object.keys(errors).length)
    return res.status(400).json({ success: false, code: "invalid_pilot_school", message: Object.values(errors).join("; "), fields: errors });

  const { data: school, error: schoolErr } = await db.from("pilot_schools").insert({
    name: values.name,
    contact_name: values.contact_name,
    contact_email: values.contact_email,
    contact_phone: values.contact_phone,
  }).select().single();
  if (schoolErr) {
    if (schoolErr.code === "23505") return res.status(409).json({ success: false, code: "duplicate_pilot_school", message: `“${values.name}” is already on the pilot roster` });
    console.error("[admin:pilot-schools] school insert failed:", schoolErr.message);
    return res.status(500).json({ success: false, message: "Could not add the school." });
  }

  const { data: cohort, error: cohortErr } = await db.from("pilot_cohorts").insert({
    school_id: school.id,
    start_date: values.start_date,
    end_date: values.end_date,
    student_cap: values.student_cap,
    instructor_cap: values.instructor_cap,
  }).select(COHORT_SELECT).single();
  if (cohortErr) {
    console.error("[admin:pilot-schools] cohort insert failed:", cohortErr.message);
    return res.status(500).json({ success: false, message: "School added but the pilot window could not be created." });
  }

  await audit({ req, action: "pilot_school.created", entityType: "pilot_cohort", entityId: cohort.id,
    after: { school: values.name, start: values.start_date, end: values.end_date, student_cap: values.student_cap, instructor_cap: values.instructor_cap } });
  return res.status(201).json({ success: true, data: shape(cohort) });
}));

/* ── PATCH /pilot-schools/:id — edit cohort and/or school fields ───────────── */
router.patch("/pilot-schools/:id", ...adminOnly, asyncHandler(async (req, res) => {
  const { data: cohort, error: fetchErr } = await db.from("pilot_cohorts")
    .select(COHORT_SELECT).eq("id", req.params.id).maybeSingle();
  if (fetchErr) return res.status(500).json({ success: false, message: fetchErr.message });
  if (!cohort) return res.status(404).json({ success: false, code: "not_found", message: "Pilot school not found." });

  const before = shape(cohort);
  const { cohortPatch, schoolPatch, errors } = buildPilotPatch(before, {
    name: before.name,
    contact_name: before.contact.name || null,
    contact_email: before.contact.email || null,
    contact_phone: before.contact.phone || null,
  }, req.body ?? {});
  if (Object.keys(errors).length)
    return res.status(400).json({ success: false, code: "invalid_pilot_fields", message: Object.values(errors).join("; "), fields: errors });

  if (!Object.keys(cohortPatch).length && !Object.keys(schoolPatch).length)
    return ok(res, before, { unchanged: true });

  const now = new Date().toISOString();
  if (Object.keys(cohortPatch).length) {
    cohortPatch.updated_at = now;
    const { error } = await db.from("pilot_cohorts").update(cohortPatch).eq("id", req.params.id);
    if (error) return res.status(500).json({ success: false, message: error.message });
  }
  if (Object.keys(schoolPatch).length) {
    schoolPatch.updated_at = now;
    const { error } = await db.from("pilot_schools").update(schoolPatch).eq("id", before.school_id);
    if (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, code: "duplicate_pilot_school", message: "A pilot school with that name already exists" });
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  const { data: fresh } = await db.from("pilot_cohorts").select(COHORT_SELECT).eq("id", req.params.id).maybeSingle();
  const after = fresh ? shape(fresh) : before;
  await audit({ req, action: "pilot_school.updated", entityType: "pilot_cohort", entityId: req.params.id,
    before: { start: before.start_date, end: before.end_date, student_cap: before.student_cap, instructor_cap: before.instructor_cap, status: before.status, archived: before.archived, contact: before.contact },
    after:  { start: after.start_date,  end: after.end_date,  student_cap: after.student_cap,  instructor_cap: after.instructor_cap,  status: after.status,  archived: after.archived,  contact: after.contact } });
  return ok(res, after);
}));

/* ── POST /pilot-applications/:id/approve — approve & create the pilot ─────── */
router.post("/pilot-applications/:id/approve", ...adminOnly, asyncHandler(async (req, res) => {
  const { data: app } = await db.from("pilot_applications").select("*").eq("id", req.params.id).maybeSingle();
  if (!app) return res.status(404).json({ success: false, code: "not_found", message: "Application not found." });
  if (app.status !== "pending")
    return res.status(409).json({ success: false, code: "already_reviewed", message: `This application was already ${app.status}.` });

  const { errors, values } = validatePilotSchoolInput({
    name: app.school_name,
    contact_name: app.contact_name,
    contact_email: app.contact_email,
    contact_phone: app.contact_phone,
    ...req.body ?? {},
  });
  if (Object.keys(errors).length)
    return res.status(400).json({ success: false, code: "invalid_pilot_school", message: Object.values(errors).join("; "), fields: errors });

  // The school name must not collide with an existing pilot school.
  const { data: clash } = await db.from("pilot_schools").select("id, name").eq("name", values.name).limit(1);
  if (clash?.length)
    return res.status(409).json({ success: false, code: "duplicate_pilot_school", message: `“${values.name}” is already on the pilot roster — edit its pilot window instead.` });

  const { data: school, error: schoolErr } = await db.from("pilot_schools").insert({
    name: values.name,
    contact_name: values.contact_name,
    contact_email: values.contact_email,
    contact_phone: values.contact_phone,
  }).select().single();
  if (schoolErr) {
    if (schoolErr.code === "23505") return res.status(409).json({ success: false, code: "duplicate_pilot_school", message: `“${values.name}” is already on the pilot roster` });
    console.error("[admin:pilot-schools] approve school insert failed:", schoolErr.message);
    return res.status(500).json({ success: false, message: "Could not create the pilot school." });
  }

  const { data: cohort, error: cohortErr } = await db.from("pilot_cohorts").insert({
    school_id: school.id,
    start_date: values.start_date,
    end_date: values.end_date,
    student_cap: values.student_cap,
    instructor_cap: values.instructor_cap,
    source_application_id: app.id,
  }).select(COHORT_SELECT).single();
  if (cohortErr) {
    console.error("[admin:pilot-schools] approve cohort insert failed:", cohortErr.message);
    return res.status(500).json({ success: false, message: "Pilot window could not be created — the application is still pending." });
  }

  const { error: appErr } = await db.from("pilot_applications")
    .update({ status: "approved", reviewed_by: req.user?.id ?? null, reviewed_at: new Date().toISOString() })
    .eq("id", app.id);
  if (appErr) console.error("[admin:pilot-schools] approve status update failed:", appErr.message);

  await audit({ req, action: "application.approved", entityType: "pilot_application", entityId: app.id,
    before: { status: "pending", school: app.school_name },
    after: { status: "approved", school: values.name, pilot: `${values.start_date} → ${values.end_date}` } });
  return res.status(201).json({ success: true, data: shape(cohort) });
}));

/* ── POST /pilot-applications/:id/reject — reject with a reason ────────────── */
router.post("/pilot-applications/:id/reject", ...adminOnly, asyncHandler(async (req, res) => {
  const { data: app } = await db.from("pilot_applications").select("*").eq("id", req.params.id).maybeSingle();
  if (!app) return res.status(404).json({ success: false, code: "not_found", message: "Application not found." });
  if (app.status !== "pending")
    return res.status(409).json({ success: false, code: "already_reviewed", message: `This application was already ${app.status}.` });

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length > 2000)
    return res.status(400).json({ success: false, code: "invalid_reason", message: "Reason is too long (2000 max)" });

  const { data, error } = await db.from("pilot_applications")
    .update({ status: "rejected", review_notes: reason || null, reviewed_by: req.user?.id ?? null, reviewed_at: new Date().toISOString() })
    .eq("id", app.id).select().single();
  if (error) return res.status(500).json({ success: false, message: error.message });

  await audit({ req, action: "application.rejected", entityType: "pilot_application", entityId: app.id,
    before: { status: "pending", school: app.school_name },
    after: { status: "rejected", reason: reason || "No reason given" } });
  return ok(res, data);
}));

/* ── pilot-expiry-check (plan §4.3) — daily 03:30 UTC ────────────────────────
 * Ends active cohorts whose end_date has passed and audit-logs each one, so
 * the Schools list never shows a stale "Pilot active". Idempotent.
 */
cron.schedule("30 3 * * *", async () => {
  try {
    const today = todayStr();
    const { data: expired } = await db.from("pilot_cohorts")
      .select("id, school_id, end_date, pilot_schools!pilot_cohorts_school_id_fkey(name)")
      .eq("status", "active").lt("end_date", today);
    if (!expired?.length) return;
    for (const c of expired) {
      const { error } = await db.from("pilot_cohorts")
        .update({ status: "ended", updated_at: new Date().toISOString() }).eq("id", c.id);
      if (error) { console.error("[pilot-expiry-check] update failed:", error.message); continue; }
      await audit({ action: "pilot.expired", entityType: "pilot_cohort", entityId: c.id,
        before: { status: "active", end_date: c.end_date, school: c.pilot_schools?.name },
        after: { status: "ended" } });
    }
    console.log(`[pilot-expiry-check] ended ${expired.length} pilot cohort(s)`);
  } catch (e) {
    console.error("[pilot-expiry-check] failed:", e.message);
  }
});

export default router;
