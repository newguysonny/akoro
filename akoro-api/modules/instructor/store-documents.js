/**
 * instructor/store-documents.js — queries for the instructor's printable
 * document templates and the records rendered from them.
 *
 * No Express, no policy.
 */
import db from "../../db.js";

const templates = () => db.from("instructor_document_templates");

export const templatesByUser = (userId, category = null) => {
  let q = templates().select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (category) q = q.eq("category", category);
  return q;
};

export const templateByName = (userId, name) =>
  templates().select("id").eq("user_id", userId).eq("name", name).maybeSingle();

export const insertTemplateId = (row) =>
  templates().insert(row).select("id").single();

export const insertTemplateRow = (row) =>
  templates().insert(row).select("*").single();

export const templateByIdForUser = (userId, id) =>
  templates().select("*").eq("id", id).eq("user_id", userId).maybeSingle();

export const updateTemplate = (userId, id, patch) =>
  templates().update(patch).eq("id", id).eq("user_id", userId).select("*").single();

export const deleteTemplate = (userId, id) =>
  templates().delete().eq("id", id).eq("user_id", userId);

export const insertDocumentRecord = (row) =>
  db.from("instructor_document_records").insert(row).select("*").single();
