/**
 * lib/tiersModel.js — pure validation + patch logic for the Tiers & Credits
 * admin (plan §4.6 Phase 1) and the public pilot-application form.
 *
 * Kept free of db/express imports so contract tests can load it directly
 * (same pattern as lib/usageMeter.js).
 *
 *   validateTierInput(body)        → { errors, values }   create-time validation
 *   buildTierPatch(current, body)  → { patch, priceChanged, effective_scope, error }
 *                                    update-time diffing + pricing governance
 *   validatePilotApplication(body) → { errors, values }   public /apply form rules
 */

export const TIER_PLATFORMS    = ["learner", "school"];
export const TIER_ACCESS       = ["free", "paid"];
export const APPLICATION_STATUSES = ["pending", "approved", "rejected"];
export const PRORATION_POLICIES   = ["immediate", "prorate", "next-cycle"];
export const EFFECTIVE_SCOPES     = ["new_only", "all"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const toInt = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
};

/* ── Tier create validation ────────────────────────────────────────────────── */

export function validateTierInput(body = {}) {
  const errors = {};
  const values = {};

  if (!TIER_PLATFORMS.includes(body.platform)) errors.platform = "platform must be learner or school";
  else values.platform = body.platform;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) errors.name = "Give the tier a name";
  else if (name.length > 60) errors.name = "Tier name is too long (60 max)";
  else values.name = name;

  const access = body.access ?? "free";
  if (!TIER_ACCESS.includes(access)) errors.access = "access must be free or paid";
  else {
    values.access = access;
    values.price_monthly = 0;
    values.price_annual  = 0;
    if (access === "paid") {
      const m = toInt(body.price_monthly);
      const a = toInt(body.price_annual);
      if (m === null || Number.isNaN(m) || m < 0) errors.price_monthly = "Monthly price must be 0 or more";
      if (a === null || Number.isNaN(a) || a < 0) errors.price_annual  = "Annual price must be 0 or more";
      if (!errors.price_monthly && !errors.price_annual) { values.price_monthly = m; values.price_annual = a; }
    }
  }

  if (values.platform === "learner") {
    const cap = toInt(body.cap);
    if (cap === null || Number.isNaN(cap) || cap < 0) errors.cap = "Credit cap must be 0 or more";
    else values.cap = cap;
    values.student_cap = null;
    values.instructor_cap = null;
  } else if (values.platform === "school") {
    const s = toInt(body.student_cap);
    const i = toInt(body.instructor_cap);
    if (s === null || Number.isNaN(s) || s < 0) errors.student_cap = "Student cap must be 0 or more";
    if (i === null || Number.isNaN(i) || i < 0) errors.instructor_cap = "Instructor cap must be 0 or more";
    if (!errors.student_cap && !errors.instructor_cap) { values.student_cap = s; values.instructor_cap = i; }
    values.cap = null;
  }

  if (body.duration_days === null || body.duration_days === undefined || body.duration_days === "") {
    values.duration_days = null;
  } else {
    const d = toInt(body.duration_days);
    if (Number.isNaN(d) || d < 1) errors.duration_days = "Duration must be at least 1 day";
    else values.duration_days = d;
  }

  let gated = body.gated_features ?? [];
  if (!Array.isArray(gated)) errors.gated_features = "gated_features must be a list";
  else {
    gated = gated.map(String);
    if (gated.some((f) => !f.trim() || f.length > 80)) errors.gated_features = "Feature names must be 1-80 characters";
    else values.gated_features = gated;
  }

  return { errors, values };
}

/* ── Tier update diffing + pricing governance ──────────────────────────────── */

/**
 * Build a PATCH payload against the current tier row.
 * Returns { patch, priceChanged, effective_scope, error } — error is
 * { code, message, fields } when the change is invalid, including the plan §1
 * rule: a price change MUST carry effective_scope ('new_only' | 'all') so a
 * re-pricing of existing subscribers is always an explicit decision.
 */
export function buildTierPatch(current, body = {}) {
  const patch = {};
  const errors = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) errors.name = "Tier name cannot be empty";
    else if (name.length > 60) errors.name = "Tier name is too long (60 max)";
    else if (name !== current.name) patch.name = name;
  }
  if (body.access !== undefined) {
    if (!TIER_ACCESS.includes(body.access)) errors.access = "access must be free or paid";
    else if (body.access !== current.access) patch.access = body.access;
  }
  for (const key of ["price_monthly", "price_annual"]) {
    if (body[key] === undefined) continue;
    const n = toInt(body[key]);
    if (n === null || Number.isNaN(n) || n < 0) { errors[key] = "Price must be 0 or more"; continue; }
    if (n !== current[key]) patch[key] = n;
  }
  if (body.access === "free") {
    // A free tier carries no price.
    if ((current.price_monthly ?? 0) !== 0) patch.price_monthly = 0;
    if ((current.price_annual  ?? 0) !== 0) patch.price_annual  = 0;
  }
  for (const key of ["cap", "student_cap", "instructor_cap"]) {
    if (body[key] === undefined) continue;
    if (body[key] === null || body[key] === "") { if (current[key] !== null) patch[key] = null; continue; }
    const n = toInt(body[key]);
    if (Number.isNaN(n) || n < 0) { errors[key] = "Cap must be 0 or more"; continue; }
    if (n !== current[key]) patch[key] = n;
  }
  if (body.duration_days !== undefined) {
    if (body.duration_days === null || body.duration_days === "") {
      if (current.duration_days !== null) patch.duration_days = null;
    } else {
      const d = toInt(body.duration_days);
      if (Number.isNaN(d) || d < 1) errors.duration_days = "Duration must be at least 1 day";
      else if (d !== current.duration_days) patch.duration_days = d;
    }
  }
  if (body.gated_features !== undefined) {
    if (!Array.isArray(body.gated_features)) errors.gated_features = "gated_features must be a list";
    else {
      const gated = body.gated_features.map(String);
      if (gated.some((f) => !f.trim() || f.length > 80)) errors.gated_features = "Feature names must be 1-80 characters";
      else {
        const cur = current.gated_features ?? [];
        if (gated.length !== cur.length || gated.some((f) => !cur.includes(f))) patch.gated_features = gated;
      }
    }
  }
  if (body.sort_order !== undefined) {
    const n = toInt(body.sort_order);
    if (Number.isNaN(n)) errors.sort_order = "sort_order must be a number";
    else if (n !== current.sort_order) patch.sort_order = n;
  }

  if (Object.keys(errors).length) return { error: { code: "invalid_tier_fields", message: Object.values(errors).join("; "), fields: errors } };

  const priceChanged =
    (patch.price_monthly !== undefined && patch.price_monthly !== current.price_monthly) ||
    (patch.price_annual  !== undefined && patch.price_annual  !== current.price_annual);

  if (priceChanged && !EFFECTIVE_SCOPES.includes(body.effective_scope)) {
    return { error: {
      code: "effective_scope_required",
      message: "This change affects pricing. Choose whether it applies to new subscribers only, or to all existing subscribers, effective now.",
    } };
  }

  return { patch, priceChanged, effective_scope: priceChanged ? body.effective_scope : undefined };
}

/* ── Public pilot-application rules (reference/Pilot application.md) ───────── */

export function validatePilotApplication(body = {}) {
  const errors = {};
  const values = {};

  const str = (v) => (typeof v === "string" ? v.trim() : v === undefined || v === null ? "" : String(v).trim());

  const schoolName = str(body.school_name ?? body.schoolName);
  if (!schoolName) errors.school_name = "Please tell us your school's name.";
  else if (schoolName.length > 200) errors.school_name = "School name is too long (200 max).";
  else values.school_name = schoolName;

  const stateCity = str(body.state_city ?? body.stateCity);
  if (!stateCity) errors.state_city = "State / city is required.";
  else if (stateCity.length > 120) errors.state_city = "State / city is too long (120 max).";
  else values.state_city = stateCity;

  const students = Number(body.est_students ?? body.estStudents);
  if (!Number.isInteger(students) || students < 1) errors.est_students = "Estimated students must be at least 1.";
  else values.est_students = students;

  const contactName = str(body.contact_name ?? body.contactName);
  if (!contactName) errors.contact_name = "Your name is required.";
  else if (contactName.length > 200) errors.contact_name = "Contact name is too long (200 max).";
  else values.contact_name = contactName;

  const email = str(body.contact_email ?? body.contactEmail).toLowerCase();
  if (!EMAIL_RE.test(email)) errors.contact_email = "Please enter a valid email address.";
  else if (email.length > 254) errors.contact_email = "Email address is too long.";
  else values.contact_email = email;

  const phone = str(body.contact_phone ?? body.contactPhone);
  if (phone.length < 7) errors.contact_phone = "Phone number looks too short.";
  else if (phone.length > 30) errors.contact_phone = "Phone number is too long.";
  else values.contact_phone = phone;

  const message = str(body.message ?? "");
  if (message.length > 2000) errors.message = "Message is too long (2000 max).";
  else values.message = message || null;

  return { errors, values };
}
