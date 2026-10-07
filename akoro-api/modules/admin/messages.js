/**
 * modules/admin/messages.js — the billing Messages admin surface
 * (plan §4.6 Phase 4: messaging delivery).
 *
 * All routes require role=admin. Mounted at /api/admin (modules/admin/index.js).
 *
 *   GET  /api/admin/messages?customer_id=|school_id=   message log, newest
 *        first (the customer/school detail "Messages" tables)
 *   GET  /api/admin/messages/audience?school_id=       instructor/student
 *        counts behind a school (the modal's audience labels)
 *   POST /api/admin/messages                           send — validates
 *        (lib/messageModel.js, prototype-exact errors), writes the row +
 *        admin_audit_log entry (+ subscription timeline entry when the
 *        message regards a subscription), then delivery runs in the
 *        background (modules/billing/delivery.js)
 *
 * The validation rules mirror the prototype's sendMessage() exactly: subject
 * required unless SMS, body always required, email/SMS need the matching
 * contact detail on file.
 */

import { Router } from "express";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { validateMessage } from "../../lib/messageModel.js";
import { queueMessage } from "../billing/delivery.js";

const router    = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const ok        = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ── row shaping ───────────────────────────────────────────────────────────── */

const MSG_SELECT =
  "id, customer_id, school_id, subscription_id, audience, channel, template, subject, body, " +
  "sent_by, sent_at, delivery_status, recipient_count, delivery_detail, created_at";

const msgView = (row) => ({
  id: row.id,
  customer_id: row.customer_id,
  school_id: row.school_id,
  subscription_id: row.subscription_id,
  audience: row.audience ?? null,
  channel: row.channel,
  template: row.template ?? null,
  subject: row.subject ?? "",
  body: row.body,
  sent_by: row.sent_by,
  sent_at: row.sent_at,
  delivery_status: row.delivery_status,
  recipient_count: row.recipient_count,
  delivery_detail: row.delivery_detail ?? null,
});

async function audit(req, action, entityType, entityId, before, after) {
  const { error } = await db.from("admin_audit_log").insert({
    actor: req.user?.id ?? null,
    actor_label: req.user?.full_name || req.user?.email || "admin",
    action, entity_type: entityType, entity_id: entityId,
    before: before ?? null, after: after ?? null,
  });
  if (error) console.error("[admin:messages] audit insert failed:", error.message);
}

/* ── GET /messages — the log, scoped to a customer or a school ─────────────── */

router.get("/messages", ...adminOnly, asyncHandler(async (req, res) => {
  const { customer_id, school_id } = req.query;
  if (!customer_id && !school_id)
    return res.status(400).json({ success: false, code: "missing_scope", message: "Scope the log with ?customer_id= or ?school_id=." });

  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
  let q = db.from("messages").select(MSG_SELECT);
  q = customer_id ? q.eq("customer_id", customer_id) : q.eq("school_id", school_id);
  const { data, error } = await q.order("sent_at", { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return ok(res, (data ?? []).map(msgView));
}));

/* ── GET /messages/audience — counts behind a school (modal labels) ────────── */

router.get("/messages/audience", ...adminOnly, asyncHandler(async (req, res) => {
  const { school_id } = req.query;
  if (!school_id)
    return res.status(404).json({ success: false, code: "not_found", message: "School not found." });

  const { data: school } = await db.from("pilot_schools")
    .select("id, school_profile_id").eq("id", school_id).maybeSingle();
  if (!school)
    return res.status(404).json({ success: false, code: "not_found", message: "School not found." });

  let instructors = 0, students = 0;
  if (school.school_profile_id) {
    const { count } = await db.from("school_teachers")
      .select("id", { count: "exact", head: true })
      .eq("school_id", school.school_profile_id).eq("status", "approved");
    instructors = count ?? 0;

    const { data: classrooms } = await db.from("classrooms")
      .select("id").eq("school_id", school.school_profile_id);
    const ids = (classrooms ?? []).map((c) => c.id);
    if (ids.length) {
      const { count: sc } = await db.from("classroom_students")
        .select("id", { count: "exact", head: true })
        .in("classroom_id", ids).eq("status", "active");
      students = sc ?? 0;
    }
  }
  return ok(res, { instructors, students, linked: Boolean(school.school_profile_id) });
}));

/* ── POST /messages — send ─────────────────────────────────────────────────── */

router.post("/messages", ...adminOnly, asyncHandler(async (req, res) => {
  const { customer_id, school_id, subscription_id, audience, channel, subject, body } = req.body ?? {};

  /* Resolve the context: a school message or a customer message. */
  let kind = null, customer = null, school = null, subscription = null;

  if (school_id) {
    kind = "school";
    const { data } = await db.from("pilot_schools")
      .select("id, name, contact_name, contact_email, contact_phone").eq("id", school_id).maybeSingle();
    if (!data) return res.status(404).json({ success: false, code: "not_found", message: "School not found." });
    school = data;
  } else {
    kind = "customer";
    if (subscription_id) {
      const { data } = await db.from("subscriptions")
        .select("id, customer_id, users!subscriptions_learner_user_id_fkey(full_name)").eq("id", subscription_id).maybeSingle();
      if (!data) return res.status(404).json({ success: false, code: "not_found", message: "Subscription not found." });
      subscription = data;
      const { data: c } = await db.from("customers").select("id, name, email, phone").eq("id", data.customer_id).maybeSingle();
      if (!c) return res.status(404).json({ success: false, code: "not_found", message: "Customer not found." });
      customer = c;
    } else if (customer_id) {
      const { data } = await db.from("customers").select("id, name, email, phone").eq("id", customer_id).maybeSingle();
      if (!data) return res.status(404).json({ success: false, code: "not_found", message: "Customer not found." });
      customer = data;
    } else {
      return res.status(400).json({ success: false, code: "missing_recipient", message: "Send to a customer, a subscription's customer, or a school." });
    }
  }

  /* Validate (prototype-exact messages). */
  const { errors } = validateMessage({
    kind, channel, audience,
    subject, body,
    target: kind === "customer"
      ? { email: customer.email, phone: customer.phone }
      : { adminEmail: school.contact_email, adminPhone: school.contact_phone },
  });
  if (errors.length)
    return res.status(400).json({ success: false, code: "invalid_message", message: errors[0].message, fields: errors });

  const actorLabel = req.user?.full_name || req.user?.email || "admin";
  const regarding  = subscription ? `SUB-${String(subscription.id).slice(0, 4).toUpperCase()}` : null;

  /* Audit + timeline (prototype logAudit + sub timeline entry). */
  const CHANNEL_LABEL = { email: "Email", sms: "SMS", inapp: "In-app notice" }[channel];
  const toName = kind === "school" ? school.name : customer.name;
  const preview = ((subject ?? "").trim() || body.trim()).slice(0, 40);
  await audit(req, "message.sent", kind === "school" ? "pilot_school" : "customer", (kind === "school" ? school : customer).id,
    null,
    { channel: CHANNEL_LABEL, to: toName, regarding, subject: preview });

  if (subscription_id) {
    const { error: evErr } = await db.from("subscription_events").insert({
      subscription_id: subscription_id,
      text: `${CHANNEL_LABEL} sent to ${toName}: ${preview}`,
    });
    if (evErr) console.error("[admin:messages] event insert failed:", evErr.message);
  }

  /* Queue + background delivery. */
  let queued;
  try {
    queued = await queueMessage({
      customerId: kind === "customer" ? customer.id : null,
      schoolId: kind === "school" ? school.id : null,
      subscriptionId: kind === "customer" ? (subscription_id ?? null) : null,
      audience: kind === "school" ? audience : null,
      channel, subject: (subject ?? "").trim() || null, body: body.trim(),
      sentBy: actorLabel,
    });
  } catch (e) {
    console.error("[admin:messages] queue failed:", e.message);
    return res.status(500).json({ success: false, message: "The message could not be queued." });
  }

  return res.status(201).json({ success: true, data: { id: queued.id, delivery_status: "queued" } });
}));

export default router;
