/**
 * battle/series.js — recurring battles (reference/Akoro Battles — Model.md).
 *
 * A teacher or a student sets a class or course battle to repeat on days of
 * the week at a time, until an end date and time (rules: seriesCore.js).
 *
 *   createSeries(...)        the invite routes call this instead of making a
 *                            battle when the body carries `repeat`; who is in
 *                            it was already checked there.
 *   runOccurrence(id, at)    the battle worker's "series-occurrence" job, an
 *                            hour before each start. It makes that start's
 *                            battle by running the SAME invite route (so every
 *                            check, the questions and the start job are the
 *                            ones a one-off battle gets), with everyone in the
 *                            series already in, then queues the next one.
 *                            The wait between occurrences is a Postgres row
 *                            (lib/deferredJobs.js), so a series costs no Redis.
 *   skipOne / optOut / end   a member sits one out or leaves; the creator ends it.
 *   seriesCards(userId)      the Challenges tab's one card per series.
 */
import db from "../../db.js";
import { addLater, cancelLater } from "../../lib/deferredJobs.js";
import { entryCheck } from "./entry.js";
import { SERIES, cleanRepeat, nextOccurrence, makeAt, leadOf, occurrenceJobId, playersFor, ruleText, seriesCardType } from "./seriesCore.js";

const series = () => db.from("battle_series");
const members = () => db.from("battle_series_members");
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const ruleOf = (s) => ({ days: s.days, time: s.at_time, tz: s.tz, until: s.until });

async function queue() {
  const { battleQueue } = await import("./worker.js");
  return battleQueue;
}

async function notify(userId, title, content, relatedId) {
  await db.from("notifications").insert({ user_id: userId, type: "battle_series", title, content, related_id: relatedId });
  global.io?.to(`user:${userId}`).emit("notification", { type: "battle_series", title, content, relatedId });
}

/** Queue the occurrence after `afterMs`, or end the series when there is none. → next start (ms) | null */
async function scheduleNext(s, afterMs) {
  const next = nextOccurrence(ruleOf(s), afterMs);
  if (next == null) {
    await series().update({ status: "ended", ended_at: new Date().toISOString(), next_at: null }).eq("id", s.id);
    return null;
  }
  await series().update({ next_at: new Date(next).toISOString() }).eq("id", s.id);
  await addLater(await queue(), "series-occurrence", { action: "series-occurrence", seriesId: s.id, startMs: next },
    { delay: Math.max(0, makeAt(next, Date.now(), leadOf(s)) - Date.now()), jobId: occurrenceJobId(s.id, next) });
  return next;
}

/** A new series. memberIds are the invitees the route already checked. → { id, nextAt } */
export async function createSeries({ creatorId, scope, classroomId = null, courseId = null, template, repeat, memberIds }) {
  const rule = cleanRepeat(repeat);
  const first = nextOccurrence(rule, Date.now());
  if (first == null) throw fail("No day in that range falls before the end date. Move the end date later.");
  const { data: s, error } = await series().insert({
    created_by: creatorId, scope, classroom_id: classroomId, course_id: courseId, template,
    days: rule.days, at_time: rule.time, tz: rule.tz, until: rule.until,
  }).select().single();
  if (error) throw new Error(`could not save the series: ${error.message}`);
  if (memberIds.length) {
    const { error: mErr } = await members().insert(memberIds.map((user_id) => ({ series_id: s.id, user_id })));
    if (mErr) { await series().delete().eq("id", s.id); throw new Error(`could not save the series: ${mErr.message}`); }
  }
  const nextAt = await scheduleNext(s, Date.now());

  const { data: me } = await db.from("users").select("full_name").eq("id", creatorId).maybeSingle();
  for (const uid of memberIds) {
    await notify(uid, `${me?.full_name ?? "Someone"} added you to a recurring battle: ${template.title}`,
      `${ruleText(rule)}. You're in every one; skip one or opt out from your Challenges tab.`, s.id);
  }
  return { id: s.id, nextAt: nextAt ? new Date(nextAt).toISOString() : null, rule };
}

/** Run an invite route handler in-process. → { status, body } */
export async function callRoute(handler, req) {
  const out = { status: 200, body: null };
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  await handler(req, res);
  return out;
}

/** The worker's job: make the battle that starts at startMs, then queue the next. */
export async function runOccurrence(seriesId, startMs) {
  const { data: s } = await series().select("*").eq("id", seriesId).maybeSingle();
  if (!s || s.status !== "active") return { skipped: "series not active" };
  const startIso = new Date(startMs).toISOString();
  const note = async (text) => {
    await series().update({ last_note: text }).eq("id", s.id);
    await notify(s.created_by, `${s.template?.title ?? "Your recurring battle"}: skipped`, text, s.id);
  };
  const finish = async (result) => ({ ...result, next: await scheduleNext(s, startMs) });

  // Released twice (a retry, a duplicate row): the battle is already there.
  const t = s.template || {};
  if (t.post) {
    const { data: posted } = await db.schema("edu").from("challenge_requests").select("id").eq("series_id", s.id).eq("scheduled_for", startIso).limit(1);
    if (posted?.length) return finish({ requestId: posted[0].id, existed: true });
  } else {
    const { data: made } = await db.from("battles").select("id").eq("series_id", s.id).eq("scheduled_start", startIso).limit(1);
    if (made?.length) return finish({ battleId: made[0].id, existed: true });
  }

  // The previous one still running: this one is skipped, and says so.
  if (s.last_battle_id) {
    const { data: prev } = await db.from("battles").select("status").eq("id", s.last_battle_id).maybeSingle();
    if (prev?.status === "live") {
      await note(`The ${startIso.slice(0, 16).replace("T", " ")} one was skipped: the previous one was still running.`);
      return finish({ skipped: "previous still running" });
    }
  }

  // Everyone in, less who opted out or skips this one; entry checked per occurrence.
  const { data: rows } = await members().select("user_id, opted_out_at, skips").eq("series_id", s.id);
  const players = [];
  for (const uid of playersFor(rows, startMs)) {
    const entry = await entryCheck(uid, { battle_type: "battle", total_questions: t.total_questions ?? 15, min_xp: t.min_xp ?? 0 });
    if (entry.ok) players.push(uid);
    else await notify(uid, `You're sitting out ${t.title ?? "a recurring battle"}`, entry.message, s.id);
  }

  const { data: creator } = await db.from("users").select("id, role").eq("id", s.created_by).maybeSingle();
  if (!creator) return { skipped: "creator gone" };
  const when = startIso.slice(0, 16).replace("T", " ");

  // The agent network: an open post goes up again, or the invite is made with everyone already in.
  if (s.scope === "network") {
    try {
      if (t.post) {
        const { postChallengeRequest } = await import("../agent-network/challenges.js");
        const { post: _post, teams: _teams, ...input } = t;
        const r = await postChallengeRequest(s.created_by, { ...input, scheduled_for: startIso }, { seriesId: s.id });
        await series().update({ last_note: null }).eq("id", s.id);
        return finish({ requestId: r.id });
      }
      const { createNetworkBattle } = await import("./networkBattle.js");
      const b = await createNetworkBattle({ creatorId: s.created_by, opponents: players, joined: players, teams: t.teams || {},
        options: { ...t, scheduled_for: startIso }, source: "series", seriesId: s.id });
      await series().update({ last_battle_id: b.battleId, last_note: null }).eq("id", s.id);
      return finish({ battleId: b.battleId });
    } catch (e) {
      if (!e.status) console.warn("[series] network occurrence failed:", e.message);
      await note(`The ${when} one was skipped: ${e.message}`);
      return finish({ skipped: e.message });
    }
  }
  const { occurrenceHandlers } = await import("./routes.js");
  const handler = s.scope === "class" ? occurrenceHandlers.classInvite : occurrenceHandlers.courseInvite;
  const out = await callRoute(handler, {
    user: { id: creator.id, role: creator.role },
    params: s.scope === "class" ? { classroomId: s.classroom_id } : { courseId: s.course_id },
    body: { ...t, user_ids: players, scheduled_for: startIso },
    series: { id: s.id, startMs, tz: s.tz },
    app: { get: () => global.io },
  }).catch((e) => ({ status: 500, body: { error: e.message } }));

  if (out.status !== 201) {
    await note(`The ${when} one was skipped: ${out.body?.error ?? "it could not be set up"}.`);
    return finish({ skipped: out.body?.error ?? `status ${out.status}` });
  }
  const battleId = out.body?.data?.battle_id;
  await series().update({ last_battle_id: battleId, last_note: null }).eq("id", s.id);
  return finish({ battleId });
}

/** Occurrences made but not begun, soonest first. → [{ id, scheduled_start }] */
async function upcomingBattles(seriesIds) {
  if (!seriesIds.length) return [];
  const { data } = await db.from("battles").select("id, series_id, scheduled_start").in("series_id", seriesIds)
    .in("status", ["lobby", "scheduled"]).gt("scheduled_start", new Date().toISOString()).order("scheduled_start");
  return data || [];
}

/** The soonest start not yet begun: an occurrence already made (its battle exists), else the next one queued. */
function soonest(s, upcoming) {
  const made = upcoming.find((b) => b.series_id === s.id);
  if (made) return { at: new Date(made.scheduled_start).toISOString(), battleId: made.id };
  return { at: s.next_at ? new Date(s.next_at).toISOString() : null, battleId: null };
}

/** The battle of this series at startMs, if it was made already. */
async function occurrenceAt(seriesId, startIso) {
  const { data } = await db.from("battles").select("id, status").eq("series_id", seriesId)
    .eq("scheduled_start", startIso).in("status", ["lobby", "scheduled"]).maybeSingle();
  return data;
}

/** A member sits one occurrence out (the next one by default). */
export async function skipOne(seriesId, userId, at = null) {
  const { data: m } = await members().select("*").eq("series_id", seriesId).eq("user_id", userId).maybeSingle();
  if (!m) throw fail("You're not in this series.", 404);
  const { data: s } = await series().select("*").eq("id", seriesId).maybeSingle();
  if (!s || s.status !== "active") throw fail("This series has ended.", 410);
  const startIso = at ? new Date(at).toISOString() : soonest(s, await upcomingBattles([s.id])).at;
  if (!startIso) throw fail("There is no occurrence left to skip.", 410);
  const battle = await occurrenceAt(seriesId, startIso);
  if (battle) {
    // Already made: an ordinary decline of that one battle's seat.
    const { occurrenceHandlers } = await import("./routes.js");
    await callRoute(occurrenceHandlers.declineChallenge, { user: { id: userId }, params: { challengeId: battle.id }, body: {}, app: { get: () => global.io } });
  }
  const skips = [...new Set([...(m.skips || []).map((x) => new Date(x).toISOString()), startIso])];
  await members().update({ skips }).eq("series_id", seriesId).eq("user_id", userId);
  return { skipped: startIso };
}

/** A member leaves the series (and the upcoming occurrence, if it is made). */
export async function optOut(seriesId, userId) {
  const { data: m } = await members().select("user_id").eq("series_id", seriesId).eq("user_id", userId).maybeSingle();
  if (!m) throw fail("You're not in this series.", 404);
  await members().update({ opted_out_at: new Date().toISOString() }).eq("series_id", seriesId).eq("user_id", userId);
  const { occurrenceHandlers } = await import("./routes.js");
  for (const b of await upcomingBattles([seriesId])) {
    await callRoute(occurrenceHandlers.declineChallenge, { user: { id: userId }, params: { challengeId: b.id }, body: {}, app: { get: () => global.io } });
  }
  return { optedOut: true };
}

/** The creator ends the series: no more occurrences; one made but not started is cancelled. */
export async function endSeries(seriesId, userId) {
  const { data: s } = await series().select("*").eq("id", seriesId).maybeSingle();
  if (!s || s.created_by !== userId) throw fail("Only whoever set the series can end it.", 403);
  if (s.status === "ended") return { ended: true, already: true };
  await series().update({ status: "ended", ended_at: new Date().toISOString(), next_at: null }).eq("id", seriesId);
  if (s.next_at) await cancelLater(await queue(), occurrenceJobId(seriesId, new Date(s.next_at).getTime()));
  const { data: upcoming } = await db.from("battles").update({ status: "cancelled" })
    .eq("series_id", seriesId).in("status", ["lobby", "scheduled"]).select("id");
  if (s.template?.post) {
    await db.schema("edu").from("challenge_requests").update({ status: "cancelled" }).eq("series_id", seriesId).eq("status", "open");
  }
  return { ended: true, cancelled: (upcoming || []).length };
}

/** One Challenges-tab card per active series this user is in or set. */
export async function seriesCards(userId) {
  const { data: mine } = await members().select("series_id, skips").eq("user_id", userId).is("opted_out_at", null);
  const memberOf = new Map((mine || []).map((m) => [m.series_id, m]));
  const [{ data: joined }, { data: created }] = await Promise.all([
    memberOf.size ? series().select("*").in("id", [...memberOf.keys()]).eq("status", "active") : { data: [] },
    series().select("*").eq("created_by", userId).eq("status", "active"),
  ]);
  const all = [...new Map([...(joined || []), ...(created || [])].map((s) => [s.id, s])).values()];
  if (!all.length) return [];
  const creatorIds = [...new Set(all.map((s) => s.created_by))];
  const courseIds = [...new Set(all.map((s) => s.course_id).filter(Boolean))];
  const classIds = [...new Set(all.map((s) => s.classroom_id).filter(Boolean))];
  const [{ data: users }, { data: courses }, { data: classes }, { data: counts }, upcoming] = await Promise.all([
    db.from("users").select("id, full_name, avatar_url, role").in("id", creatorIds),
    courseIds.length ? db.from("courses").select("id, title").in("id", courseIds) : { data: [] },
    classIds.length ? db.from("classrooms").select("id, name").in("id", classIds) : { data: [] },
    members().select("series_id").in("series_id", all.map((s) => s.id)).is("opted_out_at", null),
    upcomingBattles(all.map((s) => s.id)),
  ]);
  const userById = new Map((users || []).map((u) => [u.id, u]));
  const nameOf = new Map([...(courses || []).map((c) => [c.id, c.title]), ...(classes || []).map((c) => [c.id, c.name])]);
  const inCount = new Map();
  for (const c of counts || []) inCount.set(c.series_id, (inCount.get(c.series_id) || 0) + 1);

  return all.map((s) => {
    const t = s.template || {};
    const u = userById.get(s.created_by);
    const isMine = s.created_by === userId;
    const skips = (memberOf.get(s.id)?.skips || []).map((x) => new Date(x).toISOString());
    const { at: next, battleId: nextBattleId } = soonest(s, upcoming);
    const players = (inCount.get(s.id) || 0) + 1;
    return {
      id: `series-${s.id}`,
      seriesId: s.id,
      title: t.title ?? "Recurring battle",
      subject: t.subject ?? null,
      topic: t.topic ?? null,
      type: seriesCardType(s, players, u?.role === "instructor" || u?.role === "teacher"),
      // An open post repeats for anyone to take; nobody is "in" it until they take a seat.
      post: !!t.post,
      kind: t.kind ?? null,
      scope: s.scope,
      scopeName: nameOf.get(s.course_id || s.classroom_id) ?? null,
      courseId: s.course_id, classroomId: s.classroom_id,
      series: { days: s.days, time: s.at_time, tz: s.tz, until: s.until },
      autoJoined: true,
      mine: isMine,
      nextAt: next,
      nextBattleId,
      scheduledFor: next,
      skippingNext: !!next && skips.includes(next),
      lastNote: isMine ? s.last_note : null,
      players,
      totalQuestions: t.total_questions ?? 15,
      durationMin: Math.round((t.time_limit_seconds ?? 900) / 60),
      xpPrize: `+${t.xp_prize ?? 200} XP`,
      challenger: isMine ? "You" : u?.full_name ?? null,
      avatar: u?.avatar_url ?? null,
      hostRole: u?.role === "instructor" || u?.role === "teacher" ? "teacher" : (u?.role || null),
      createdBy: s.created_by,
    };
  });
}

export { SERIES };
