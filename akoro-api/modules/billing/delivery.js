/**
 * modules/billing/delivery.js — plan §4.3 `message-delivery` (Phase 4).
 *
 * One place that turns a `messages` row into an actual send:
 *
 *   email → Resend (modules/auth/emails.js sendGenericEmail), From
 *           address/branding from billing_settings
 *   sms   → Twilio (config.twilio; dynamic import — no-op when unconfigured)
 *   inapp → public.notifications rows (type "announcement", the pattern the
 *           existing announcements/send endpoint uses)
 *
 * Recipient resolution:
 *   customer messages → the customer's email / phone; in-app goes to the
 *                       learner accounts under the customer's subscriptions
 *   school messages   → audience admins: the pilot school's admin contact
 *                       (in-app: the linked school_profiles admin user);
 *                       instructors: approved school_teachers users;
 *                       students: active classroom_students of the school's
 *                       classrooms; all: the union
 *
 * queueMessage() inserts the row (delivery_status 'queued') and fires the
 * delivery attempt in the background; a 5-minute cron sweep retries anything
 * still queued after 10 minutes (provider outage recovery). Content fields
 * are locked after insert by the 2026-billing-messaging.sql triggers — only
 * delivery_status / recipient_count / delivery_detail ever change.
 */

import cron from "node-cron";
import db from "../../db.js";
import config from "../../config/index.js";
import { sendGenericEmail } from "../auth/emails.js";

/* ── settings ──────────────────────────────────────────────────────────────── */

export async function getBillingSettings() {
  try {
    const { data } = await db.from("billing_settings").select("*").eq("id", true).maybeSingle();
    if (data) return data;
  } catch { /* table not migrated yet — fall through to defaults */ }
  return {
    email_from_name: "Akoro",
    email_from_address: process.env.RESEND_FROM_EMAIL || "noreply@akoro.app",
    support_email: null,
    notify_payment_failed: true,
    notify_trial_ending: true,
    notify_pilot_ending: true,
  };
}

/* ── queue ─────────────────────────────────────────────────────────────────── */

/**
 * Insert a message row and attempt delivery in the background. Returns the
 * inserted row (delivery_status still 'queued' — it settles asynchronously;
 * the admin UI reads the final status from GET /api/admin/messages).
 */
export async function queueMessage({ customerId = null, schoolId = null, subscriptionId = null, audience = null, channel, template = null, subject = null, body, sentBy }) {
  const { data: row, error } = await db.from("messages").insert({
    customer_id: customerId,
    school_id: schoolId,
    subscription_id: subscriptionId,
    audience,
    channel,
    template,
    subject: subject ?? null,
    body,
    sent_by: sentBy,
    delivery_status: "queued",
  }).select("id").single();
  if (error) throw new Error(`message insert failed: ${error.message}`);

  // Fire-and-forget: the caller responds immediately; delivery settles on the
  // row (and the sweep below retries anything stranded by an outage).
  deliverMessage(row.id).catch((e) => console.error("[message-delivery] immediate attempt failed:", e.message));
  return row;
}

/* ── recipient resolution ──────────────────────────────────────────────────── */

async function schoolUserIds(schoolProfileId, audience) {
  if (!schoolProfileId) return [];
  const ids = new Set();

  if (audience === "admins" || audience === "all") {
    const { data: profile } = await db.from("school_profiles")
      .select("admin_user_id").eq("id", schoolProfileId).maybeSingle();
    if (profile?.admin_user_id) ids.add(profile.admin_user_id);
  }
  if (audience === "instructors" || audience === "all") {
    const { data: teachers } = await db.from("school_teachers")
      .select("teacher_id").eq("school_id", schoolProfileId).eq("status", "approved");
    for (const t of teachers ?? []) ids.add(t.teacher_id);
  }
  if (audience === "students" || audience === "all") {
    const { data: classrooms } = await db.from("classrooms")
      .select("id").eq("school_id", schoolProfileId);
    for (const c of classrooms ?? []) {
      const { data: students } = await db.from("classroom_students")
        .select("user_id").eq("classroom_id", c.id).eq("status", "active");
      for (const s of students ?? []) ids.add(s.user_id);
    }
  }
  return [...ids];
}

/**
 * Resolve who a message actually reaches, per channel.
 * Returns { emails: [], phones: [], userIds: [] }.
 */
async function resolveRecipients(message) {
  const out = { emails: [], phones: [], userIds: [] };

  if (message.school_id) {
    const { data: school } = await db.from("pilot_schools")
      .select("id, name, contact_email, contact_phone, school_profile_id")
      .eq("id", message.school_id).maybeSingle();
    if (!school) return out;

    const adminEmail = school.contact_email ?? null;
    const adminPhone = school.contact_phone ?? null;
    const audience   = message.audience ?? "all";

    // The admin contact is the destination for admins/all email + admins SMS.
    if (message.channel === "email" && (audience === "admins" || audience === "all") && adminEmail)
      out.emails.push(adminEmail);
    if (message.channel === "sms" && (audience === "admins" || audience === "all") && adminPhone)
      out.phones.push(adminPhone);

    // Platform users behind the audience (in-app notices always; email/SMS for
    // instructor/student/all audiences resolve to their contact details).
    const userIds = await schoolUserIds(school.school_profile_id, audience);
    if (message.channel === "inapp") {
      out.userIds.push(...userIds);
    } else {
      if (!userIds.length) return out;
      const { data: users } = await db.from("users")
        .select("id, email, phone").in("id", userIds);
      for (const u of users ?? []) {
        if (message.channel === "email" && u.email) out.emails.push(u.email);
        if (message.channel === "sms" && u.phone)   out.phones.push(u.phone);
      }
    }
    return out;
  }

  // Customer message: the parent is the email/SMS destination; in-app notices
  // go to the learner accounts under the customer's subscriptions.
  if (!message.customer_id) return out;
  const { data: customer } = await db.from("customers")
    .select("id, email, phone").eq("id", message.customer_id).maybeSingle();
  if (!customer) return out;

  if (message.channel === "email" && customer.email) out.emails.push(customer.email);
  if (message.channel === "sms" && customer.phone)   out.phones.push(customer.phone);
  if (message.channel === "inapp") {
    const { data: subs } = await db.from("subscriptions")
      .select("learner_user_id").eq("customer_id", message.customer_id).not("learner_user_id", "is", null);
    out.userIds.push(...(subs ?? []).map((s) => s.learner_user_id));
  }
  return out;
}

/* ── channel senders ───────────────────────────────────────────────────────── */

async function sendSms(phones, body) {
  const { accountSid, authToken, phoneNumber } = config.twilio ?? {};
  if (!accountSid || !authToken || !phoneNumber)
    throw new Error("SMS provider not configured (TWILIO_* env)");
  const twilio = (await import("twilio")).default;
  const client = twilio(accountSid, authToken);
  for (const to of phones) {
    await client.messages.create({ to, from: phoneNumber, body });
  }
}

async function sendInApp(userIds, subject, body) {
  if (!userIds.length) return;
  const rows = userIds.map((user_id) => ({
    user_id,
    type: "announcement",
    title: subject || body.slice(0, 60),
    content: body,
    is_read: false,
  }));
  // Insert in reasonable batches; a school-wide notice can be large.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("notifications").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`notification insert failed: ${error.message}`);
  }
}

/* ── delivery ──────────────────────────────────────────────────────────────── */

async function settle(messageId, patch) {
  const { error } = await db.from("messages").update(patch).eq("id", messageId);
  if (error) console.error("[message-delivery] status update failed:", error.message);
}

export async function deliverMessage(messageId) {
  const { data: message } = await db.from("messages")
    .select("*").eq("id", messageId).maybeSingle();
  if (!message || message.delivery_status === "sent") return;

  try {
    const recipients = await resolveRecipients(message);
    const count =
      message.channel === "email" ? recipients.emails.length
      : message.channel === "sms" ? recipients.phones.length
      : recipients.userIds.length;
    if (!count) {
      await settle(messageId, { delivery_status: "no_recipient", recipient_count: 0, delivery_detail: "No matching recipient on file for this channel." });
      return;
    }

    if (message.channel === "email") {
      const settings = await getBillingSettings();
      const bodyText = message.body;
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
<p style="font-size:15px;line-height:1.65;color:#4B4956;margin:0 0 16px;white-space:pre-line;">${message.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
${settings.support_email ? `<p style="font-size:13px;color:#6B6976;margin:0;">Questions? <a href="mailto:${settings.support_email}" style="color:#E8884A;">${settings.support_email}</a></p>` : ""}
</div>`;
      await sendGenericEmail({
        to: recipients.emails,
        subject: message.subject || "A note from Akoro",
        text: bodyText,
        html,
        fromName: settings.email_from_name,
        fromAddress: settings.email_from_address,
      });
    } else if (message.channel === "sms") {
      await sendSms(recipients.phones, message.body);
    } else {
      await sendInApp(recipients.userIds, message.subject, message.body);
    }

    await settle(messageId, { delivery_status: "sent", recipient_count: count, delivery_detail: null });
  } catch (e) {
    await settle(messageId, { delivery_status: "failed", delivery_detail: e.message?.slice(0, 300) ?? "delivery failed" });
    throw e;
  }
}

/* ── sweep: retry anything stranded by an outage (plan §4.3 job) ───────────── */

cron.schedule("*/5 * * * *", async () => {
  try {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: stranded } = await db.from("messages")
      .select("id")
      .eq("delivery_status", "queued")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(50);
    for (const m of stranded ?? []) {
      try { await deliverMessage(m.id); } catch { /* settle() already recorded the failure */ }
    }
  } catch (e) {
    console.error("[message-delivery] sweep failed:", e.message);
  }
});
