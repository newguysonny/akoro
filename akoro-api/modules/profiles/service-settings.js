/**
 * Profile/settings orchestration: the caller's own account, location,
 * notification preferences, avatar, deactivation and erasure.
 */
import { endSession, invalidateCachedUser } from "../auth/index.js";
import { activePremiumUserIds } from "../records/access.js";
import { now, res200, res400 } from "./http.js";
import { isIanaTimeZone, notificationPreferenceRow } from "./rules.js";
import * as users from "./store-users.js";

/** GET /api/profiles/me — full profile + agent + notification prefs */
export async function getMe(req, res) {
  const userId = req.user.id;

  const [{ data: user }, { data: agent }, { data: notif }, { data: accountSettings }, premiumIds] = await Promise.all([
    users.readProfileWithFallback(userId),
    users.getActiveUserAgent(userId),
    users.getNotificationPreferences(userId),
    users.getUserSettings(userId),
    // The caller's real plan, under the records rule's own definition of a
    // Premium learner (records/access.js) — a failed lookup reads as Free,
    // the same degradation the records search uses.
    activePremiumUserIds().catch(() => []),
  ]);

  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  res200(res, {
    id:              user.id,
    email:           user.email,
    username:        user.username,
    fullName:        user.full_name,
    avatarUrl:       user.avatar_url,
    avatarEmoji:     user.avatar_emoji,
    phone:           user.phone,
    role:            user.role,
    // The caller's real plan ("Premium" | "Free") from their subscription —
    // the server-side truth the app's device-local plan switch can't fake.
    plan:            premiumIds.includes(userId) ? "Premium" : "Free",
    country:         user.country,
    city:            user.city ?? null,
    schoolName:      user.school_name,
    schoolType:      user.school_type,
    yearGroup:       user.year_group,
    studyLevel:      user.study_level,
    // Higher education's programme/department. Kept out of subjects so
    // reporting and matching can tell a discipline from a school subject.
    discipline:      user.discipline ?? null,
    language:        user.language        || "English",
    // Stored in generic account settings so the users table needs no new
    // column. It is consumed by learner time-aware task/chat tools.
    timeZone:        isIanaTimeZone(accountSettings?.settings?.timezone) ? accountSettings.settings.timezone.trim() : null,
    displayMode:     user.display_mode    || "system",
    accentColor:     user.accent_color    || "#6C3BFF",
    teachingGuide:   user.teaching_guide,
    guideEmoji:      user.guide_emoji,
    subjects:        user.subjects        || [],
    twoFactorEnabled:user.two_factor_enabled || false,
    // OAuth accounts may have no password on file — the settings page shows
    // "Set password" (new + confirm only) instead of "Change password".
    // Only the presence leaves the API, never the hash.
    hasPassword:     !!user.password_hash,
    onboardingCompleted: user.onboarding_completed ?? false,
    memberSince:     new Date(user.created_at).toLocaleDateString("en-GB",{ month:"long", year:"numeric" }),
    agent: agent ? {
      id:           agent.id,
      name:         agent.agent_name,
      emoji:        agent.agent_emoji,
      photoUrl:     agent.photo_url,
      color:        agent.agent_color,
      bg:           agent.agent_bg,
      personality:  agent.personality,
      studyLevel:   agent.study_level,
      discipline:   agent.discipline ?? null,
      yearGroup:    agent.year_group,
      examBoard:    agent.exam_board,
      subjects:     agent.subjects       || [],
      goal:         agent.goal,
      level:        agent.level          || 1,
      totalSessions:agent.total_sessions || 0,
      totalTurns:   agent.total_turns    || 0,
      knowledgeScore:agent.knowledge_score || 0,
      xpEarned:     agent.total_xp       || 0,
    } : null,
    notif: notif ? {
      email:           notif.email_enabled,
      sms:             notif.sms_enabled,
      push:            notif.push_enabled,
      whatsapp:        notif.whatsapp_enabled,
      whatsappNumber:  notif.whatsapp_number || "",
      sessionReminders:notif.notify_session_reminders,
      sessionStarted:  notif.notify_session_started,
      sessionCancelled:notif.notify_session_cancelled,
      announcements:   notif.notify_new_announcements,
      qaReplies:       notif.notify_qa_replies,
      // Optional email channel for the study agent's scheduled reminders.
      reminderEmails:  notif.notify_agent_reminders !== false,
    } : null,
  });
}

/**
 * GET /api/profiles/me/location — the caller's self-reported location only.
 * This intentionally does not return contact details or infer a timezone.
 */
export async function getLocation(req, res) {
  const { data: location, error } = await users.getUserLocation(req.user.id);
  if (error) return res.status(500).json({ success: false, message: "Failed to load location" });
  if (!location) return res.status(404).json({ success: false, message: "User not found" });
  res200(res, { city: location.city ?? null, country: location.country ?? null });
}

/**
 * PATCH /api/profiles/me/location — update city and/or country for this user.
 * An IANA timezone remains a separate explicit setting because a place name is
 * not a reliable timezone authority.
 */
export async function patchLocation(req, res) {
  const { city, country } = req.body;
  if (city === undefined && country === undefined) return res400(res, "city or country is required");

  const patch = { updated_at: now() };
  if (city !== undefined) patch.city = city.trim() || null;
  if (country !== undefined) patch.country = country.trim() || null;
  const { data: updated, error } = await users.updateUserLocation(req.user.id, patch);
  if (error) return res.status(500).json({ success: false, message: "Failed to save location" });
  if (!updated) return res.status(404).json({ success: false, message: "User not found" });
  res200(res, { city: updated.city ?? null, country: updated.country ?? null });
}

/** PATCH /api/profiles/me — update user profile fields */
export async function patchMe(req, res) {
  const userId = req.user.id;
  const {
    fullName, username, phone, avatarEmoji, country, city, schoolName, schoolType,
    yearGroup, studyLevel, discipline, language, timeZone, displayMode, accentColor,
    teachingGuide, guideEmoji, subjects, twoFactorEnabled, onboardingCompleted,
  } = req.body;

  // Check username uniqueness
  if (username) {
    const { data: taken } = await users.usernameTaken(username, userId);
    if (taken) return res.status(409).json({ success: false, message: "Username already taken" });
  }

  const patch = {};
  if (fullName       !== undefined) patch.full_name        = fullName;
  if (username       !== undefined) patch.username         = username;
  if (phone          !== undefined) patch.phone            = phone;
  if (avatarEmoji    !== undefined) patch.avatar_emoji     = avatarEmoji;
  if (country        !== undefined) patch.country          = country;
  if (city           !== undefined) patch.city             = city || null;
  if (schoolName     !== undefined) patch.school_name      = schoolName;
  if (schoolType     !== undefined) patch.school_type      = schoolType;
  if (yearGroup      !== undefined) patch.year_group       = yearGroup;
  if (studyLevel     !== undefined) patch.study_level      = studyLevel;
  if (discipline     !== undefined) patch.discipline       = discipline ? String(discipline).trim().slice(0, 80) : null;
  if (language       !== undefined) patch.language         = language;
  if (displayMode    !== undefined) patch.display_mode     = displayMode;
  if (accentColor    !== undefined) patch.accent_color     = accentColor;
  if (teachingGuide  !== undefined) patch.teaching_guide   = teachingGuide;
  if (guideEmoji     !== undefined) patch.guide_emoji      = guideEmoji;
  if (subjects       !== undefined) patch.subjects         = subjects;
  if (timeZone !== undefined && !isIanaTimeZone(timeZone)) {
    return res.status(422).json({ success: false, message: "timeZone must be a valid IANA timezone" });
  }
  // two_factor_enabled is intentionally NOT settable here — it can only be
  // toggled via the code-verified /2fa/enable and /2fa/disable routes, so a
  // session holder can't silently disable 2FA without a TOTP code.
  if (onboardingCompleted !== undefined) patch.onboarding_completed = onboardingCompleted;
  patch.updated_at = new Date().toISOString();

  const { error: updateError } = await users.updateUserProfile(userId, patch);

  if (updateError) {
    console.error("[profiles/me PATCH]", updateError.message);
    return res.status(500).json({ success: false, message: "Failed to update profile" });
  }
  // The auth cache holds full_name and onboarding_completed for 45 s: finishing onboarding and then
  // reloading (or opening a second tab) read the stale "not onboarded" and sent the learner back to it.
  invalidateCachedUser(userId);

  // Match GET /me's compatibility behaviour while additive columns are
  // rolling out. The base projection includes the values returned below,
  // including school_type, so clients can still confirm a persisted setting.
  const { updated, profileReadError } = await users.readProfileForConfirmation(userId);
  if (profileReadError) {
    console.error("[profiles/me PATCH confirmation]", profileReadError.message);
    return res.status(500).json({ success: false, message: "Profile was updated but could not be confirmed. Please refresh and try again." });
  }
  if (!updated) return res.status(404).json({ success: false, message: "User not found" });

  if (timeZone !== undefined) {
    const canonicalTimeZone = timeZone.trim();
    // Merge rather than replace generic settings: this account setting shares
    // the JSONB row with unrelated integrations/preferences.
    const { data: prior, error: settingsReadError } = await users.getUserSettings(userId);
    if (settingsReadError) return res.status(500).json({ success: false, message: "Failed to save account time zone" });
    const current = prior?.settings && typeof prior.settings === "object" ? prior.settings : {};
    const { error: settingsError } = await users.upsertUserSettings(userId, { ...current, timezone: canonicalTimeZone }, new Date().toISOString());
    if (settingsError) return res.status(500).json({ success: false, message: "Failed to save account time zone" });
  }

  res200(res, {
    fullName: updated.full_name,
    username: updated.username,
    city: updated.city ?? null,
    country: updated.country ?? null,
    schoolType: updated.school_type ?? null,
    // study_level is selected above but was never mapped into the response,
    // so a client confirming a persisted study level (the merged Settings
    // level control) read `undefined` and treated a SUCCESSFUL save as a
    // failed one. Additive, backward-compatible field.
    studyLevel: updated.study_level ?? null,
    discipline: updated.discipline ?? null,
    accentColor: updated.accent_color,
    timeZone: timeZone !== undefined ? timeZone.trim() : undefined,
    onboardingCompleted: updated.onboarding_completed ?? false,
  });
}

/** PATCH /api/profiles/me/notifications — update notification preferences */
export async function patchNotifications(req, res) {
  const userId = req.user.id;
  const row = notificationPreferenceRow(userId, req.body, new Date().toISOString());

  await users.upsertNotificationPreferences(row);

  res200(res, { saved: true });
}

export async function teachingGuides(_req, res) {
  const guides = [
    { id: "nana-esumai",      name: "NaNa Esumai",    emoji: "🧠", style: "Adaptive & encouraging" },
    { id: "akobi-strict",     name: "Akobi",          emoji: "🧑‍🏫", style: "Strict & structured" },
    { id: "sade-warm",        name: "Sade",            emoji: "🌸", style: "Warm & nurturing" },
    { id: "emeka-fasttrack",  name: "Emeka",           emoji: "⚡", style: "Fast-track & intensive" },
  ];
  res200(res, { guides });
}

// Suspends the account: login is blocked (is_active=false) but data is kept,
// so the user can reactivate within the grace period by signing back in.
export async function deactivate(req, res) {
  const userId = req.user.id;

  const { error } = await users.updateUserById(userId, {
    is_active:       false,
    deactivated_at:  new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  });
  if (error) {
    console.error("[profiles/me/deactivate]", error.message);
    return res.status(500).json({ success: false, message: "Failed to deactivate account" });
  }

  // Mark all user_agents inactive
  await users.deactivateUserAgents(userId);

  // Kill the current session so the user is signed out everywhere
  await endSession(req, res);

  res200(res, { deactivated: true });
}

export async function uploadAvatar(req, res) {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
  const userId = req.user.id;
  const mime   = req.file.mimetype;
  const b64    = req.file.buffer.toString("base64");
  const dataUrl = `data:${mime};base64,${b64}`;

  const { error } = await users.updateUserById(userId, { avatar_url: dataUrl, updated_at: new Date().toISOString() });
  if (error) return res.status(500).json({ success: false, message: "Failed to save avatar" });

  res200(res, { url: dataUrl });
}

// Right-to-erasure delete: blocks login, anonymizes all PII, scrubs credentials
// and 2FA, and removes the user's learning data. The row is retained (anonymized)
// to preserve referential integrity for aggregate records.
export async function deleteMe(req, res) {
  const userId = req.user.id;
  const anon = `deleted_${userId.slice(0, 8)}_${Date.now()}`;

  const { error } = await users.updateUserById(userId, {
    email:             `${anon}@deleted.akoro.app`,
    full_name:         "Deleted User",
    username:          anon,
    phone:             null,
    avatar_url:        null,
    password_hash:     "",            // scrub credentials
    two_factor_secret: null,
    two_factor_enabled:false,
    is_active:         false,         // block any further login
    deleted_at:        new Date().toISOString(),
    updated_at:        new Date().toISOString(),
  });
  if (error) {
    console.error("[profiles/me DELETE]", error.message);
    return res.status(500).json({ success: false, message: "Failed to delete account" });
  }

  // Remove the user's owned learning data (best-effort — ignore missing tables)
  await Promise.allSettled([
    users.deleteUserAgents(userId),
    users.deleteUserNotificationPreferences(userId),
  ]);

  // Kill the current session
  await endSession(req, res);

  res200(res, { deleted: true });
}
