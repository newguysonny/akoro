/**
 * modules/records/access.js — who may read a record's AI content.
 *
 * One rule, used by every surface that reads a document's extraction,
 * transcript or search chunks: the records routes (extract, transcribe,
 * Ask) and the teaching session (whole-document grounding over the socket).
 *
 *   recordId   — the learner's OWN record (owner-only)
 *   contentKey — a shared file (the discovery feed's rule): any upload,
 *                except a Premium subscriber's, which stays private to them
 *
 * The db client loads lazily so importers stay cheap and testable.
 */
import { PHARMD_PREFIX, parsePharmdKey, pharmdContentKey } from "../pharmd/contentKey.js";

const dbLazy = async () => (await import("../../db.js")).default;
const edu = async () => (await dbLazy()).schema("edu");

/** PHARM.D catalogue content is keyed by the topic's stored path + bytes hash,
 *  so one parse is shared by every learner and a replaced PDF is a NEW key. */
async function resolvePharmdContent(contentKey) {
  const parsed = parsePharmdKey(contentKey);
  if (!parsed?.path) return { status: 400, message: "A PHARM.D content key is required." };
  const { data: topic, error } = await (await edu()).from("pharmd_topics")
    .select("title, file_path, file_mime, file_hash").eq("file_path", parsed.path).maybeSingle();
  if (error) throw error;
  if (!topic) return { status: 404, message: "Content not found." };
  // A client holding an old version must reopen the topic and use the new key.
  if (parsed.hash && topic.file_hash && parsed.hash !== topic.file_hash) {
    return { status: 409, message: "This file was updated — reopen the topic to read the new version." };
  }
  return {
    contentKey: pharmdContentKey(topic),
    name: topic.title || "PHARM.D topic",
    mime: topic.file_mime || "application/pdf",
  };
}

/** Active Premium learners — their uploads never leave their library. */
export async function activePremiumUserIds() {
  const { data: tierRows } = await (await edu()).from("tiers")
    .select("id").eq("platform", "learner").eq("access", "paid").eq("name", "Premium").limit(1);
  const tierId = tierRows?.[0]?.id ?? null;
  if (!tierId) return [];
  const { data: subs } = await (await edu()).from("subscriptions")
    .select("user_id").eq("tier_id", tierId).in("status", ["active", "trial", "trialing"]);
  return [...new Set((subs || []).map((s) => s.user_id).filter(Boolean))];
}

/** recordId | contentKey → { contentKey, name, mime } | { status, message }. */
export async function resolveContentAccess({ userId, recordId: rawRecordId, contentKey: rawContentKey }) {
  const recordId   = String(rawRecordId || "");
  const contentKey = String(rawContentKey || "");
  if (recordId) {
    if (!/^[0-9a-f-]{36}$/i.test(recordId)) return { status: 400, message: "A valid recordId is required." };
    const { data: rec, error } = await (await edu()).from("records")
      .select("id, user_id, name, mime, file_key").eq("id", recordId).is("deleted_at", null).maybeSingle();
    if (error) throw error;
    if (!rec || rec.user_id !== userId) return { status: 404, message: "Record not found." };
    if (!rec.file_key) return { status: 400, message: "This record has no saved file — only its details were captured." };
    return { contentKey: rec.file_key, name: rec.name, mime: rec.mime };
  }
  if (contentKey) {
    if (contentKey.startsWith(PHARMD_PREFIX)) return resolvePharmdContent(contentKey);
    // Shared content — the SAME rule the discovery feed opens under. The
    // earliest record holding the key owns it (a key can appear twice).
    const { data: rec, error } = await (await edu()).from("records")
      .select("id, user_id, name, mime, file_key, kind, private").eq("file_key", contentKey).is("deleted_at", null)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (error) throw error;
    if (!rec || rec.kind !== "upload") return { status: 404, message: "Content not found." };
    // A private record (a chat upload, D53) is its owner's alone.
    if (rec.private && rec.user_id !== userId) return { status: 404, message: "Content not found." };
    const premiumIds = await activePremiumUserIds();
    if (rec.user_id !== userId && premiumIds.includes(rec.user_id)) return { status: 404, message: "Content not found." };
    return { contentKey, name: rec.name, mime: rec.mime };
  }
  return { status: 400, message: "A recordId or contentKey is required." };
}

/**
 * The record whose search chunks answer for a document the learner may
 * read: { recordId, ownerId, contentKey, name, kind } | { status, message }.
 * Own records may be any kind (a paste has no file); shared files resolve
 * to the OWNER's record, where the chunks live.
 */
export async function resolveAskTargetFor({ userId, recordId: rawRecordId, contentKey: rawContentKey }) {
  const { askTargetForRecord } = await import("./askLib.js");
  const recordId   = String(rawRecordId || "");
  const contentKey = String(rawContentKey || "");
  if (recordId) {
    if (!/^[0-9a-f-]{36}$/i.test(recordId)) return { status: 400, message: "A valid recordId is required." };
    const { data: rec, error } = await (await edu()).from("records")
      .select("id, user_id, name, kind, file_key").eq("id", recordId).is("deleted_at", null).maybeSingle();
    if (error) throw error;
    if (!rec || rec.user_id !== userId) return { status: 404, message: "Record not found." };
    return askTargetForRecord(rec);
  }
  if (contentKey) {
    const id = await resolveContentAccess({ userId, contentKey });
    if (id.status) return id;
    const { data: rec, error } = await (await edu()).from("records")
      .select("id, user_id, name, kind, file_key").eq("file_key", contentKey).is("deleted_at", null)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (error) throw error;
    if (!rec) return { status: 404, message: "Content not found." };
    return askTargetForRecord(rec);
  }
  return { status: 400, message: "A recordId or contentKey is required." };
}
