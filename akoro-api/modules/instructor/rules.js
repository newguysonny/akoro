/**
 * instructor/rules.js — pure predicates, normalisers and constants.
 *
 * No database import, no Express import. Everything here is a synchronous
 * transformation of its arguments so services and routes can share it freely.
 */

// user_agents stores total_xp only; derive a display level (500 XP per level).
export const levelFromXp = (xp = 0) => Math.floor((xp ?? 0) / 500) + 1;

export const slugify = (s) =>
  (s || "course").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
  + "-" + Math.random().toString(36).slice(2, 8);

// course_type: DB allows 'live' | 'video'. Frontend speaks 'live' | 'on-demand'.
export const typeToDb  = (t) => (t === "on-demand" || t === "ondemand" || t === "video" ? "video" : "live");
export const typeToApi = (t) => (t === "video" ? "on-demand" : "live");
export const VALID_LEVELS = ["beginner", "intermediate", "advanced", "all"];

// Shape a courses row into what the instructor frontend expects.
export const mapCourse = (row, enrolledCount = 0) => ({
  ...row,
  type:             typeToApi(row.course_type),
  status:           row.is_published ? "active" : "draft",
  studentsEnrolled: enrolledCount,
  thumbnail:        row.cover_image_url ?? null,
});

export const mapSession = (row) => ({
  ...row,
  startTime:     row.scheduled_start,
  enrolledCount: row.current_participants ?? 0,
  courseId:      row.course_id,
  moduleId:      row.module_id ?? null,
  meetingUrl:    row.meeting_url ?? null,
});

export const mapModule = (row, sessions = []) => ({
  id:          row.id,
  courseId:    row.course_id,
  title:       row.title,
  description: row.description ?? null,
  orderIndex:  row.order_index ?? 0,
  sessions:    sessions.map(mapSession),
});

export const mapBattle = (row) => ({
  ...row,
  topic:            row.topic,
  difficulty:       row.difficulty,
  participantCount: row.total_participants ?? 0,
  maxParticipants:  row.max_participants ?? 0,
  duration:         Math.round((row.time_limit_seconds ?? 0) / 60),
  scheduledAt:      row.scheduled_start,
});

export const PROFILE_FIELDS = [
  "full_name", "username", "phone", "bio", "avatar_url",
  "country", "school_name", "school_type", "subjects",
  "language", "display_mode", "accent_color", "two_factor_enabled",
];

export const VALID_BATTLE_TYPES  = ["1v1", "open", "classroom"];
export const VALID_BATTLE_STATUS = ["lobby", "scheduled", "live", "completed", "expired", "cancelled"];

export const STREAMING_PLATFORMS = ["zoom", "meet", "teams", "youtube"];
export const SOCIAL_PLATFORMS    = ["facebook", "instagram", "twitter", "tiktok"];

export const DOC_FIELDS = ["name", "description", "category", "page_size", "orientation", "body", "css", "variables"];
