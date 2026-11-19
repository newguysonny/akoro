/**
 * Privacy-minimised context for the authenticated learner's agent tools.
 *
 * Do not return email, phone, authentication, payment, or notification-contact
 * data to an LLM. The tool is intended to adapt study language and safely turn
 * a human time request into an account-local instant—not to expose a profile.
 */
import db from "../db.js";
import { localiseInstant, resolveLearnerTimeZone } from "./learnerTime.js";

const PROFILE_FIELDS = "full_name, username, city, country, language, school_name, year_group, study_level, subjects, created_at";
const PROFILE_FIELDS_BASE = "full_name, username, country, language, school_name, year_group, study_level, subjects, created_at";

function text(value, max = 120) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function preferredName(user) {
  const name = text(user?.full_name);
  if (name) return name.split(" ")[0];
  return text(user?.username, 60) || null;
}

function cleanSubjects(subjects) {
  if (!Array.isArray(subjects)) return [];
  return subjects.map((subject) => text(subject, 80)).filter(Boolean).slice(0, 20);
}

// Keep the personalisation tool useful while a rolling deployment is waiting
// for the additive city migration. It simply omits city until the schema lands.
async function learnerProfile(userId) {
  const result = await db.from("users").select(PROFILE_FIELDS).eq("id", userId).maybeSingle();
  if (!result.error) return result;
  return db.from("users").select(PROFILE_FIELDS_BASE).eq("id", userId).maybeSingle();
}

async function userTimeZonePreference(userId) {
  const { data, error } = await db.from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    // Timezone is a convenience hint, never a reason to hide all useful study
    // context. The returned source makes the default transparent to the model.
    console.warn("[learner-context] account time-zone lookup failed:", error.message);
    return undefined;
  }
  const settings = data?.settings;
  return settings && typeof settings === "object" ? settings.timezone : undefined;
}

/** Read the caller's own safe personalisation context. */
export async function getLearnerProfileContext(userId, { now = new Date() } = {}) {
  if (!userId) throw new Error("An authenticated learner is required");
  const [{ data: user, error }, configuredTimeZone] = await Promise.all([
    learnerProfile(userId),
    userTimeZonePreference(userId),
  ]);
  if (error) throw new Error("Could not load learner profile context");
  if (!user) throw new Error("Learner profile was not found");

  const zone = resolveLearnerTimeZone({ configuredTimeZone });
  const instant = new Date(now);
  const nowIso = Number.isFinite(instant.getTime()) ? instant.toISOString() : new Date().toISOString();
  return {
    preferredName: preferredName(user),
    language: text(user.language, 80) || "English",
    city: text(user.city, 120) || null,
    country: text(user.country, 80) || null,
    schoolName: text(user.school_name, 120) || null,
    studyLevel: text(user.study_level, 80) || null,
    yearGroup: text(user.year_group, 80) || null,
    subjects: cleanSubjects(user.subjects),
    memberSince: user.created_at ? new Date(user.created_at).toISOString() : null,
    timeZone: zone.timeZone,
    timeZoneSource: zone.source,
    now: nowIso,
    localNow: localiseInstant(nowIso, zone.timeZone),
  };
}
