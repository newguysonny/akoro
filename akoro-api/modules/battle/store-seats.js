/**
 * battle/store-seats.js — the `battle_participants` and `battle_viewers`
 * tables: who holds a seat, whether they answered it, how they did, and how
 * many people are watching.
 */
import db from "../../db.js";

const seats = () => db.from("battle_participants");

// ─── writes ───────────────────────────────────────────────────────────────────

export const insertSeat = (payload) => seats().insert(payload);

export const upsertSeat = (payload) =>
  seats().upsert(payload, { onConflict: "battle_id,user_id" });

export const updateSeat = (battleId, userId, updates) =>
  seats().update(updates).eq("battle_id", battleId).eq("user_id", userId);

export const updateSeatById = (id, updates) => seats().update(updates).eq("id", id);

export const acceptSeat = (battleId, userId) =>
  updateSeat(battleId, userId, { joined_at: new Date().toISOString(), declined_at: null });

export const joinSeat = (battleId, userId, joinedAt) =>
  updateSeat(battleId, userId, { joined_at: joinedAt });

export const declineSeat = (battleId, userId) =>
  updateSeat(battleId, userId, { declined_at: new Date().toISOString(), joined_at: null });

// ─── reads ────────────────────────────────────────────────────────────────────

export const seatRole = (battleId, userId) =>
  seats().select("id, role").eq("battle_id", battleId).eq("user_id", userId)
    .in("role", ["opponent", "participant"]).maybeSingle();

export const participantSeat = (battleId, userId) =>
  seats().select("id").eq("battle_id", battleId).eq("user_id", userId).maybeSingle();

export const seatForDecline = (battleId, userId) =>
  seats().select("battle_id, role, battles!inner(created_by, title, status)")
    .eq("battle_id", battleId).eq("user_id", userId)
    .in("role", ["opponent", "participant"]).maybeSingle();

export const allSeats = (battleId) => seats().select("*").eq("battle_id", battleId);

export const seatAnswers = (battleId) =>
  seats().select("joined_at, declined_at, role").eq("battle_id", battleId);

export const seatStarts = (battleId) =>
  seats().select("role, joined_at, declined_at").eq("battle_id", battleId);

export const seatUserId = (battleId, userId) =>
  seats().select("id").eq("battle_id", battleId).eq("user_id", userId).single();

export const roleOfSeat = (battleId, userId) =>
  seats().select("role").eq("battle_id", battleId).eq("user_id", userId).single();

export const participantOfUser = (battleId, userId) =>
  seats().select("id").eq("battle_id", battleId).eq("user_id", userId).maybeSingle();

export const seatRows = (battleId) =>
  seats().select("user_id, role, joined_at, declined_at, score, correct_answers, wrong_answers, is_winner, final_rank, xp_earned")
    .eq("battle_id", battleId);

export const detailSeats = (battleId) =>
  seats().select(`*, users(username, full_name), user_agents(agent_name, agent_emoji, agent_color, agent_bg)`)
    .eq("battle_id", battleId).order("score", { ascending: false });

export const stateSeats = (battleId) =>
  seats().select(`user_id, role, score, hp, current_streak, is_connected, user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("battle_id", battleId).order("score", { ascending: false });

export const resultsSeats = (battleId) =>
  seats().select(`*, users(username, full_name), user_agents(agent_name, agent_emoji, agent_color, agent_bg)`)
    .eq("battle_id", battleId).order("final_rank");

export const finishedResultRows = (battleIds) =>
  seats().select("battle_id, user_id, role, score, hp, correct_answers, is_winner, final_rank, xp_earned, user_agents(agent_name, agent_emoji, agent_color)")
    .in("battle_id", battleIds).order("final_rank");

export const lineupRows = (battleIds) =>
  seats().select("battle_id, user_id, role, joined_at, declined_at, score, user_agents(agent_name, agent_emoji, agent_color, agent_bg)")
    .in("battle_id", battleIds);

export const seatsOfUser = (userId) =>
  seats().select("is_winner, battle_id").eq("user_id", userId);

export const seatCount = (battleId) =>
  seats().select("id", { count: "exact", head: true }).eq("battle_id", battleId);

export const otherSeatUserIds = (battleId, exceptUserId) =>
  seats().select("user_id").eq("battle_id", battleId).neq("user_id", exceptUserId);

// ─── viewers ──────────────────────────────────────────────────────────────────

export const viewerCount = (battleId) =>
  db.from("battle_viewers").select("id", { count: "exact", head: true }).eq("battle_id", battleId);
