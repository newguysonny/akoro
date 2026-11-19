/**
 * battle/store-battles.js — every query the battle routes make against the
 * `battles` table, and only that table. One function per query shape the
 * routes use, named for what the caller asks, so service.js reads as a story
 * and the SQL is visible in one place.
 */
import db from "../../db.js";

const battles = () => db.from("battles");

// ─── health ───────────────────────────────────────────────────────────────────

export const liveBattlesCoverage = () =>
  battles().select("id, title, total_questions, battle_type").eq("status", "live").limit(100);

export const liveBattlesStarted = () =>
  battles().select("id, title, actual_start").eq("status", "live").limit(20);

// ─── reads by id ──────────────────────────────────────────────────────────────

export const battleById = (id) => battles().select("*").eq("id", id).maybeSingle();

export const battleByIdSingle = (id) => battles().select("*").eq("id", id).single();

export const battleForCard = (id) => battles().select("*").eq("id", id).maybeSingle();

export const challengeForDetail = (id) =>
  battles().select(`*, users!battles_created_by_fkey(full_name), user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("id", id).single();

export const battleEntryInfo = (id) =>
  battles().select("id, battle_type, total_questions, min_xp").eq("id", id).maybeSingle();

export const openChallengeForAccept = (id) =>
  battles().select("*").eq("id", id).in("status", ["lobby", "scheduled"]).single();

export const battleForDecline = (id) =>
  battles().select("id, scheduled_start, title, created_by, battle_type").eq("id", id).maybeSingle();

export const battleStateFields = (id) =>
  battles().select("status, total_questions, battle_type, review_host").eq("id", id).single();

export const battleOwnedBy = (id, userId) =>
  battles().select("*").eq("id", id).eq("created_by", userId).single();

export const battleEndFields = (id) =>
  battles().select("created_by, status").eq("id", id).single();

export const battleQuestionsStatus = (id) =>
  battles().select("status, total_questions").eq("id", id).single();

export const battlePdfFields = (id) =>
  battles().select("id, title, subject, topic, status, actual_end").eq("id", id).maybeSingle();

export const battleEditFields = (id) =>
  battles().select("id, created_by, status").eq("id", id).single();

export const battleDeleteFields = (id) =>
  battles().select("id, created_by, status, title").eq("id", id).single();

export const battleParticipantsHeader = (id) =>
  battles().select("id, title, status, created_by, total_participants").eq("id", id).maybeSingle();

export const battleDetailHeader = (id) =>
  battles().select(`*, users!battles_created_by_fkey(full_name), user_agents(agent_name, agent_emoji)`)
    .eq("id", id).single();

// ─── lists ────────────────────────────────────────────────────────────────────

export const courseChallenges = (courseId, nowIso) =>
  battles().select(`*, users!battles_created_by_fkey(full_name, username), user_agents!inner(agent_name, agent_emoji, agent_color, agent_bg)`)
    .eq("course_id", courseId).eq("battle_type", "1v1").eq("status", "lobby")
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);

export const openBattlesOfCourse = (courseId, nowIso) =>
  battles().select(`*, users!battles_created_by_fkey(full_name, username), user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("course_id", courseId).eq("battle_type", "open")
    .in("status", ["lobby", "scheduled"])
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: false });

export const battlesOfCourse = (courseId, { status, type } = {}) => {
  let query = battles()
    .select(`*, users!battles_created_by_fkey(full_name, username), user_agents(agent_name, agent_emoji)`)
    .eq("course_id", courseId)
    .order("status").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (type) query = query.eq("battle_type", type);
  return query;
};

export const sessionBattlesOfCourse = (courseId, sessionId) =>
  battles().select("*, users!battles_created_by_fkey(full_name)")
    .eq("course_id", courseId)
    .eq("battle_type", "classroom")
    .contains("provider_response", { session_id: sessionId });

export const seatedBattlesOfUser = (userId, page) =>
  battles()
    .select("*, users!battles_created_by_fkey(full_name, avatar_url), battle_participants!inner(role, joined_at, declined_at, user_id)")
    .eq("battle_participants.user_id", userId)
    .order("created_at", { ascending: false }).limit(page);

export const createdBattlesOfUser = (userId, page) =>
  battles().select("*, users!battles_created_by_fkey(full_name, avatar_url)")
    .eq("created_by", userId)
    .order("created_at", { ascending: false }).limit(page);

export const pendingChallengesOfUser = (userId, nowIso) =>
  battles()
    .select("*, users!battles_created_by_fkey(full_name, avatar_url, role), battle_participants!inner(user_id, role, joined_at, declined_at)")
    .eq("battle_participants.user_id", userId)
    .in("battle_participants.role", ["opponent", "participant"])
    .is("battle_participants.joined_at", null)
    .is("battle_participants.declined_at", null)
    .in("status", ["lobby", "scheduled"])
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: false })
    .limit(100);

export const battlesOfTeacherCourses = (courseIds) =>
  battles().select("id, status, xp_pool, created_by").in("course_id", courseIds);

export const battlesBySeriesAndStart = (seriesId, startIso) =>
  battles().select("id").eq("series_id", seriesId).eq("scheduled_start", startIso).limit(1);

// ─── writes ───────────────────────────────────────────────────────────────────

export const insertBattle = (payload) => battles().insert(payload).select().single();

export const deleteBattle = (id) => battles().delete().eq("id", id);

export const updateBattle = (id, updates) => battles().update(updates).eq("id", id);

export const updateBattleSelected = (id, updates) => battles().update(updates).eq("id", id).select().single();

export const setBattleStatus = (id, status) => battles().update({ status }).eq("id", id);

export const setBattleStatusIn = (id, status, statuses) =>
  battles().update({ status }).in("status", statuses).eq("id", id);

export const cancelOwnBattle = (id, userId, statuses) =>
  battles().update({ status: "cancelled" })
    .eq("id", id).eq("created_by", userId).in("status", statuses).select("id");

export const cancelBattleSelected = (id) =>
  battles().update({ status: "cancelled" }).in("status", ["lobby", "scheduled"]).eq("id", id).select("id").maybeSingle();

export const cancelSeriesBattles = (seriesId) =>
  battles().update({ status: "cancelled" })
    .eq("series_id", seriesId).in("status", ["lobby", "scheduled"]).select("id");

export const setScheduled = (id) => setBattleStatus(id, "scheduled");

export const setTotalParticipants = (id, total) =>
  battles().update({ total_participants: total }).eq("id", id);
