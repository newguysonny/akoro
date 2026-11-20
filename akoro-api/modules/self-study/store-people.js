/**
 * modules/self-study/store-people.js — Supabase queries for the people and
 * progress rows the self-study views join: learners, their agents, adaptive
 * sessions, and the battles behind a journey/review.
 */
import db from "../../db.js";

const edu = () => db.schema("edu");

export const usersByIds = (ids, cols = "id, full_name") =>
  db.from("users").select(cols).in("id", ids);

export const agentsForStudents = (ids) =>
  edu().from("student_agents").select("id, student_id, knowledge_score, level").in("student_id", ids);

export const sessionById = (id) =>
  edu().from("adaptive_sessions").select("id, student_id").eq("id", id).maybeSingle();

export const battleSeatsFor = (userId, battleIds) =>
  db.from("battle_participants").select("battle_id, joined_at").eq("user_id", userId).in("battle_id", battleIds);

export const battlesByIds = (ids) =>
  db.from("battles").select("id, status").in("id", ids);
