/**
 * instructor/store-credentials.js — the caller's user_settings row, where the
 * streaming and social credentials live. No Express, no policy.
 */
import db from "../../db.js";

export const settingsOf = (userId) =>
  db.from("user_settings").select("settings").eq("user_id", userId).maybeSingle();

export const upsertSettings = (row) =>
  db.from("user_settings").upsert(row, { onConflict: "user_id" }).select().single();

export const upsertSettingsNoRow = (row) =>
  db.from("user_settings").upsert(row, { onConflict: "user_id" });

export const updateSettings = (userId, patch) =>
  db.from("user_settings").update(patch).eq("user_id", userId);
