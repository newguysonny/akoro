/**
 * modules/self-study/draft-records.js — one draft's CRUD for the preview:
 * read, list, human edit before assign, and discard. Ownership is enforced
 * here before any write.
 */

import db from "../../db.js";
import { invalid } from "./createAssignment.js";
import { expireStaleVersions, updateDraftPayload } from "./draftVersions.js";
import { expireStaleDrafts } from "./draft-store.js";

/** Load one draft the caller owns (admin excepted). */
export async function getActivityDraft(instructor, id) {
  const { data } = await db.from("activity_drafts").select("*").eq("id", id).maybeSingle();
  if (!data) throw invalid("Draft not found", 404);
  if (data.created_by !== instructor.id && instructor.role !== "admin") throw invalid("Not your draft", 403);
  // A version cut off mid-draft (the server restarted) would wait forever:
  // mark it failed so the preview offers Try again.
  if (data.status === "draft" && expireStaleVersions(data.payload)) {
    const payload = await updateDraftPayload(data.id, (p) => expireStaleVersions(p)).catch(() => null);
    return { ...data, payload: payload || expireStaleVersions(data.payload) };
  }
  return data;
}

/** The instructor's pending drafts, newest first (stale ones swept first). */
export async function listActivityDrafts(instructor) {
  await expireStaleDrafts(instructor.id);
  const { data } = await db.from("activity_drafts")
    .select("*").eq("created_by", instructor.id).eq("status", "draft")
    .order("created_at", { ascending: false }).limit(50);
  return data ?? [];
}

/** Human edits before assign — the preview's Edit flow saves here. */
export async function updateActivityDraft(instructor, id, patch) {
  const draft = await getActivityDraft(instructor, id);
  if (draft.status !== "draft") throw invalid("Only pending drafts can be edited", 409);
  const updates = {};
  if (patch?.payload && typeof patch.payload === "object") updates.payload = patch.payload;
  if (patch?.audience && typeof patch.audience === "object") updates.audience = patch.audience;
  if (patch?.status === "assigned") {
    // Battle completion path: the shared BattleForm created the battle; the
    // draft just records provenance.
    updates.status = "assigned";
    updates.assignment_id = patch.assignment_id ?? null;
    // A recurring battle: the series it became (its battles come later).
    if (patch.series_id) updates.series_id = patch.series_id;
    updates.resolved_at = new Date().toISOString();
  }
  if (!Object.keys(updates).length) return draft;
  const { data, error } = await db.from("activity_drafts")
    .update(updates).eq("id", id).select().single();
  if (error) throw invalid(error.message, 500);
  return data;
}

/** Discard — always allowed while pending; never deletes the row. */
export async function discardActivityDraft(instructor, id) {
  const draft = await getActivityDraft(instructor, id);
  if (draft.status !== "draft") throw invalid("Only pending drafts can be discarded", 409);
  const { data, error } = await db.from("activity_drafts")
    .update({ status: "discarded", resolved_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw invalid(error.message, 500);
  return data;
}
