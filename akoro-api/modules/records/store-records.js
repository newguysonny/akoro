/**
 * modules/records/store-records.js — Supabase queries for learner records,
 * the Discover feed and the course-lesson lookups the transcription lane
 * needs. No Express objects cross this boundary.
 */
import db from "../../db.js";
import { applyCursor } from "./rules.js";

const edu = () => db.schema("edu");

/* ── Records ─────────────────────────────────────────────────────────────── */

export const insertRecord = (row) =>
  edu().from("records").insert(row).select().single();

export const countRecords = (userId) =>
  edu().from("records").select("id", { count: "exact", head: true }).eq("user_id", userId).is("deleted_at", null);

export const listRecords = ({ userId, limit, cursor }) =>
  applyCursor(
    edu().from("records")
      .select("*").eq("user_id", userId).is("deleted_at", null)   // Recently deleted (§7.17) stays out of the shelf
      .order("created_at", { ascending: false }).order("id", { ascending: false }),
    cursor,
  ).limit(limit);

export const countShelf = (userId) =>
  edu().from("records")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId).is("deleted_at", null);

export const getRecordOwner = (id) =>
  edu().from("records")
    .select("id, user_id").eq("id", id).is("deleted_at", null).maybeSingle();

export const getRecordWithFile = (id) =>
  edu().from("records")
    .select("id, user_id, kind, name, mime, file_key").eq("id", id).maybeSingle();

export const getRecordFileForOwner = (id, userId) =>
  edu().from("records")
    .select("file_key").eq("id", id).eq("user_id", userId).is("deleted_at", null).maybeSingle();

export const getRecordDownload = (id) =>
  edu().from("records")
    .select("id, user_id, file_key, name").eq("id", id).is("deleted_at", null).maybeSingle();

export const updateRecord = (id, patch) =>
  edu().from("records").update(patch).eq("id", id).select().single();

export const deleteRecord = (id) =>
  edu().from("records").delete().eq("id", id);

/* ── Discover feed ───────────────────────────────────────────────────────── */

export const listDiscover = ({ limit, premiumIds, term, paged, cursor }) => {
  let query = edu().from("records")
    .select("id, user_id, kind, name, mime, size, duration, file_key, content, preview_key, created_at")
    .in("kind", ["upload", "paste"]).is("deleted_at", null)
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(limit);
  if (premiumIds.length) query = query.not("user_id", "in", `(${premiumIds.join(",")})`);
  query = query.eq("private", false);   // private records stay their owner's; Premium owners excluded above — one rule for Library and chat uploads alike
  if (term) query = query.or(`name.ilike.%${term}%,content.ilike.%${term}%`);
  if (paged) {
    // The openable rule moves into SQL so a page is a full page.
    query = query.or("kind.eq.paste,file_key.not.is.null");
    query = applyCursor(query, cursor);
  }
  return query;
};

export const countDiscover = ({ premiumIds, term }) => {
  let countQuery = edu().from("records")
    .select("*", { count: "exact", head: true })
    .in("kind", ["upload", "paste"]).is("deleted_at", null)
    .eq("private", false)
    .or("kind.eq.paste,file_key.not.is.null");
  if (premiumIds.length) countQuery = countQuery.not("user_id", "in", `(${premiumIds.join(",")})`);
  if (term) countQuery = countQuery.or(`name.ilike.%${term}%,content.ilike.%${term}%`);
  return countQuery;
};

export const getDiscoverRecord = (id) =>
  edu().from("records")
    .select("id, user_id, kind, name, file_key, content, private, deleted_at")
    .eq("id", id).maybeSingle();

export const listUserNames = (ids) =>
  edu().from("users").select("id, full_name").in("id", ids);

/* ── Course lessons (transcription target; mirrors GET /api/lessons/:id) ─── */

export const getLessonWithCourse = (lessonId) =>
  db.from("lessons")
    .select("id, title, video_url, is_preview, course_modules ( course_id )")
    .eq("id", lessonId).maybeSingle();

export const getActiveEnrollment = (userId, courseId) =>
  db.from("enrollments")
    .select("id").eq("user_id", userId).eq("course_id", courseId).eq("status", "active").maybeSingle();

export const setPreviewKey = (id, key) =>
  edu().from("records").update({ preview_key: key }).eq("id", id);

export const getRecordPreviewRow = (id) =>
  edu().from("records")
    .select("id, user_id, private, preview_key, deleted_at").eq("id", id).maybeSingle();

export async function listRecordsMissingPreview(limit = 100) {
  const db = edu();
  const base = () => db.from("records")
    .select("id, user_id, kind, name, mime, file_key, content")
    .is("preview_key", null).is("deleted_at", null);

  // Uploads the renderer can handle (PDF/image/text), plus every paste — a
  // pasted note's page is drawn from its text, so it needs no file.
  const { data: uploads, error: uploadErr } = await base()
    .eq("kind", "upload").not("file_key", "is", null)
    .or("mime.ilike.%pdf%,mime.ilike.image/%,mime.ilike.text/%,name.ilike.%.pdf,name.ilike.%.txt,name.ilike.%.md,name.ilike.%.markdown,name.ilike.%.png,name.ilike.%.jpg,name.ilike.%.jpeg,name.ilike.%.webp,name.ilike.%.gif,name.ilike.%.bmp")
    .order("created_at", { ascending: true }).limit(limit);
  if (uploadErr) throw new Error(uploadErr.message);

  const { data: pastes, error: pasteErr } = await base()
    .eq("kind", "paste").not("content", "is", null)
    .order("created_at", { ascending: true }).limit(limit);
  if (pasteErr) throw new Error(pasteErr.message);

  const rows = [...(uploads || []), ...(pastes || [])]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return rows.slice(0, limit);
}

export const countRecordsMissingPreview = async () => {
  const db = edu();
  const base = () => db.from("records").select("id", { count: "exact", head: true })
    .is("preview_key", null).is("deleted_at", null);
  const upload = await base().eq("kind", "upload").not("file_key", "is", null)
    .or("mime.ilike.%pdf%,mime.ilike.image/%,mime.ilike.text/%,name.ilike.%.pdf,name.ilike.%.txt,name.ilike.%.md,name.ilike.%.markdown,name.ilike.%.png,name.ilike.%.jpg,name.ilike.%.jpeg,name.ilike.%.webp,name.ilike.%.gif,name.ilike.%.bmp");
  const paste = await base().eq("kind", "paste").not("content", "is", null);
  return (upload.count || 0) + (paste.count || 0);
};

export const getRecordByFileKey = (key) =>
  edu().from("records").select("id, user_id, kind, name, mime, file_key")
    .eq("file_key", key).is("deleted_at", null).maybeSingle();
