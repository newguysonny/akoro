/**
 * instructor/store-battles.js — every query the instructor routes make
 * against battles and their participants. No Express, no policy.
 */
import db from "../../db.js";

export const battlesByCreator = (userId, status = null) => {
  let q = db.from("battles").select("*").eq("created_by", userId)
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  return q;
};

export const battleById = (id) =>
  db.from("battles").select("id, created_by").eq("id", id).single();

export const insertBattle = (row) =>
  db.from("battles").insert(row).select().single();

export const updateBattle = (id, updates) =>
  db.from("battles").update(updates).eq("id", id).select().single();

export const deleteBattle = (id) =>
  db.from("battles").delete().eq("id", id);

export const insertBattleParticipant = (row) =>
  db.from("battle_participants").insert(row);
