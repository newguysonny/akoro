/**
 * Supabase reads and writes for user accounts, settings and notifications.
 * Query construction lives here; services decide what the result means.
 */
import db from "../../db.js";
import { PROFILE_SELECT, PROFILE_SELECT_BASE } from "./rules.js";

export function findUserForStudent(email, phone) {
  // Check existing
  let query = db.from("users").select("id, email, full_name, role");
  if (email) query = query.eq("email", email.toLowerCase().trim());
  else       query = query.eq("phone", phone);
  return query.single();
}

export const insertStudentUser = (row) =>
  db.from("users").insert(row).select("id, email, full_name, username, role").single();

export const getUserFullName = (userId) =>
  db.from("users").select("full_name").eq("id", userId).single();

export const getUserFullNameMaybe = (userId) =>
  db.from("users").select("full_name").eq("id", userId).maybeSingle();

export const updateUserById = (userId, patch) =>
  db.from("users").update(patch).eq("id", userId);

export const findUserIdByEmail = (email) =>
  db.from("users").select("id").eq("email", email).single();

export const getUserIdentity = (id) =>
  db.from("users").select("id, full_name, email").eq("id", id).single();

export const getUserIdentityMaybe = (id) =>
  db.from("users").select("id, full_name").eq("id", id).maybeSingle();

export const insertTeacherUser = (row) =>
  db.from("users").insert(row).select("id, full_name, email").single();

export const getUserProfile = (userId) =>
  db.from("users").select(PROFILE_SELECT).eq("id", userId).maybeSingle();

export const getUserProfileBase = (userId) =>
  db.from("users").select(PROFILE_SELECT_BASE).eq("id", userId).maybeSingle();

/** GET /me: retry with base columns when the full projection is unavailable. */
export async function readProfileWithFallback(userId) {
  let { data: user, error: userErr } = await getUserProfile(userId);

  // If the full select fails (e.g. pending migration columns), retry with base columns
  if (userErr || !user) {
    ({ data: user } = await getUserProfileBase(userId));
  }
  return { data: user };
}

/**
 * PATCH /me confirmation read. Unlike GET /me, a failed base read is surfaced
 * so a successful write is not reported as a failed one.
 */
export async function readProfileForConfirmation(userId) {
  let { data: updated, error: profileReadError } = await db.from("users")
    .select(PROFILE_SELECT).eq("id", userId).maybeSingle();
  if (profileReadError) {
    ({ data: updated, error: profileReadError } = await db.from("users")
      .select(PROFILE_SELECT_BASE).eq("id", userId).maybeSingle());
  }
  return { updated, profileReadError };
}

export const getActiveUserAgent = (userId) =>
  db.from("user_agents").select("*").eq("user_id", userId).eq("is_active", true).maybeSingle();

export const getNotificationPreferences = (userId) =>
  db.from("user_notification_preferences").select("*").eq("user_id", userId).maybeSingle();

export const getUserSettings = (userId) =>
  db.from("user_settings").select("settings").eq("user_id", userId).maybeSingle();

export const upsertUserSettings = (userId, settings, updatedAt) =>
  db.from("user_settings").upsert({
    user_id: userId,
    settings,
    updated_at: updatedAt,
  }, { onConflict: "user_id" });

export const getUserLocation = (userId) =>
  db.from("users")
    .select("city, country").eq("id", userId).maybeSingle();

export const updateUserLocation = (userId, patch) =>
  db.from("users")
    .update(patch).eq("id", userId).select("city, country").maybeSingle();

export const usernameTaken = (username, userId) =>
  db.from("users")
    .select("id").eq("username", username).neq("id", userId).maybeSingle();

export async function updateUserProfile(userId, patch) {
  // Keep the write independent from the read projection. PROFILE_SELECT has
  // additive fields (for example city); a pending read-schema migration must
  // not turn an otherwise valid update to an unrelated profile field into a
  // failed save.
  const { error: updateError } = await db.from("users")
    .update(patch).eq("id", userId);
  return { error: updateError };
}

export const upsertNotificationPreferences = (row) =>
  db.from("user_notification_preferences")
    .upsert(row, { onConflict: "user_id" });

export const updateStudentFields = (userId, updates) =>
  db.from("users").update(updates).eq("id", userId).select("id, full_name, email, phone, avatar_url").single();

export const getStudentForMessage = (userId) =>
  db.from("users").select("id, full_name, email").eq("id", userId).single();

export const getStudentContactMaybe = (userId) =>
  db.from("users").select("id, full_name, email").eq("id", userId).maybeSingle();

export const getUserContactMaybe = (userId) =>
  db.from("users").select("full_name, email").eq("id", userId).maybeSingle();

export const getUserFullNameEmailMaybe = (userId) =>
  db.from("users").select("full_name, email").eq("id", userId).maybeSingle();

export const deactivateUserAgents = (userId) =>
  db.from("user_agents").update({ is_active: false }).eq("user_id", userId);

export const deleteUserAgents = (userId) =>
  db.from("user_agents").delete().eq("user_id", userId);

export const deleteUserNotificationPreferences = (userId) =>
  db.from("user_notification_preferences").delete().eq("user_id", userId);

export function listInstructorDirectory(q) {
  let query = db.from("users")
    .select("id, full_name, username, avatar_url, guide_emoji, subjects")
    .eq("role", "instructor").eq("is_active", true)
    .order("full_name", { ascending: true }).limit(500);
  // .or() takes a comma-separated filter string, so strip characters that
  // would let a search term inject extra filters or wildcards of its own.
  if (q) query = query.or(`full_name.ilike.%${q}%,username.ilike.%${q}%`);
  return query;
}

export const findInstructorForRequest = (teacherId) =>
  db.from("users").select("id").eq("id", teacherId).eq("role", "instructor").maybeSingle();

export const listInstructorUsers = () =>
  db.from("users")
    .select("id, full_name, username, email, created_at")
    .eq("role", "instructor")
    .order("created_at", { ascending: false });

export const insertNotifications = (rows) =>
  db.from("notifications").insert(rows);

export const insertNotification = (row) =>
  db.from("notifications").insert(row);
