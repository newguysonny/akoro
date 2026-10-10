/**
 * agent-network/activities.js — things agents do together beyond one battle.
 *
 *   Study buddies     requestBuddy / respondBuddy / listBuddies / buddyCheckin / endBuddy
 *                     two agents keep each other on track: a weekly check-in carries
 *                     each learner's goal progress and week's XP to the other.
 *   Daily battle      joinDaily / skipDaily / dailyStatus / dailyRanking — a real battle
 *                     every day at 7 PM per subject, played in the normal arena by
 *                     each learner's agent; ranked across heats; recurs daily.
 *   Revision circles  createCircle / searchCircles / joinCircle / leaveCircle / myCircles —
 *                     3–8 agents on one exam topic; when it fills (or at its time with
 *                     3+), a group battle on that topic is made for them.
 *   Weekly leagues    weeklyLeague — this week's XP ranking (Mon–Sun, Lagos) among
 *                     classmates, school, a subject's agents, an exam's, or everyone.
 */
import db from "../../db.js";
import { buildQuestions } from "../battle/questionSource.js";
import { createNetworkBattle } from "../battle/networkBattle.js";
import { notifyUser } from "../notify.js";
import { canMessage } from "./filters.js";
import { relationsOf, blockedWith, getSettings } from "./network.js";

const edu = () => db.schema("edu");
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const first = (full, username) => String(full || "").trim().split(/\s+/)[0] || username || "a learner";
const LAGOS_MS = 3600_000;
/** Today in Lagos as YYYY-MM-DD. */
export const lagosDay = (t = Date.now()) => new Date(t + LAGOS_MS).toISOString().slice(0, 10);
/** Monday 00:00 Lagos of this week, as an ISO instant. */
export function weekStart(t = Date.now()) {
  const d = new Date(t + LAGOS_MS);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back); d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - LAGOS_MS).toISOString();
}

async function resolveUser(to) {
  const s = String(to || "").trim();
  if (!s) throw fail("Who? Find them with search_agents first.");
  const q = /^[0-9a-f-]{36}$/i.test(s) ? db.from("users").select("id, full_name, username, role, school_name, deactivated_at, deleted_at").eq("id", s)
    : db.from("users").select("id, full_name, username, role, school_name, deactivated_at, deleted_at").ilike("username", s.replace(/^@/, ""));
  const { data } = await q.limit(1);
  if (!data?.length) throw fail("No learner by that name.");
  return data[0];
}
async function mayReach(meId, target) {
  const [rel, blocked, { data: me }, settings] = await Promise.all([relationsOf(meId), blockedWith(meId), db.from("users").select("school_name").eq("id", meId).maybeSingle(), getSettings(target.id)]);
  const t = { id: target.id, role: target.role, school: target.school_name, deactivated: !!(target.deactivated_at || target.deleted_at), settings };
  if (!canMessage({ id: meId, school: me?.school_name }, t, { classmate: rel.classmates.has(target.id), coursemate: rel.coursemates.has(target.id) || rel.liveMates.has(target.id) }, blocked)) {
    throw fail("That agent isn't available to you.", 403);
  }
}

/* ── Study buddies ──────────────────────────────────────────────────────── */

const WEEK_MS = 7 * 86400_000;

export async function requestBuddy(meId, { to, goal = null, subject = null, exam = null } = {}) {
  const target = await resolveUser(to);
  if (target.id === meId) throw fail("That's you.");
  await mayReach(meId, target);
  const { count } = await edu().from("study_buddies").select("id", { count: "exact", head: true }).or(`requester_id.eq.${meId},buddy_id.eq.${meId}`).in("status", ["pending", "active"]);
  if ((count ?? 0) >= 5) throw fail("You have 5 study buddies already — end one first.", 429);
  const { data, error } = await edu().from("study_buddies").insert({
    requester_id: meId, buddy_id: target.id, goal: goal ? String(goal).slice(0, 200) : null,
    subject: subject ? String(subject).slice(0, 60) : null, exam: exam ? String(exam).toUpperCase().slice(0, 20) : null,
  }).select().single();
  if (error) throw fail(/duplicate|uq_study_buddies_pair/i.test(error.message) ? "You're already buddies (or asked)." : error.message, 409);
  const { data: me } = await db.from("users").select("full_name, username").eq("id", meId).maybeSingle();
  await notifyUser({ userId: target.id, type: "study_buddy", title: `🤝 ${first(me?.full_name, me?.username)} wants your agents to be study buddies`,
    content: [goal, subject, exam].filter(Boolean).join(" · ") || "Weekly check-ins to keep each other on track", relatedId: data.id, link: "/app?tab=agent" }).catch(() => {});
  return { requested: data.id };
}

export async function respondBuddy(meId, id, accept) {
  const { data: b } = await edu().from("study_buddies").select("*").eq("id", id).eq("buddy_id", meId).eq("status", "pending").maybeSingle();
  if (!b) throw fail("That request isn't waiting for you.", 404);
  const now = Date.now();
  await edu().from("study_buddies").update(accept
    ? { status: "active", accepted_at: new Date(now).toISOString(), next_checkin_at: new Date(now + WEEK_MS).toISOString() }
    : { status: "declined" }).eq("id", id);
  const { data: me } = await db.from("users").select("full_name, username").eq("id", meId).maybeSingle();
  await notifyUser({ userId: b.requester_id, type: "study_buddy", title: accept ? `🤝 ${first(me?.full_name, me?.username)} is your study buddy now` : "Study buddy request declined",
    content: accept ? "Your agents will check in with each other every week." : "", relatedId: id, link: "/app?tab=agent" }).catch(() => {});
  return { status: accept ? "active" : "declined" };
}

/** What a check-in carries: goal progress and this week's XP — never marks or messages. */
async function progressSnapshot(userId) {
  const since = weekStart();
  const [{ data: goals }, { data: xp }] = await Promise.all([
    edu().from("learner_goals").select("title, status, progress_note").eq("user_id", userId).in("status", ["active", "achieved"]).limit(5),
    db.from("xp_ledger").select("amount").eq("user_id", userId).gte("created_at", since).limit(2000),
  ]);
  return { weekXp: (xp || []).reduce((n, r) => n + (Number(r.amount) || 0), 0), goals: (goals || []).map((g) => ({ title: g.title, status: g.status, note: g.progress_note || null })) };
}

export async function listBuddies(meId) {
  const { data } = await edu().from("study_buddies").select("*").or(`requester_id.eq.${meId},buddy_id.eq.${meId}`).in("status", ["pending", "active"]).order("created_at", { ascending: false });
  const others = (data || []).map((b) => (b.requester_id === meId ? b.buddy_id : b.requester_id));
  const { data: users } = others.length ? await db.from("users").select("id, full_name, username").in("id", others) : { data: [] };
  const U = new Map((users || []).map((u) => [u.id, u]));
  const now = Date.now();
  const out = [];
  for (const b of data || []) {
    const other = b.requester_id === meId ? b.buddy_id : b.requester_id;
    out.push({
      id: b.id, status: b.status, waitingOnMe: b.status === "pending" && b.buddy_id === meId,
      buddy: { userId: other, name: first(U.get(other)?.full_name, U.get(other)?.username), username: `@${U.get(other)?.username || ""}` },
      goal: b.goal, subject: b.subject, exam: b.exam,
      checkinDue: b.status === "active" && (!b.next_checkin_at || Date.parse(b.next_checkin_at) <= now),
      lastCheckin: b.last_checkin_at,
      ...(b.status === "active" ? { theirWeek: await progressSnapshot(other) } : {}),
    });
  }
  return { buddies: out };
}

export async function buddyCheckin(meId, id, note = "") {
  const { data: b } = await edu().from("study_buddies").select("*").eq("id", id).eq("status", "active").or(`requester_id.eq.${meId},buddy_id.eq.${meId}`).maybeSingle();
  if (!b) throw fail("That buddy isn't active.", 404);
  const other = b.requester_id === meId ? b.buddy_id : b.requester_id;
  const mine = await progressSnapshot(meId);
  const text = [`Weekly check-in: ${mine.weekXp} XP this week.`,
    ...mine.goals.map((g) => `${g.status === "achieved" ? "✓" : "•"} ${g.title}${g.note ? ` — ${g.note}` : ""}`),
    note ? `Note: ${String(note).replace(/[\w.+-]+@[\w-]+\.[\w.-]{2,}|\+?\d[\d\s().-]{7,}\d|https?:\/\/\S+/g, "[removed]").slice(0, 200)}` : ""].filter(Boolean).join("\n").slice(0, 800);
  await edu().from("agent_messages").insert({ from_user: meId, to_user: other, kind: "buddy_checkin", body: text, status: "delivered" });
  await edu().from("study_buddies").update({ last_checkin_at: new Date().toISOString(), next_checkin_at: new Date(Date.now() + WEEK_MS).toISOString() }).eq("id", id);
  const { data: me } = await db.from("users").select("full_name, username").eq("id", meId).maybeSingle();
  await notifyUser({ userId: other, type: "study_buddy", title: `🤝 ${first(me?.full_name, me?.username)}'s agent checked in`, content: text.split("\n")[0], relatedId: id, link: "/app?tab=agent" }).catch(() => {});
  return { sent: true, snapshot: mine };
}

export async function endBuddy(meId, id) {
  const { data } = await edu().from("study_buddies").update({ status: "ended" }).eq("id", id).or(`requester_id.eq.${meId},buddy_id.eq.${meId}`).in("status", ["pending", "active"]).select("id");
  if (!data?.length) throw fail("No such buddy.", 404);
  return { ended: id };
}

/** For the Agent Chat prompt: buddy requests and check-ins due. */
export async function buddyBrief(meId) {
  const { buddies } = await listBuddies(meId).catch(() => ({ buddies: [] }));
  const waiting = buddies.filter((b) => b.waitingOnMe).length;
  const due = buddies.filter((b) => b.checkinDue).length;
  if (!waiting && !due) return "";
  return `\n\n## Study buddies\n${waiting ? `${waiting} study-buddy request${waiting === 1 ? "" : "s"} waiting for an answer. ` : ""}` +
    `${due ? `${due} weekly check-in${due === 1 ? "" : "s"} due — offer to send it (buddy_checkin).` : ""}`;
}

/* ── Daily battle ───────────────────────────────────────────────────────── */
//
// A real battle that recurs: every day at DAILY_BATTLE_HOUR (19:00 Lagos) one
// battle per subject runs in the same arena as every other battle — each
// learner's agent answers from their own notes, they watch it live, and it
// settles XP like any group battle. Learners take a seat in the next one when
// they open Battles (or ask their agent) and can skip a day. A busy subject is
// split into heats of DAILY_SEATS that share one question set, so the day's
// ranking across heats is fair. Once it is over, the next day's is scheduled.

export const DAILY_START_HOUR = Math.min(23, Math.max(0, Number(process.env.DAILY_BATTLE_HOUR ?? 19) || 0));
export const DAILY_SEATS = 30;
export const DAILY_Q = 10;
const DAILY_SECONDS_PER_Q = 20;
const DAILY_XP = 100;
/** "2026-10-10" → when that day's battle starts (UTC instant). */
export function dailyStart(day) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - LAGOS_MS + DAILY_START_HOUR * 3600_000).toISOString();
}
const nextDay = (day) => new Date(Date.parse(`${day}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10);
/** The day whose battle a learner can still take a seat in: today's until a minute before it starts, then tomorrow's. */
export function upcomingDay(now = Date.now()) {
  const d = lagosDay(now);
  return now < Date.parse(dailyStart(d)) - 60_000 ? d : nextDay(d);
}
/** recurring_key = daily:<day>:<subject>:<heat> */
export const dailyKey = (day, subject, heat = null) => `daily:${day}:${String(subject).trim().toLowerCase()}:${heat ?? ""}`;
const DAILY_STATUS = { lobby: "scheduled", scheduled: "scheduled", live: "active", completed: "completed", cancelled: "missed", expired: "missed" };

async function dailySubjectFor(meId, subject = null) {
  if (subject) return String(subject).trim().slice(0, 60);
  const settings = await getSettings(meId);
  if (settings.daily_subject) return settings.daily_subject;
  const { data: u } = await db.from("users").select("subjects").eq("id", meId).maybeSingle();
  return (u?.subjects || [])[0] || "Mathematics";
}

/** My seats in daily battles (newest first). */
async function myDailySeats(meId, { day = null, limit = 14 } = {}) {
  const { data } = await db.from("battle_participants")
    .select("id, joined_at, declined_at, score, correct_answers, final_rank, xp_earned, battles!inner(id, status, subject, recurring_key, scheduled_start, total_questions)")
    .eq("user_id", meId).like("battles.recurring_key", day ? `daily:${day}:%` : "daily:%")
    .limit(400);
  // One seat a day; newest day first (the key carries the day).
  return (data || []).filter((s) => s.battles)
    .sort((x, y) => String(y.battles.recurring_key).localeCompare(String(x.battles.recurring_key))).slice(0, limit);
}

/** Make one heat of a day's battle: questions (heat 1) or a copy of heat 1's, and the start job. */
async function createDailyHeat(day, subject, heat, copyFrom = null) {
  const startsAt = dailyStart(day);
  const key = dailyKey(day, subject, heat);
  const { data: b, error } = await db.from("battles").insert({
    course_id: null, classroom_id: null, battle_type: "classroom",
    title: `Daily battle · ${subject}`, description: "Daily battle", subject, topic: null, difficulty: "intermediate",
    total_questions: DAILY_Q, time_limit_seconds: DAILY_Q * DAILY_SECONDS_PER_Q,
    xp_prize: DAILY_XP, xp_pool: DAILY_XP, max_participants: DAILY_SEATS, total_participants: 0,
    status: "scheduled", scheduled_start: startsAt, expires_at: startsAt, created_by: null, recurring_key: key,
  }).select().single();
  if (error) {
    // Two learners making the same heat at once: keep whichever landed.
    if (/duplicate|unique/i.test(error.message)) {
      const { data: won } = await db.from("battles").select("*").eq("recurring_key", key).maybeSingle();
      if (won) return won;
    }
    throw new Error(error.message);
  }
  try {
    if (copyFrom) {
      const { data: qs } = await db.from("battle_questions").select("*").eq("battle_id", copyFrom).order("question_order");
      if (!qs?.length) throw fail("Today's questions aren't ready — try again in a moment.");
      await db.from("battle_questions").insert(qs.map(({ id: _id, created_at: _c, ...q }) => ({ ...q, battle_id: b.id })));
      if (qs.length !== DAILY_Q) await db.from("battles").update({ total_questions: qs.length }).eq("id", b.id);
    } else {
      // The platform writes the day's set (past papers first): nobody is billed for a battle everyone shares.
      const fill = await buildQuestions({ battleId: b.id, source: "auto", total: DAILY_Q, subject, difficulty: "intermediate", userId: null, durationSeconds: DAILY_Q * DAILY_SECONDS_PER_Q });
      if ((fill?.placed ?? 0) < 5) throw fail(`Couldn't put together a ${subject} daily battle — pick another subject in Settings → Agent.`);
      if (fill.placed !== DAILY_Q) await db.from("battles").update({ total_questions: fill.placed, time_limit_seconds: fill.placed * (fill.secondsPerQuestion || DAILY_SECONDS_PER_Q) }).eq("id", b.id);
    }
  } catch (e) {
    await db.from("battles").delete().eq("id", b.id);
    throw e;
  }
  const { battleQueue } = await import("../battle/worker.js");
  await battleQueue.add("start-battle", { action: "start-battle", battleId: b.id },
    { delay: Math.max(0, Date.parse(startsAt) - Date.now()), jobId: `start-${b.id}` });
  return b;
}

/**
 * Take a seat in the next daily battle. `auto` (the Battles tab opening) never
 * undoes a skip; an explicit join does.
 * → { battleId, day, subject, startsAt, status: joined | skipped }
 */
export async function joinDaily(meId, { subject = null, auto = false } = {}) {
  const day = upcomingDay();
  const startsAt = dailyStart(day);
  const [seat] = await myDailySeats(meId, { day, limit: 1 });
  if (seat) {
    if (seat.declined_at && !auto) {
      await db.from("battle_participants").update({ declined_at: null, joined_at: new Date().toISOString() }).eq("id", seat.id);
      return { battleId: seat.battles.id, day, subject: seat.battles.subject, startsAt, status: "joined", rejoined: true };
    }
    return { battleId: seat.battles.id, day, subject: seat.battles.subject, startsAt, status: seat.declined_at ? "skipped" : "joined", already: true };
  }
  const subj = await dailySubjectFor(meId, subject);
  const { data: agent } = await db.from("user_agents").select("id").eq("user_id", meId).maybeSingle();
  if (!agent) throw fail("Create your agent first — it plays the daily battle for you.");

  const { data: heats } = await db.from("battles").select("id, status, total_participants, recurring_key")
    .like("recurring_key", `${dailyKey(day, subj)}%`).order("created_at", { ascending: true });
  let b = (heats || []).find((h) => h.status === "scheduled" && (h.total_participants || 0) < DAILY_SEATS);
  if (!b) b = await createDailyHeat(day, subj, (heats || []).length + 1, heats?.[0]?.id || null);

  const { error } = await db.from("battle_participants").insert({ battle_id: b.id, user_id: meId, agent_id: agent.id, role: "participant", joined_at: new Date().toISOString() });
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  const { count } = await db.from("battle_participants").select("id", { count: "exact", head: true }).eq("battle_id", b.id);
  // The pool grows with the field, as in any group battle.
  await db.from("battles").update({ total_participants: count ?? 1, xp_pool: DAILY_XP * Math.max(1, Math.ceil((count ?? 1) / 2)) }).eq("id", b.id);
  return { battleId: b.id, day, subject: subj, startsAt, status: "joined", joined: true };
}

/** Sit out the next daily battle (join again any time before it starts). */
export async function skipDaily(meId) {
  const day = upcomingDay();
  const [seat] = await myDailySeats(meId, { day, limit: 1 });
  if (!seat) return { day, status: "skipped" };
  if (seat.battles.status !== "scheduled") throw fail("That daily battle has already started.", 409);
  await db.from("battle_participants").update({ declined_at: new Date().toISOString() }).eq("id", seat.id);
  return { battleId: seat.battles.id, day, status: "skipped" };
}

/** Where today's daily battle stands for me, the next one, and my recent results. */
export async function dailyStatus(meId, now = Date.now()) {
  const subject = await dailySubjectFor(meId);
  const day = lagosDay(now);
  const seats = await myDailySeats(meId);
  const dayOf = (s) => String(s.battles.recurring_key).split(":")[1];
  const today = seats.find((s) => dayOf(s) === day) || null;
  const startsAt = dailyStart(day);
  const status = today ? (today.declined_at ? "skipped" : DAILY_STATUS[today.battles.status] || "scheduled")
    : now < Date.parse(startsAt) ? "scheduled" : "missed";
  const next = upcomingDay(now);
  return {
    subject: today?.battles.subject || subject, day, status, startsAt, battleId: today?.battles.id || null,
    next: { day: next, startsAt: dailyStart(next) },
    history: seats.filter((s) => s.battles.status === "completed").map((s) => ({
      day: dayOf(s), subject: s.battles.subject, battleId: s.battles.id, score: s.correct_answers ?? s.score ?? 0,
      total: s.battles.total_questions, rank: s.final_rank, xp: s.xp_earned || 0,
    })),
  };
}

/** One day's ranking for a subject, across all its heats: correct answers, then HP. */
export async function dailyRanking(meId, subject, day = lagosDay()) {
  const subj = await dailySubjectFor(meId, subject || null);
  const { data: heats } = await db.from("battles").select("id, status, total_questions").like("recurring_key", `${dailyKey(day, subj)}%`);
  const ids = (heats || []).map((h) => h.id);
  const status = (heats || []).some((h) => h.status === "live") ? "active" : (heats || []).some((h) => h.status === "completed") ? "completed" : "scheduled";
  if (!ids.length) return { day, subject: subj, status, players: 0, top: [], me: null };
  const { data } = await db.from("battle_participants").select("user_id, score, correct_answers, hp, joined_at, declined_at, role")
    .in("battle_id", ids).limit(2000);
  // No HP, no ranking: an agent knocked out of its heat watched the rest.
  const rows = (data || []).filter((r) => r.role !== "teacher" && r.joined_at && !r.declined_at && (r.hp ?? 100) > 0)
    .sort((a, b) => (b.correct_answers ?? b.score ?? 0) - (a.correct_answers ?? a.score ?? 0) || (b.hp ?? 0) - (a.hp ?? 0));
  const total = heats[0]?.total_questions ?? DAILY_Q;
  const top = rows.slice(0, 20);
  const { data: users } = top.length ? await db.from("users").select("id, full_name, username, avatar_url").in("id", top.map((r) => r.user_id)) : { data: [] };
  const U = new Map((users || []).map((u) => [u.id, u]));
  const myIdx = rows.findIndex((r) => r.user_id === meId);
  const correct = (r) => r.correct_answers ?? r.score ?? 0;
  return {
    day, subject: subj, status, players: rows.length,
    top: top.map((r, i) => ({ rank: i + 1, name: first(U.get(r.user_id)?.full_name, U.get(r.user_id)?.username), avatar: U.get(r.user_id)?.avatar_url || null, correct: correct(r), total, you: r.user_id === meId })),
    me: myIdx >= 0 ? { rank: myIdx + 1, of: rows.length, correct: correct(rows[myIdx]), total } : null,
  };
}

/* ── Revision circles ───────────────────────────────────────────────────── */

export async function createCircle(meId, input = {}) {
  const subject = String(input.subject || "").trim().slice(0, 60);
  if (!subject) throw fail("Which subject is the circle revising?");
  const max = Math.min(8, Math.max(3, Math.round(Number(input.max_members) || 5)));
  let scheduled = null;
  if (input.scheduled_for) {
    const t = new Date(input.scheduled_for);
    if (Number.isNaN(t.getTime()) || t.getTime() < Date.now() + 5 * 60_000) throw fail("Pick a start time at least 5 minutes from now.");
    scheduled = t.toISOString();
  }
  const { count } = await edu().from("revision_circles").select("id", { count: "exact", head: true }).eq("created_by", meId).in("status", ["open", "full"]);
  if ((count ?? 0) >= 3) throw fail("You have 3 open circles — let one run first.", 429);
  const topic = input.topic ? String(input.topic).trim().slice(0, 120) : null;
  const { data: c, error } = await edu().from("revision_circles").insert({
    created_by: meId, subject, topic, exam: input.exam ? String(input.exam).toUpperCase().slice(0, 20) : null,
    title: String(input.title || "").trim().slice(0, 120) || `${input.exam ? `${String(input.exam).toUpperCase()} ` : ""}${subject}${topic ? ` — ${topic}` : ""} revision circle`,
    max_members: max, scheduled_for: scheduled,
  }).select().single();
  if (error) throw new Error(error.message);
  await edu().from("revision_circle_members").insert({ circle_id: c.id, user_id: meId });
  // Invite named agents (they still choose to join).
  const invited = [];
  for (const to of (Array.isArray(input.invite) ? input.invite : []).slice(0, max - 1)) {
    try {
      const u = await resolveUser(to); await mayReach(meId, u);
      await notifyUser({ userId: u.id, type: "revision_circle", title: `📚 You're invited to a revision circle: ${c.title}`, content: scheduled ? `Starts ${new Date(scheduled).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "Join to revise together — it ends in a group battle.", relatedId: c.id, link: "/app?tab=battles" });
      invited.push(u.id);
    } catch { /* skip that one */ }
  }
  return { circle: c, invited: invited.length };
}

async function startCircleIfReady(c) {
  const { data: members } = await edu().from("revision_circle_members").select("user_id").eq("circle_id", c.id);
  const ids = (members || []).map((m) => m.user_id);
  const due = c.scheduled_for && Date.parse(c.scheduled_for) <= Date.now();
  if (c.battle_id || !["open", "full"].includes(c.status)) return null;
  if (!(ids.length >= c.max_members || (due && ids.length >= 3))) {
    if (due && ids.length < 3) await edu().from("revision_circles").update({ status: "cancelled" }).eq("id", c.id);
    return null;
  }
  // Claim it first so two joins don't make two battles.
  const { data: claim } = await edu().from("revision_circles").update({ status: "running" }).eq("id", c.id).in("status", ["open", "full"]).is("battle_id", null).select("id");
  if (!claim?.length) return null;
  try {
    const b = await createNetworkBattle({
      creatorId: c.created_by, opponents: ids.filter((id) => id !== c.created_by), joined: ids.filter((id) => id !== c.created_by), startNowIfReady: true, source: "circle",
      options: { kind: "group", subject: c.subject, topic: c.topic, total_questions: 12, title: c.title,
        scheduled_for: c.scheduled_for && Date.parse(c.scheduled_for) > Date.now() + 60_000 ? c.scheduled_for : null },
    });
    await edu().from("revision_circles").update({ battle_id: b.battleId }).eq("id", c.id);
    return b.battleId;
  } catch (e) {
    await edu().from("revision_circles").update({ status: "open" }).eq("id", c.id);
    throw e;
  }
}

export async function joinCircle(meId, id) {
  const { data: c } = await edu().from("revision_circles").select("*").eq("id", id).maybeSingle();
  if (!c || !["open"].includes(c.status)) throw fail("That circle isn't open.", 409);
  const blocked = await blockedWith(meId);
  if (blocked.has(c.created_by)) throw fail("That circle isn't open to you.", 403);
  const { count } = await edu().from("revision_circle_members").select("user_id", { count: "exact", head: true }).eq("circle_id", id);
  if ((count ?? 0) >= c.max_members) throw fail("That circle is full.", 409);
  const { error } = await edu().from("revision_circle_members").insert({ circle_id: id, user_id: meId });
  if (error && !/duplicate|pkey/i.test(error.message)) throw new Error(error.message);
  const n = (count ?? 0) + 1;
  if (n >= c.max_members) await edu().from("revision_circles").update({ status: "full" }).eq("id", id).eq("status", "open");
  const battleId = await startCircleIfReady({ ...c, status: n >= c.max_members ? "full" : c.status }).catch(() => null);
  return { joined: id, members: `${n}/${c.max_members}`, ...(battleId ? { battleId, note: "The circle is full — its battle is on." } : {}) };
}

export async function leaveCircle(meId, id) {
  await edu().from("revision_circle_members").delete().eq("circle_id", id).eq("user_id", meId);
  await edu().from("revision_circles").update({ status: "open" }).eq("id", id).eq("status", "full");
  return { left: id };
}

/** Open circles the viewer could join (and their own), starting what's due. */
export async function searchCircles(meId, f = {}) {
  let q = edu().from("revision_circles").select("*").in("status", ["open", "full"]).order("created_at", { ascending: false }).limit(60);
  if (f.subject) q = q.ilike("subject", `%${String(f.subject).slice(0, 60)}%`);
  if (f.exam) q = q.ilike("exam", String(f.exam).slice(0, 20));
  if (f.topic) q = q.ilike("topic", `%${String(f.topic).slice(0, 80)}%`);
  const [{ data: rows }, blocked] = await Promise.all([q, blockedWith(meId)]);
  const out = [];
  for (const c of rows || []) {
    if (c.scheduled_for && Date.parse(c.scheduled_for) <= Date.now()) { await startCircleIfReady(c).catch(() => null); continue; }
    if (blocked.has(c.created_by)) continue;
    const { data: m } = await edu().from("revision_circle_members").select("user_id").eq("circle_id", c.id);
    const ids = (m || []).map((x) => x.user_id);
    out.push({ id: c.id, title: c.title, subject: c.subject, topic: c.topic, exam: c.exam, members: `${ids.length}/${c.max_members}`, mine: ids.includes(meId), startsAt: c.scheduled_for, status: c.status });
  }
  return { circles: out.slice(0, 20) };
}

/* ── Weekly leagues ─────────────────────────────────────────────────────── */

/** scope: classmates | school | subject | exam | everyone. → this week's XP top 20 and my place. */
export async function weeklyLeague(meId, { scope = "everyone", subject = null, exam = null } = {}) {
  const since = weekStart();
  let ids = null;
  if (scope === "classmates") {
    const rel = await relationsOf(meId);
    ids = [meId, ...rel.classmates, ...rel.coursemates.keys(), ...rel.liveMates.keys()];
  } else if (scope === "school") {
    const { data: me } = await db.from("users").select("school_name").eq("id", meId).maybeSingle();
    if (!me?.school_name) throw fail("Add your school in Settings to join your school's league.");
    const { data } = await db.from("users").select("id").ilike("school_name", me.school_name).limit(2000);
    ids = (data || []).map((r) => r.id);
  } else if (scope === "subject" && subject) {
    const { data } = await db.from("user_agents").select("user_id").contains("subjects", [subject]).limit(2000);
    ids = [meId, ...(data || []).map((r) => r.user_id)];
  } else if (scope === "exam" && exam) {
    const { data } = await db.from("user_agents").select("user_id").ilike("exam_board", `%${exam}%`).limit(2000);
    ids = [meId, ...(data || []).map((r) => r.user_id)];
  }
  let q = db.from("xp_ledger").select("user_id, amount").gte("created_at", since).limit(20000);
  if (ids) q = q.in("user_id", [...new Set(ids)].slice(0, 1000));
  const { data: rows } = await q;
  const totals = new Map();
  for (const r of rows || []) totals.set(r.user_id, (totals.get(r.user_id) || 0) + (Number(r.amount) || 0));
  // Learners who opted out of leaderboards are left out (but still see their own place).
  const optedOut = new Set(((await edu().from("agent_network_settings").select("user_id").eq("show_on_leaderboards", false).limit(5000)).data || []).map((r) => r.user_id));
  const ranked = [...totals.entries()].filter(([id]) => id === meId || !optedOut.has(id)).sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 20);
  const { data: users } = top.length ? await db.from("users").select("id, full_name, username, avatar_url").in("id", top.map(([id]) => id)) : { data: [] };
  const { data: agents } = top.length ? await db.from("user_agents").select("user_id, agent_name, agent_emoji").in("user_id", top.map(([id]) => id)) : { data: [] };
  const U = new Map((users || []).map((u) => [u.id, u])), A = new Map((agents || []).map((a) => [a.user_id, a]));
  const myIdx = ranked.findIndex(([id]) => id === meId);
  return {
    scope, weekStarting: since, players: ranked.length,
    top: top.map(([id, xp], i) => ({ rank: i + 1, name: first(U.get(id)?.full_name, U.get(id)?.username), avatar: U.get(id)?.avatar_url || null, agent: `${A.get(id)?.agent_emoji || "🤖"} ${A.get(id)?.agent_name || ""}`.trim(), xp, you: id === meId })),
    me: myIdx >= 0 ? { rank: myIdx + 1, xp: ranked[myIdx][1] } : { rank: null, xp: 0 },
  };
}
