/**
 * Pure profile rules: constants, predicates and normalisers.
 *
 * Nothing here touches the database or Express. Keeping these functions pure
 * makes the ownership and validation decisions reusable by the services and
 * directly testable without a Supabase connection.
 */

// Optional Management/Facilities modules that new schools start with DISABLED
// (only essential system areas are on by default). Keys mirror the school
// app's sidebar moduleKeys / Module Settings TOGGLE_MODULES.
export const DEFAULT_OFF_MODULES = [
  "fees_collection", "accounts_finance", "front_office", "offline_examinations",
  "cbc_academics", "online_examinations", "human_resource", "ptm",
  "lesson_planner", "digital_evaluation", "qr_attendance", "study_center",
  "communications", "library", "inventory", "transport", "hostel",
  "asset_management",
];

export const FREE_STUDENT_LIMIT     = 20;
export const UPGRADE_PRICE_KOBO     = 500_000;   // ₦5,000
export const UPGRADE_PRICE_NGN      = 5000;
export const TEMP_PASSWORD_LENGTH   = 10;

export const PROFILE_SELECT = [
  "id","email","username","full_name","avatar_url","avatar_emoji","phone","role",
  "country","city","school_name","school_type","year_group","study_level","discipline",
  "language","display_mode","accent_color","teaching_guide","guide_emoji",
  "subjects","two_factor_enabled","onboarding_completed","created_at",
  "password_hash",   // presence only — surfaced as hasPassword, never returned
].join(",");

// Fallback select without columns added by pending migrations
export const PROFILE_SELECT_BASE = [
  "id","email","username","full_name","avatar_url","phone","role",
  "country","school_name","school_type","year_group","study_level","discipline",
  "language","display_mode","accent_color","teaching_guide","guide_emoji",
  "subjects","two_factor_enabled","created_at","password_hash",
].join(",");

// Keep generic JSON settings from turning an arbitrary display string into a
// timezone used by notifications, tasks, or the learner agent.
export const isIanaTimeZone = (value) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) return false;
  try { Intl.DateTimeFormat("en-US", { timeZone: value.trim() }); return true; }
  catch { return false; }
};

export const slugBaseFromName = (name) =>
  (name || "school").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "school";

export const usernameFromEmail = (email, fallback) =>
  (email?.split("@")[0] ?? fallback).replace(/[^a-zA-Z0-9_]/g, "_");

export const escHtml = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * "JSS1", "JSS 1", "Primary 4", "SSS 2" → the level and the form's own label.
 */
export const readLevel = (name) => {
  const m = String(name || "").trim().match(/^\s*(primary|pry|jss|js|sss|ss)\s*([0-9]+)/i);
  if (!m) return null;
  const kind = m[1].toLowerCase(), n = m[2];
  if (kind === "primary" || kind === "pry") return { studyLevel: "Primary",          yearGroup: `Primary ${n}` };
  if (kind === "jss" || kind === "js")      return { studyLevel: "Junior Secondary", yearGroup: `JSS ${n}` };
  return { studyLevel: "Senior Secondary", yearGroup: `SSS ${n}` };
};

/**
 * A learner can be in several rooms — a real class like JSS1 alongside a
 * catch-all like "Westwood Academy · Class A". Taking whichever came back
 * first filled the form from the one that says nothing. Prefer the room that
 * actually names a year, then one attached to a school.
 */
export const pickPrefillRoom = (rooms) =>
  rooms.find((r) => readLevel(r.name) && r.school_id)
  ?? rooms.find((r) => readLevel(r.name))
  ?? rooms.find((r) => r.school_id)
  ?? rooms[0];

export const parseCsvRows = (text) => {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const header = lines[0].toLowerCase();
  return header.includes("name") ? lines.slice(1) : lines;
};

export const parseCsvRow = (line) =>
  line.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));

export const normaliseInviteEmails = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((e) => typeof e === "string" && /^[^\s@]+@[^\s@]+$/.test(e)).slice(0, 50);

/** .or() takes a filter string; strip characters that could inject filters. */
export const safeSearchTerm = (value) =>
  String(value || "").replace(/[%_,()]/g, " ").trim();

export const notificationPreferenceRow = (userId, body, updatedAt) => {
  const {
    email, sms, push, whatsapp, whatsappNumber,
    sessionReminders, sessionStarted, sessionCancelled,
    announcements, qaReplies, reminderEmails,
  } = body;

  const row = { user_id: userId, updated_at: updatedAt };
  if (email           !== undefined) row.email_enabled              = email;
  if (sms             !== undefined) row.sms_enabled                = sms;
  if (push            !== undefined) row.push_enabled               = push;
  if (whatsapp        !== undefined) row.whatsapp_enabled           = whatsapp;
  if (whatsappNumber  !== undefined) row.whatsapp_number            = whatsappNumber;
  if (sessionReminders!== undefined) row.notify_session_reminders   = sessionReminders;
  if (sessionStarted  !== undefined) row.notify_session_started     = sessionStarted;
  if (sessionCancelled!== undefined) row.notify_session_cancelled   = sessionCancelled;
  if (announcements   !== undefined) row.notify_new_announcements   = announcements;
  if (qaReplies       !== undefined) row.notify_qa_replies          = qaReplies;
  if (reminderEmails  !== undefined) row.notify_agent_reminders     = reminderEmails;
  return row;
};
