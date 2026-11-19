/**
 * modules/school/store-content.js — Supabase queries for edu.content_creations.
 * No Express import.
 */

import db from "../../db.js";
import { CREATION_COLS } from "./rules.js";

const edu = () => db.schema("edu");

export const creationsInsert = (row) => edu()
  .from("content_creations").insert(row).select(CREATION_COLS).maybeSingle();

export const creationsBySchool = (schoolId, kind) => {
  let q = edu().from("content_creations")
    .select(CREATION_COLS)
    .eq("school_id", schoolId).order("created_at", { ascending: false }).limit(30);
  if (kind) q = q.eq("kind", kind);
  return q;
};

export const creationById = (schoolId, creationId) => edu()
  .from("content_creations").select(CREATION_COLS).eq("id", creationId).eq("school_id", schoolId).maybeSingle();

export const creationIdById = (schoolId, creationId) => edu()
  .from("content_creations").select("id").eq("id", creationId).eq("school_id", schoolId).maybeSingle();

export const creationUpdate = (creationId, patch) => edu()
  .from("content_creations").update(patch).eq("id", creationId).select(CREATION_COLS).maybeSingle();

export const creationUpdateBySchool = (schoolId, creationId, patch) => edu()
  .from("content_creations").update(patch).eq("id", creationId).eq("school_id", schoolId).select(CREATION_COLS).maybeSingle();

export const creationDelete = (schoolId, creationId) => edu()
  .from("content_creations").delete().eq("id", creationId).eq("school_id", schoolId);
