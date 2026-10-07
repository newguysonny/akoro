/**
 * modules/admin/tiers.js — Tiers, Credits & Subscription Admin (plan §4.6 Phase 1)
 *
 * All routes require role=admin. Mounted at /api/admin (see modules/admin/index.js).
 *
 *   GET    /api/admin/tiers                       tier catalog, both platforms
 *   POST   /api/admin/tiers                       create a tier
 *   PATCH  /api/admin/tiers/:id                   update a tier
 *           ↳ price changes MUST carry effective_scope: 'new_only' | 'all'
 *   GET    /api/admin/lifecycle-settings          subscription lifecycle singleton
 *   PATCH  /api/admin/lifecycle-settings          update retries / grace / proration
 *   GET    /api/admin/pilot-applications          applications queue (+status counts)
 *   PATCH  /api/admin/pilot-applications/:id/status   approve / reject (+notes)
 *   GET    /api/admin/audit-log                   append-only admin change history
 *
 * Every mutation is written to public.admin_audit_log (DB-enforced append-only).
 * Pricing governance (plan §1): prices live here, not in env; a gateway price
 * change is a NEW plan object at the gateway — the catalog row carries the new
 * price and the effective_scope decision is recorded in admin_audit_log.
 *
 * Validation/patch logic lives in lib/tiersModel.js (pure, contract-tested).
 */

import { Router } from "express";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import {
  APPLICATION_STATUSES, PRORATION_POLICIES,
  validateTierInput, buildTierPatch,
} from "../../lib/tiersModel.js";

const router    = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const ok        = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ── Audit helper ──────────────────────────────────────────────────────────── */
async function writeAudit(req, action, entityType, entityId, before, after) {
  const entry = {
    actor: req.user?.id ?? null,
    actor_label: req.user?.full_name || req.user?.email || "admin",
    action, entity_type: entityType, entity_id: entityId,
    before: before === undefined ? null : before,
    after:  after  === undefined ? null : after,
  };
  const { error } = await db.from("admin_audit_log").insert(entry);
  if (error) console.error("[admin:tiers] audit insert failed:", error.message);
}

const tierAuditView = (t) => t && ({
  name: t.name, platform: t.platform, access: t.access,
  price_monthly: t.price_monthly, price_annual: t.price_annual,
  cap: t.cap, student_cap: t.student_cap, instructor_cap: t.instructor_cap,
  duration_days: t.duration_days, gated_features: t.gated_features,
});

/* ── Tier catalog ──────────────────────────────────────────────────────────── */

router.get("/tiers", ...adminOnly, asyncHandler(async (req, res) => {
  const { data, error } = await db.from("tiers")
    .select("*").order("sort_order", { ascending: true }).order("name", { ascending: true });
  if (error) return res.status(500).json({ success: false, message: error.message });

  const learner = (data ?? []).filter((t) => t.platform === "learner");
  const school  = (data ?? []).filter((t) => t.platform === "school");
  return ok(res, { learner, school });
}));

router.post("/tiers", ...adminOnly, asyncHandler(async (req, res) => {
  const { errors, values } = validateTierInput(req.body);
  if (Object.keys(errors).length)
    return res.status(400).json({ success: false, code: "invalid_tier_fields", message: Object.values(errors).join("; "), fields: errors });

  const { data, error } = await db.from("tiers").insert(values).select().single();
  if (error) {
    if (error.code === "23505") return res.status(409).json({ success: false, code: "duplicate_tier", message: `A tier named “${values.name}” already exists for ${values.platform}` });
    console.error("[admin:tiers] insert failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not create the tier." });
  }
  await writeAudit(req, "tier.created", "tier", data.id, null, tierAuditView(data));
  return res.status(201).json({ success: true, data });
}));

router.patch("/tiers/:id", ...adminOnly, asyncHandler(async (req, res) => {
  const { data: current, error: fetchErr } = await db.from("tiers").select("*").eq("id", req.params.id).maybeSingle();
  if (fetchErr) return res.status(500).json({ success: false, message: fetchErr.message });
  if (!current) return res.status(404).json({ success: false, code: "not_found", message: "Tier not found." });

  const { patch, priceChanged, effective_scope, error } = buildTierPatch(current, req.body);
  if (error) return res.status(400).json({ success: false, code: error.code, message: error.message, fields: error.fields });

  if (!Object.keys(patch).length) return ok(res, current, { unchanged: true });

  patch.updated_at = new Date().toISOString();
  const { data, error: updateErr } = await db.from("tiers").update(patch).eq("id", req.params.id).select().single();
  if (updateErr) {
    if (updateErr.code === "23505") return res.status(409).json({ success: false, code: "duplicate_tier", message: "A tier with that name already exists for this platform" });
    console.error("[admin:tiers] update failed:", updateErr.message);
    return res.status(500).json({ success: false, message: "Could not save the tier." });
  }

  await writeAudit(req, "tier.updated", "tier", data.id, tierAuditView(current), tierAuditView(data));
  if (priceChanged) {
    await writeAudit(req, `tier.price_changed.${effective_scope}`, "tier", data.id,
      { price_monthly: current.price_monthly, price_annual: current.price_annual },
      { price_monthly: data.price_monthly,    price_annual: data.price_annual });
  }
  return ok(res, data, { effective_scope: priceChanged ? effective_scope : undefined });
}));

/* ── Subscription lifecycle settings ───────────────────────────────────────── */

router.get("/lifecycle-settings", ...adminOnly, asyncHandler(async (req, res) => {
  const { data, error } = await db.from("subscription_lifecycle_settings").select("*").eq("id", true).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: error.message });
  return ok(res, data ?? null);
}));

router.patch("/lifecycle-settings", ...adminOnly, asyncHandler(async (req, res) => {
  const patch = {};
  const errors = {};
  if (req.body.payment_retry_attempts !== undefined) {
    const n = Number(req.body.payment_retry_attempts);
    if (!Number.isInteger(n) || n < 0) errors.payment_retry_attempts = "Retry attempts must be 0 or more";
    else patch.payment_retry_attempts = n;
  }
  if (req.body.grace_period_days !== undefined) {
    const n = Number(req.body.grace_period_days);
    if (!Number.isInteger(n) || n < 0) errors.grace_period_days = "Grace period must be 0 or more days";
    else patch.grace_period_days = n;
  }
  if (req.body.proration_policy !== undefined) {
    if (!PRORATION_POLICIES.includes(req.body.proration_policy)) errors.proration_policy = "Proration policy must be immediate, prorate, or next-cycle";
    else patch.proration_policy = req.body.proration_policy;
  }
  if (Object.keys(errors).length)
    return res.status(400).json({ success: false, code: "invalid_settings", message: Object.values(errors).join("; "), fields: errors });

  if (!Object.keys(patch).length) {
    const { data } = await db.from("subscription_lifecycle_settings").select("*").eq("id", true).maybeSingle();
    return ok(res, data ?? null, { unchanged: true });
  }

  patch.updated_at = new Date().toISOString();
  const { data: before } = await db.from("subscription_lifecycle_settings").select("*").eq("id", true).maybeSingle();
  const { data, error } = await db.from("subscription_lifecycle_settings").update(patch).eq("id", true).select().single();
  if (error) return res.status(500).json({ success: false, message: error.message });

  await writeAudit(req, "lifecycle_settings.updated", "lifecycle_settings", "singleton", before ?? null, data);
  return ok(res, data);
}));

/* ── Pilot applications queue ──────────────────────────────────────────────── */

router.get("/pilot-applications", ...adminOnly, asyncHandler(async (req, res) => {
  const status  = APPLICATION_STATUSES.includes(req.query.status) ? req.query.status : null;
  const limit   = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const offset  = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  let q = db.from("pilot_applications").select("*", { count: "exact" })
    .order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (status) q = q.eq("status", status);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ success: false, message: error.message });

  // Counts per status for the queue badges.
  const counts = {};
  for (const s of APPLICATION_STATUSES) {
    const { count: c } = await db.from("pilot_applications").select("id", { count: "exact", head: true }).eq("status", s);
    counts[s] = c ?? 0;
  }
  return ok(res, data ?? [], { total: count ?? 0, counts });
}));

router.patch("/pilot-applications/:id/status", ...adminOnly, asyncHandler(async (req, res) => {
  const { status, review_notes } = req.body ?? {};
  if (!APPLICATION_STATUSES.includes(status) || status === "pending")
    return res.status(400).json({ success: false, code: "invalid_status", message: "status must be approved or rejected" });
  if (review_notes !== undefined && review_notes !== null && String(review_notes).length > 2000)
    return res.status(400).json({ success: false, code: "invalid_notes", message: "Notes are too long (2000 max)" });

  const { data: current } = await db.from("pilot_applications").select("*").eq("id", req.params.id).maybeSingle();
  if (!current) return res.status(404).json({ success: false, code: "not_found", message: "Application not found." });
  if (current.status !== "pending")
    return res.status(409).json({ success: false, code: "already_reviewed", message: `This application was already ${current.status}.` });

  const { data, error } = await db.from("pilot_applications")
    .update({ status, review_notes: review_notes ?? null, reviewed_by: req.user?.id ?? null, reviewed_at: new Date().toISOString() })
    .eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ success: false, message: error.message });

  await writeAudit(req, `application.${status}`, "pilot_application", data.id,
    { status: current.status }, { status: data.status, school_name: data.school_name });
  return ok(res, data);
}));

/* ── Audit log ─────────────────────────────────────────────────────────────── */

router.get("/audit-log", ...adminOnly, asyncHandler(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const { data, error, count } = await db.from("admin_audit_log").select("*", { count: "exact" })
    .order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return ok(res, data ?? [], { total: count ?? 0 });
}));

export default router;
