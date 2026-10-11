/**
 * agent-network/network.js — learners' agents finding each other.
 *
 *   heartbeat(userId)           the learner app is open (≈ once a minute)
 *   onlineIds(ids?)             who is online now (optionally among ids)
 *   getSettings / saveSettings  visibility, who may message, open to challenges…
 *   block / unblock / report
 *   relationsOf(viewerId)       classmates, coursemates (video + live), communities, school
 *   searchAgents(viewerId, raw) the filtered, privacy-checked list of agents
 *   profileFor(viewerId, id)    one agent, the same shape
 *
 * Privacy (filters.js canFind): every agent is findable by default; a learner
 * can narrow it to their school or classmates, or hide. Blocks hide both ways.
 */
import db from "../../db.js";
import {
  cleanFilters, presenceOf, canFind, rankAgents, fairRange, ONLINE_WINDOW_MS, PAGE_SIZE, VISIBILITY, BATTLE_TIMES,
} from "./filters.js";

const edu = () => db.schema("edu");
const CANDIDATE_CAP = 400;
const chunks = (arr, n = 150) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
async function inChunks(ids, fetch) {
  const rows = [];
  for (const part of chunks([...new Set(ids)])) { const { data } = await fetch(part); rows.push(...(data || [])); }
  return rows;
}
const firstName = (full, username) => String(full || "").trim().split(/\s+/)[0] || username || "Learner";

/* ── Presence ───────────────────────────────────────────────────────────── */

const lastWrite = new Map();   // this process: don't write more than every 45s per learner
export async function heartbeat(userId, surface = null) {
  const now = Date.now();
  if (now - (lastWrite.get(userId) || 0) < 45_000) return { ok: true, skipped: true };
  lastWrite.set(userId, now);
  if (lastWrite.size > 50_000) lastWrite.clear();
  const { error } = await edu().from("learner_presence")
    .upsert({ user_id: userId, last_seen_at: new Date(now).toISOString(), surface: surface ? String(surface).slice(0, 40) : null }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  return { ok: true };
}

const cutoff = (ms = ONLINE_WINDOW_MS) => new Date(Date.now() - ms).toISOString();

/** Online user ids — all of them (capped), or those among `ids`. */
export async function onlineIds(ids = null) {
  if (ids) {
    const rows = await inChunks(ids, (part) => edu().from("learner_presence").select("user_id").in("user_id", part).gte("last_seen_at", cutoff()));
    return new Set(rows.map((r) => r.user_id));
  }
  const { data } = await edu().from("learner_presence").select("user_id").gte("last_seen_at", cutoff()).order("last_seen_at", { ascending: false }).limit(CANDIDATE_CAP);
  return new Set((data || []).map((r) => r.user_id));
}

/** Who among `ids` is in a live battle right now (online but not available). */
export async function inBattleIds(ids) {
  const rows = await inChunks(ids, (part) => db.from("battle_participants").select("user_id, battles!inner(status)").in("user_id", part).eq("battles.status", "live"));
  return new Set(rows.map((r) => r.user_id));
}

/* ── Settings, blocks, reports ──────────────────────────────────────────── */

export const DEFAULT_SETTINGS = Object.freeze({
  visibility: "everyone", accept_messages: "everyone", open_to_challenges: true,
  battle_times: [], battle_types: [], show_on_leaderboards: true, daily_subject: null,
});

export async function getSettings(userId) {
  const { data } = await edu().from("agent_network_settings").select("*").eq("user_id", userId).maybeSingle();
  return { ...DEFAULT_SETTINGS, ...(data || {}), user_id: userId };
}

export function cleanSettings(input = {}) {
  const out = {};
  if (VISIBILITY.includes(input.visibility)) out.visibility = input.visibility;
  if (["everyone", "school", "classmates", "nobody"].includes(input.accept_messages)) out.accept_messages = input.accept_messages;
  if (typeof input.open_to_challenges === "boolean") out.open_to_challenges = input.open_to_challenges;
  if (typeof input.show_on_leaderboards === "boolean") out.show_on_leaderboards = input.show_on_leaderboards;
  if (Array.isArray(input.battle_times)) out.battle_times = [...new Set(input.battle_times.filter((t) => BATTLE_TIMES.includes(t)))];
  if (typeof input.daily_subject === "string") out.daily_subject = input.daily_subject.trim().slice(0, 60) || null;
  else if (input.daily_subject === null) out.daily_subject = null;
  if (Array.isArray(input.battle_types)) out.battle_types = [...new Set(input.battle_types.filter((t) => ["1v1", "open", "team", "review"].includes(t)))];
  return out;
}

export async function saveSettings(userId, input) {
  const patch = cleanSettings(input);
  if (!Object.keys(patch).length) { const e = new Error("Nothing to change."); e.status = 400; throw e; }
  const { data, error } = await edu().from("agent_network_settings")
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" }).select().single();
  if (error) throw new Error(error.message);
  return { ...DEFAULT_SETTINGS, ...data };
}

/** Everyone the viewer blocked or was blocked by. */
export async function blockedWith(userId) {
  const [{ data: a }, { data: b }] = await Promise.all([
    edu().from("agent_blocks").select("blocked_id").eq("blocker_id", userId),
    edu().from("agent_blocks").select("blocker_id").eq("blocked_id", userId),
  ]);
  return new Set([...(a || []).map((r) => r.blocked_id), ...(b || []).map((r) => r.blocker_id)]);
}

export async function block(userId, other) {
  // A userId, or the @username search_agents shows. It used to take only an
  // id, ignore the write's error, and report "blocked" when nothing was.
  let otherId = String(other || "").trim();
  if (otherId && !/^[0-9a-f-]{36}$/i.test(otherId)) {
    const { data: u } = await db.from("users").select("id").ilike("username", otherId.replace(/^@/, "")).limit(1);
    otherId = u?.[0]?.id || "";
    if (!otherId) { const e = new Error("No learner by that name — find them with search_agents first."); e.status = 404; throw e; }
  }
  if (!otherId || otherId === userId) { const e = new Error("Pick someone else to block."); e.status = 400; throw e; }
  const { error } = await edu().from("agent_blocks").upsert({ blocker_id: userId, blocked_id: otherId }, { onConflict: "blocker_id,blocked_id" });
  if (error) { const e = new Error("Couldn't block that learner — check who you meant."); e.status = 400; throw e; }
  // A block ends any study-buddy pairing, so their check-ins and your weekly
  // progress stop flowing between you.
  await edu().from("study_buddies").update({ status: "ended" })
    .or(`and(requester_id.eq.${userId},buddy_id.eq.${otherId}),and(requester_id.eq.${otherId},buddy_id.eq.${userId})`)
    .in("status", ["pending", "active"]).then(() => {}, () => {});
  return { blocked: otherId };
}
export async function unblock(userId, otherId) {
  await edu().from("agent_blocks").delete().eq("blocker_id", userId).eq("blocked_id", otherId);
  return { unblocked: otherId };
}
export async function report(userId, otherId, reason, context = null) {
  const why = String(reason || "").trim().slice(0, 1000);
  if (!otherId || !why) { const e = new Error("Say who and what happened."); e.status = 400; throw e; }
  const { data, error } = await edu().from("agent_reports").insert({ reporter_id: userId, reported_id: otherId, reason: why, context }).select("id").single();
  if (error) throw new Error(error.message);
  await block(userId, otherId).catch(() => {});   // reporting also stops them reaching you
  return { reported: data.id };
}

/* ── Relations (who is near me) ─────────────────────────────────────────── */

/**
 * → { school, classmates:Set, coursemates:Map(userId → [course titles]), liveMates:Map, communityMates:Map,
 *     courses:[{id,title,type}], communities:[{id,name}] }
 */
export async function relationsOf(viewerId) {
  const [{ data: me }, { data: rooms }, { data: enr }, { data: comms }] = await Promise.all([
    db.from("users").select("school_name").eq("id", viewerId).maybeSingle(),
    db.from("classroom_students").select("classroom_id").eq("user_id", viewerId).eq("status", "active"),
    db.from("enrollments").select("course_id, courses(id, title, course_type)").eq("user_id", viewerId).eq("status", "active"),
    edu().from("community_members").select("community_id, communities(id, name)").eq("user_id", viewerId),
  ]);
  const roomIds = (rooms || []).map((r) => r.classroom_id);
  const courses = (enr || []).map((e) => ({ id: e.course_id, title: e.courses?.title || "a course", type: e.courses?.course_type || "video" }));
  const communities = (comms || []).map((c) => ({ id: c.community_id, name: c.communities?.name || "a community" }));

  const [mates, courseRows, commRows] = await Promise.all([
    roomIds.length ? db.from("classroom_students").select("user_id").in("classroom_id", roomIds).eq("status", "active").limit(2000) : { data: [] },
    courses.length ? db.from("enrollments").select("user_id, course_id").in("course_id", courses.map((c) => c.id)).eq("status", "active").limit(4000) : { data: [] },
    communities.length ? edu().from("community_members").select("user_id, community_id").in("community_id", communities.map((c) => c.id)).limit(4000) : { data: [] },
  ]);
  const classmates = new Set((mates.data || []).map((r) => r.user_id));
  classmates.delete(viewerId);
  const byCourse = new Map(courses.map((c) => [c.id, c]));
  const coursemates = new Map(), liveMates = new Map(), communityMates = new Map();
  for (const r of courseRows.data || []) {
    if (r.user_id === viewerId) continue;
    const c = byCourse.get(r.course_id);
    const m = c?.type === "live" ? liveMates : coursemates;
    m.set(r.user_id, [...(m.get(r.user_id) || []), c?.title || "a course"]);
  }
  const byComm = new Map(communities.map((c) => [c.id, c.name]));
  for (const r of commRows.data || []) {
    if (r.user_id === viewerId) continue;
    communityMates.set(r.user_id, [...(communityMates.get(r.user_id) || []), byComm.get(r.community_id)]);
  }
  return { school: me?.school_name || null, classmates, coursemates, liveMates, communityMates, courses, communities };
}

/* ── Search ─────────────────────────────────────────────────────────────── */

/** The first pool of user ids for the scope (before the other filters). */
async function candidatePool(viewerId, f, rel, me) {
  const pick = (m, id) => (id ? [...m.entries()].filter(([, v]) => v.length).map(([k]) => k) : [...m.keys()]);
  switch (f.scope) {
    case "classmates": return [...rel.classmates];
    case "course": {
      if (f.scope_id) {
        const { data } = await db.from("enrollments").select("user_id").eq("course_id", f.scope_id).eq("status", "active").limit(CANDIDATE_CAP);
        return (data || []).map((r) => r.user_id);
      }
      return pick(rel.coursemates);
    }
    case "live_class": {
      if (f.scope_id) {
        const { data } = await db.from("enrollments").select("user_id").eq("course_id", f.scope_id).eq("status", "active").limit(CANDIDATE_CAP);
        return (data || []).map((r) => r.user_id);
      }
      return pick(rel.liveMates);
    }
    case "community": {
      if (f.scope_id) {
        const { data } = await edu().from("community_members").select("user_id").eq("community_id", f.scope_id).limit(CANDIDATE_CAP);
        return (data || []).map((r) => r.user_id);
      }
      return pick(rel.communityMates);
    }
    case "school": {
      const school = f.school || me.school;
      if (!school) return [];
      const { data } = await db.from("users").select("id").ilike("school_name", school).limit(CANDIDATE_CAP);
      return (data || []).map((r) => r.id);
    }
    default: {
      if (f.online_only) return [...(await onlineIds())];
      if (f.query) {
        const q = f.query.replace(/^@/, "").replace(/[%,()]/g, "");
        const { data } = await db.from("users").select("id").or(`username.ilike.%${q}%,full_name.ilike.%${q}%`).limit(CANDIDATE_CAP);
        const { data: ag } = await db.from("user_agents").select("user_id").ilike("agent_name", `%${q}%`).limit(100);
        return [...(data || []).map((r) => r.id), ...(ag || []).map((r) => r.user_id)];
      }
      if (f.school || f.same_school) {
        const school = f.school || me.school;
        if (school) {
          const { data } = await db.from("users").select("id").ilike("school_name", school).limit(CANDIDATE_CAP);
          return (data || []).map((r) => r.id);
        }
      }
      // Everyone: the most active agents, narrowed by XP when asked.
      let q = db.from("user_agents").select("user_id").eq("is_active", true).order("total_xp", { ascending: false }).limit(CANDIDATE_CAP);
      if (f.min_xp != null) q = q.gte("total_xp", f.min_xp);
      if (f.max_xp != null) q = q.lte("total_xp", f.max_xp);
      if (f.exam) q = q.ilike("exam_board", `%${f.exam}%`);
      const { data } = await q;
      return (data || []).map((r) => r.user_id);
    }
  }
}

/** Topics the viewer is weak on (low confidence), for complements_me. */
async function weakTopics(viewerId) {
  const { data } = await edu().from("student_knowledge").select("topic, confidence").eq("student_id", viewerId)
    .lt("confidence", 0.5).order("confidence", { ascending: true }).limit(8);
  return [...new Set((data || []).map((r) => r.topic).filter(Boolean))];
}

/**
 * The agents the viewer may see that match the filters, best first.
 * → { agents: [...], total, page, pageSize, filters }
 */
export async function searchAgents(viewerId, raw = {}) {
  const f = cleanFilters(raw);
  const [rel, blocked, { data: meRow }, { data: myAgent }] = await Promise.all([
    relationsOf(viewerId), blockedWith(viewerId),
    db.from("users").select("school_name").eq("id", viewerId).maybeSingle(),
    db.from("user_agents").select("total_xp").eq("user_id", viewerId).maybeSingle(),
  ]);
  const me = { id: viewerId, school: meRow?.school_name || null, xp: myAgent?.total_xp || 0 };
  if (f.fair_match) { const r = fairRange(me.xp); f.min_xp ??= r.min; f.max_xp ??= r.max; }

  let ids = [...new Set(await candidatePool(viewerId, f, rel, me))].filter((id) => id !== viewerId && !blocked.has(id)).slice(0, CANDIDATE_CAP);
  if (!ids.length) return { agents: [], total: 0, page: f.page, pageSize: PAGE_SIZE, filters: f };

  const [users, agents, settings, presence, ranks] = await Promise.all([
    inChunks(ids, (p) => db.from("users").select("id, username, full_name, role, school_name, year_group, study_level, subjects, city, language, deactivated_at, deleted_at").in("id", p)),
    inChunks(ids, (p) => db.from("user_agents").select("id, user_id, agent_name, agent_emoji, agent_color, total_xp, level, exam_board, subjects, goal, is_active").in("user_id", p)),
    inChunks(ids, (p) => edu().from("agent_network_settings").select("*").in("user_id", p)),
    inChunks(ids, (p) => edu().from("learner_presence").select("user_id, last_seen_at").in("user_id", p)),
    inChunks(ids, (p) => db.from("xp_leaderboard").select("user_id, rank, battles_won, battles_played, win_rate").eq("scope", "global").in("user_id", p)),
  ]);
  const by = (rows, k = "user_id") => new Map(rows.map((r) => [r[k], r]));
  const U = by(users, "id"), A = by(agents), S = by(settings), P = by(presence), R = by(ranks);

  // The richer filters only query what's needed.
  const needGoals = !!(f.exam || f.goal);
  const [goals, taught, pq, weak] = await Promise.all([
    needGoals ? inChunks(ids, (p) => edu().from("learner_goals").select("user_id, title, exam").in("user_id", p).eq("status", "active")) : [],
    f.topic || f.complements_me ? inChunks(ids, (p) => edu().from("agent_knowledge").select("student_id, topic, subject, confidence").in("student_id", p).gte("confidence", 0.55).limit(4000)) : [],
    f.min_past_questions != null ? inChunks(ids, (p) => { let q = edu().from("past_question_attempts").select("user_id, attempted, exam, subject").in("user_id", p); if (f.exam) q = q.ilike("exam", f.exam); if (f.subject) q = q.ilike("subject", f.subject); return q; }) : [],
    f.complements_me ? weakTopics(viewerId) : [],
  ]);
  const goalsOf = new Map(); for (const g of goals) goalsOf.set(g.user_id, [...(goalsOf.get(g.user_id) || []), g]);
  const taughtOf = new Map(); for (const k of taught) taughtOf.set(k.student_id, [...(taughtOf.get(k.student_id) || []), k]);
  const pqOf = new Map(); for (const r of pq) pqOf.set(r.user_id, (pqOf.get(r.user_id) || 0) + (Number(r.attempted) || 0));
  const inBattle = f.available_only || f.online_only ? await inBattleIds(ids) : new Set();

  const has = (hay, needle) => !!needle && String(hay || "").toLowerCase().includes(String(needle).toLowerCase());
  const now = Date.now();
  const out = [];
  for (const id of ids) {
    const u = U.get(id), a = A.get(id);
    if (!u || !a || a.is_active === false) continue;
    const st = S.get(id) || DEFAULT_SETTINGS;
    const relFlags = { classmate: rel.classmates.has(id), coursemate: rel.coursemates.has(id) || rel.liveMates.has(id) };
    const target = { id, role: u.role, school: u.school_name, deactivated: !!(u.deactivated_at || u.deleted_at), settings: st };
    if (!canFind(me, target, relFlags, blocked)) continue;

    const lastSeenAt = P.get(id)?.last_seen_at || null;
    const presence = presenceOf(lastSeenAt, now);
    const available = presence === "online" && !inBattle.has(id);
    const subjects = [...new Set([...(u.subjects || []), ...(a.subjects || [])])];
    const rank = R.get(id) || {};
    const myGoals = goalsOf.get(id) || [];
    const exam = a.exam_board || myGoals.find((g) => g.exam)?.exam || null;

    if (f.online_only && presence !== "online") continue;
    if (f.available_only && !available) continue;
    if (f.open_to_challenges && st.open_to_challenges === false) continue;
    if (f.query && !(has(u.username, f.query.replace(/^@/, "")) || has(u.full_name, f.query) || has(a.agent_name, f.query))) continue;
    if (f.school && !has(u.school_name, f.school)) continue;
    if (f.same_school && !(me.school && has(u.school_name, me.school))) continue;
    if (f.year_group && !has(u.year_group, f.year_group)) continue;
    if (f.study_level && !has(u.study_level, f.study_level)) continue;
    if (f.subject && !subjects.some((s) => has(s, f.subject))) continue;
    if (f.exam && !(has(a.exam_board, f.exam) || myGoals.some((g) => has(g.exam, f.exam)))) continue;
    if (f.goal && !(has(a.goal, f.goal) || myGoals.some((g) => has(g.title, f.goal)))) continue;
    if (f.min_xp != null && (a.total_xp || 0) < f.min_xp) continue;
    if (f.max_xp != null && (a.total_xp || 0) > f.max_xp) continue;
    if (f.min_level != null && (a.level || 1) < f.min_level) continue;
    if (f.max_level != null && (a.level || 1) > f.max_level) continue;
    if (f.rank_max != null && !(rank.rank && rank.rank <= f.rank_max)) continue;
    if (f.min_win_rate != null && (rank.win_rate || 0) < f.min_win_rate) continue;
    if (f.min_battles != null && (rank.battles_played || 0) < f.min_battles) continue;
    if (f.min_past_questions != null && (pqOf.get(id) || 0) < f.min_past_questions) continue;
    if (f.active_within_days != null && !(lastSeenAt && now - Date.parse(lastSeenAt) <= f.active_within_days * 86400_000)) continue;
    if (f.battle_time && (st.battle_times || []).length && !(st.battle_times || []).includes(f.battle_time)) continue;
    if (f.city && !has(u.city, f.city)) continue;
    if (f.language && !has(u.language, f.language)) continue;

    const known = taughtOf.get(id) || [];
    const taughtMatch = f.topic ? [...new Set(known.filter((k) => has(k.topic, f.topic) || has(k.subject, f.topic)).map((k) => k.topic))].slice(0, 5) : [];
    if (f.topic && !taughtMatch.length) continue;
    const complements = f.complements_me ? [...new Set(known.filter((k) => weak.some((w) => has(k.topic, w) || has(w, k.topic))).map((k) => k.topic))].slice(0, 5) : [];
    if (f.complements_me && !complements.length) continue;

    const shared = [
      ...(rel.classmates.has(id) ? ["Classmate"] : []),
      ...(me.school && has(u.school_name, me.school) && !rel.classmates.has(id) ? ["Same school"] : []),
      ...(rel.liveMates.get(id) || []).slice(0, 2).map((t) => `Live class: ${t}`),
      ...(rel.coursemates.get(id) || []).slice(0, 2).map((t) => `Course: ${t}`),
      ...(rel.communityMates.get(id) || []).slice(0, 2).map((t) => `Community: ${t}`),
    ];
    out.push({
      userId: id, username: u.username, name: firstName(u.full_name, u.username),
      agentId: a.id, agentName: a.agent_name, agentEmoji: a.agent_emoji || "🤖", agentColor: a.agent_color || null,
      level: a.level || 1, xp: a.total_xp || 0, rank: rank.rank ?? null, winRate: rank.win_rate ?? null, battlesPlayed: rank.battles_played ?? 0,
      school: st.visibility === "everyone" || shared.length ? u.school_name || null : null,
      yearGroup: u.year_group || null, studyLevel: u.study_level || null, subjects: subjects.slice(0, 8), exam,
      presence, available, lastSeenAt, openToChallenges: st.open_to_challenges !== false,
      battleTimes: st.battle_times || [], battleTypes: st.battle_types || [],
      shared, matches: { taught: taughtMatch, complements, pastQuestions: pqOf.get(id) || 0 },
    });
  }
  const sorted = rankAgents(out, f, me);
  const start = (f.page - 1) * PAGE_SIZE;
  return { agents: sorted.slice(start, start + PAGE_SIZE), total: sorted.length, page: f.page, pageSize: PAGE_SIZE, filters: f };
}

/** One agent as the viewer may see it (null when they may not). */
export async function profileFor(viewerId, userId) {
  const { data: u } = await db.from("users").select("username").eq("id", userId).maybeSingle();
  if (!u?.username) return null;
  const { agents } = await searchAgents(viewerId, { query: u.username });
  return agents.find((a) => a.userId === userId) || null;
}

/** How many agents are online now (for the "N agents online" line). */
export async function onlineCount() {
  const { count } = await edu().from("learner_presence").select("user_id", { count: "exact", head: true }).gte("last_seen_at", cutoff());
  return count || 0;
}

/* ── Past questions practised ───────────────────────────────────────────── */

export async function logPastQuestions(userId, { exam, subject = null, year = null, attempted, correct = 0, source = "practice", battleId = null }) {
  const n = Math.max(0, Math.min(500, Math.round(Number(attempted) || 0)));
  if (!exam || !n) { const e = new Error("Say which exam and how many questions."); e.status = 400; throw e; }
  const row = {
    user_id: userId, exam: String(exam).toUpperCase().slice(0, 20), subject: subject ? String(subject).slice(0, 60) : null,
    year: Number.isInteger(Number(year)) ? Number(year) : null, attempted: n,
    correct: Math.max(0, Math.min(n, Math.round(Number(correct) || 0))),
    source: ["practice", "battle", "agent", "daily"].includes(source) ? source : "practice", battle_id: battleId,
  };
  const { error } = await edu().from("past_question_attempts").insert(row);
  if (error) throw new Error(error.message);
  return row;
}

export async function pastQuestionSummary(userId) {
  const { data } = await edu().from("past_question_attempts").select("exam, subject, year, attempted, correct").eq("user_id", userId).limit(2000);
  const by = new Map();
  for (const r of data || []) {
    const k = `${r.exam}|${r.subject || ""}`;
    const s = by.get(k) || { exam: r.exam, subject: r.subject, attempted: 0, correct: 0, years: new Set() };
    s.attempted += r.attempted; s.correct += r.correct; if (r.year) s.years.add(r.year);
    by.set(k, s);
  }
  return [...by.values()].map((s) => ({ ...s, years: [...s.years].sort(), accuracy: s.attempted ? Math.round((s.correct / s.attempted) * 100) : 0 }));
}
