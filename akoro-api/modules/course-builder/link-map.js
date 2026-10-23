/**
 * modules/course-builder/link-map.js — the pure half of link.js (no database):
 * how a Course Creator course and a platform course row map onto each other.
 */
const LEVEL_TO_DB = { Beginner: "beginner", Intermediate: "intermediate", Advanced: "advanced", "All levels": "all" };
const LEVEL_FROM_DB = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", all: "All levels" };
const PLATFORM_TO_DB = { "Google Meet": "meet", Zoom: "zoom", zoom: "zoom", meet: "meet", teams: "teams" };
const PLATFORM_FROM_DB = { meet: "Google Meet", zoom: "Zoom", teams: "Other" };

export const slugify = (s) =>
  (s || "course").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
  + "-" + Math.random().toString(36).slice(2, 8);

/** PURE: Course Creator's price text → { price (kobo), is_free }. Unset stays 0 and not free. */
export function priceToDb(price) {
  const p = String(price ?? "").trim();
  if (p === "free") return { price: 0, is_free: true };
  const naira = Number(p);
  if (!p || !Number.isFinite(naira) || naira <= 0) return { price: 0, is_free: false };
  return { price: Math.round(naira * 100), is_free: false };
}

/** PURE: courses.price (kobo) + is_free → Course Creator's price text. */
export function priceFromDb({ price, is_free }) {
  if (is_free) return "free";
  const kobo = Number(price) || 0;
  if (kobo <= 0) return "";
  const naira = kobo / 100;
  return Number.isInteger(naira) ? String(naira) : naira.toFixed(2);
}

/** PURE: the courses columns a Course Creator course decides. */
export function courseFieldsFrom(b) {
  return {
    title: b.title,
    description: b.description || b.subtitle || null,
    cover_image_url: b.cover_url && !String(b.cover_url).startsWith("blob:") ? b.cover_url : null,
    course_type: b.type === "live" ? "live" : "video",
    subject: b.category && b.category !== "Other" ? b.category : null,
    level: LEVEL_TO_DB[b.level] || "all",
    language: b.language || "English",
    platform: b.type === "live" ? PLATFORM_TO_DB[b.platform] || null : null,
    ...priceToDb(b.price),
  };
}

/** PURE: a builder_courses row for an old course. */
export function builderFieldsFrom(c) {
  return {
    owner_id: c.instructor_id,
    course_id: c.id,
    title: c.title,
    subtitle: "",
    category: c.subject || "Other",
    level: LEVEL_FROM_DB[c.level] || "All levels",
    language: c.language || "English",
    type: c.course_type === "live" ? "live" : "video",
    platform: c.course_type === "live" ? PLATFORM_FROM_DB[c.platform] || null : null,
    status: c.is_published ? "published" : "draft",
    price: priceFromDb(c),
    description: c.description || "",
    cover_url: c.cover_image_url || null,
    color: Math.abs([...String(c.id)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 0)) % 6,
  };
}

/** PURE: a UTC instant as Lagos wall clock { date 'YYYY-MM-DD', time 'HH:MM' } (the builder's vocabulary). */
export function lagosWallClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** PURE: an old video lesson → a builder lesson. */
export function lessonFromOld(l, position) {
  const mins = l.duration_seconds ? Math.round(l.duration_seconds / 60) : 0;
  return {
    title: l.title, type: "video", meta: mins ? `${mins} min` : "",
    src: l.video_url || "", description: l.description || "", free: !!l.is_preview,
    img_url: l.thumbnail_url || null, position,
  };
}

/** PURE: an old live session → a builder live lesson (the session itself stays in live_sessions). */
export function lessonFromSession(s, position) {
  const start = lagosWallClock(s.scheduled_start);
  const end = s.scheduled_end ? lagosWallClock(s.scheduled_end) : null;
  return {
    title: s.title, type: "live", meta: "", src: s.join_url || s.meeting_url || "",
    description: s.description || "", free: false, img_url: null,
    when_at: start ? `${start.date}T${start.time}` : "", end_time: end?.time || "",
    platform: PLATFORM_FROM_DB[s.platform] || null, position,
  };
}

