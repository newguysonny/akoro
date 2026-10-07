/**
 * lib/messageModel.js — pure logic for the billing Messages feature
 * (plan §4.6 Phase 4: messaging delivery).
 *
 * Everything here is pure: no db, no fetch. Contract-tested in
 * lib/messageModel.contract.test.mjs. The strings (labels, templates,
 * validation messages) are prototype-exact — the admin "Send message"
 * modal in reference/Admin-Tiers & Credits prototype page.md is the
 * source of truth.
 *
 * Delivery (email/SMS/in-app) lives in modules/billing/delivery.js;
 * the admin API surface in modules/admin/messages.js.
 */

/* ── Labels ────────────────────────────────────────────────────────────────── */

export const CHANNEL_LABELS = { email: "Email", sms: "SMS", inapp: "In-app notice" };

export const AUDIENCE_LABELS = {
  admins:      "School administrators",
  instructors: "Instructors",
  students:    "Students",
  all:         "Everyone at the school",
};

export const CHANNELS    = ["email", "sms", "inapp"];
export const AUDIENCES   = ["admins", "instructors", "students", "all"];

/* ── Templates (prototype-exact subject/body pairs) ───────────────────────── */

export const CUSTOMER_TEMPLATES = [
  ["payment", "Payment reminder"],
  ["trial",   "Trial ending"],
  ["general", "General note"],
];

export const SCHOOL_TEMPLATES = [
  ["pilot-end", "Pilot ending"],
  ["cap",       "Credit usage update"],
  ["general",   "General note"],
];

const TEMPLATES = {
  payment: [
    "Payment reminder for {learner}",
    "Hi {parent}, we could not process the latest payment for {learner}'s Akoro plan. Please update your payment details so learning is not interrupted. Thank you.",
  ],
  trial: [
    "{learner}'s Akoro trial is ending soon",
    "Hi {parent}, {learner}'s free trial ends soon. Upgrade to Premium to keep Battles, voice tutoring and the full AI credit allowance.",
  ],
  general: [
    "A note from Akoro",
    "Hi {parent}, ",
  ],
  "pilot-end": [
    "The Akoro pilot for {school} ends on {end}",
    "Hello from Akoro. The pilot for {school} ends on {end}. Let us know if you would like to continue on Freemium or Premium so nobody loses access.",
  ],
  cap: [
    "Credit usage update for {school}",
    "Hello from Akoro. {school} has used most of its pilot AI credits for this period. Let us know if you would like to discuss adjusting the allowance.",
  ],
};

/** Fill a template's {parent}/{learner}/{school}/{end} placeholders. */
export function fillTemplate(template, ctx = {}) {
  const pair = TEMPLATES[template];
  if (!pair) return null;
  const fill = (str) => String(str)
    .replaceAll("{parent}",  ctx.parent  ?? "")
    .replaceAll("{learner}", ctx.learner ?? "")
    .replaceAll("{school}",  ctx.school  ?? "")
    .replaceAll("{end}",     ctx.end     ?? "");
  return { subject: fill(pair[0]), body: fill(pair[1]) };
}

/* ── Validation (mirrors the prototype's sendMessage() checks) ─────────────── */

/**
 * Validate an outbound message. `target` describes what is on file:
 *   {
 *     kind:     'customer' | 'school',
 *     audience: 'admins'|'instructors'|'students'|'all' | null (customer),
 *     email:    customer email on file        (customer messages),
 *     phone:    customer phone on file        (customer messages),
 *     adminEmail: school admin contact email  (school messages),
 *     adminPhone: school admin contact phone  (school messages),
 *   }
 * Returns { errors: [{ field, message }] } — empty means valid. Messages are
 * prototype-exact so the admin modal can toast them verbatim.
 */
export function validateMessage({ kind, channel, audience, subject, body, target = {} }) {
  const errors = [];

  if (!CHANNELS.includes(channel))
    errors.push({ field: "channel", message: "Choose a channel — email, SMS, or in-app notice." });
  if (kind === "school" && !AUDIENCES.includes(audience))
    errors.push({ field: "audience", message: "Choose an audience for the school message." });
  if (kind !== "school" && kind !== "customer")
    errors.push({ field: "kind", message: "A message goes to a customer or a school." });

  const subj = (subject ?? "").trim();
  const bod  = (body ?? "").trim();

  if (channel && channel !== "sms" && !subj)
    errors.push({ field: "subject", message: "Add a subject" });
  if (!bod)
    errors.push({ field: "body", message: "Write a message first" });

  if (!errors.length) {
    if (kind === "customer") {
      if (channel === "email" && !target.email)
        errors.push({ field: "channel", message: "No email on file" });
      if (channel === "sms" && !target.phone)
        errors.push({ field: "channel", message: "No phone number on file" });
    } else if (kind === "school") {
      // The prototype routes admins/all email + admins SMS through the school's
      // admin contact; instructor/student/all in-app notices need the linked
      // platform school (resolved at delivery, honestly reported after).
      if (channel === "email" && (audience === "admins" || audience === "all") && !target.adminEmail)
        errors.push({ field: "channel", message: "No admin contact email on file" });
      if (channel === "sms" && audience === "admins" && !target.adminPhone)
        errors.push({ field: "channel", message: "No admin contact phone on file" });
    }
  }

  return { errors };
}

/** SMS messages have no subject; everything else needs one. */
export const subjectVisible = (channel) => channel !== "sms";
