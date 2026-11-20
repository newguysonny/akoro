/**
 * modules/self-study/draft-history.js — go back to (or forward to) one round
 * of a non-assignment draft: its fields become that stored snapshot.
 */

import db from "../../db.js";
import { invalid } from "./createAssignment.js";
import { updateDraftPayload } from "./draftVersions.js";
import { getActivityDraft } from "./draft-records.js";

/** Go back to (or forward to) one round: the draft's fields become that snapshot. */
export async function restoreDraftHistory(instructor, id, n) {
  const draft = await getActivityDraft(instructor, id);
  if (draft.status !== "draft") throw invalid("Only pending drafts can be changed", 409);
  const entry = (draft.payload?.history || []).find((h) => h.n === Number(n));
  if (!entry) throw invalid("No such version", 404);
  await updateDraftPayload(draft.id, (p) => ({ ...p, ...structuredClone(entry.snapshot), history_current: entry.n }));
  const { data, error } = await db.from("activity_drafts").select().eq("id", draft.id).single();
  if (error) throw invalid(error.message, 500);
  return data;
}
