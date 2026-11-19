/**
 * battle/service-listings.js — everything that lists battles for a person or
 * a scope: my battles, my challenges, a battle's participants, course/open
 * listings, the session scope, the log, and the recurring-series actions.
 */
import { toCard } from "./card.js";
import { agentNetworkHooks } from "../../lib/agentNetworkHooks.js";
import { skipOne, optOut, endSeries, seriesCards } from "./series.js";
import { res200, res403, now } from "./service-core.js";
import { expiresInSeconds } from "./rules.js";
import { battles, seats, questions, people } from "./store.js";

// ─── MY BATTLES / MY CHALLENGES ──────────────────────────────────────────────

// GET /api/battle/my-battles — every battle I take part in or created
export async function myBattles(req, res) {
  // ── Which battles are mine, and what is my seat in each? ────────────────
  //
  // Query BATTLES and filter on the embedded seat, not the other way round.
  // Three shapes were tried before this one worked:
  //   · `id.in.(<every battle id>)` — ~15KB of uuids in the query string at 410
  //     battles, and the request 500'd outright
  //   · the same list sliced to 300 — hid whichever battles fell outside the
  //     slice, including the one just created, since seat rows come back in no
  //     particular order
  //   · selecting FROM battle_participants and ordering by battles.created_at —
  //     PostgREST cannot order a result by an embedded table's column, so the
  //     rows came back unordered and the limit cut arbitrary ones
  //
  // Ordering happens on battles, which is the table being limited, so this
  // stays bounded and correct however long a learner's history gets.
  const PAGE = 100;
  const [seated, created] = await Promise.all([
    battles.seatedBattlesOfUser(req.user.id, PAGE),
    battles.createdBattlesOfUser(req.user.id, PAGE),
  ]);
  if (seated.error)  throw new Error(seated.error.message);
  if (created.error) throw new Error(created.error.message);

  // My own seat, not just the fact that I have one: a battle I have been
  // invited to but not answered belongs in Challenges, not Battles › Active,
  // and the two lists had no way to tell those apart.
  const mySeat = new Map();
  const byId   = new Map();
  for (const b of (seated.data ?? [])) {
    const seat = (b.battle_participants ?? []).find((p) => p.user_id === req.user.id);
    if (seat) mySeat.set(b.id, seat);
    delete b.battle_participants;          // the embed is plumbing, not card data
    byId.set(b.id, b);
  }
  for (const b of (created.data ?? [])) byId.set(b.id, b);

  const data = [...byId.values()]
    .sort((x, y) => new Date(y.created_at) - new Date(x.created_at))
    .slice(0, PAGE);

  // A finished battle's card wants to say who won and by what. toCard never
  // carried any of it, so the learner app rendered its result line from three
  // undefined fields: "undefined won · undefined–undefined". Load the finished
  // ones' participants — one query for all of them — and attach the result.
  const finished = (data ?? []).filter((b) => b.status === "completed").map((b) => b.id);
  const resultByBattle = new Map();
  if (finished.length) {
    const { data: rows } = await seats.finishedResultRows(finished);
    for (const r of (rows ?? [])) {
      if (r.role === "teacher") continue;                 // the host is not a result
      const list = resultByBattle.get(r.battle_id) ?? [];
      list.push(r);
      resultByBattle.set(r.battle_id, list);
    }
  }

  // Who is in each battle, by AGENT — the card reads "Bolt vs Nova" for a
  // 1v1 and "Bolt vs your agent and 23 more" for a group. It used to read
  // "vs <creator's name>", which named a person, and named ME on a battle I
  // had created. One query for every listed battle.
  const lineupOf = new Map();
  const ids = (data ?? []).map((b) => b.id);
  if (ids.length) {
    const { data: seatRows } = await seats.lineupRows(ids);
    for (const r of (seatRows ?? [])) {
      if (r.role === "teacher" || r.declined_at) continue;
      const l = lineupOf.get(r.battle_id) ?? [];
      l.push(r);
      lineupOf.set(r.battle_id, l);
    }
  }
  const lineup = (b) => {
    const seatsIn = lineupOf.get(b.id) ?? [];
    const me = seatsIn.find((s) => s.user_id === req.user.id);
    const others = seatsIn.filter((s) => s.user_id !== req.user.id);
    // "Agent 1": the creator's agent when that isn't me, else whoever said yes first.
    const lead = others.find((s) => s.user_id === b.created_by)
      ?? others.filter((s) => s.joined_at).sort((x, y) => new Date(x.joined_at) - new Date(y.joined_at))[0]
      ?? others[0];
    const agent = (s) => s && {
      name:  s.user_agents?.agent_name ?? "Agent",
      emoji: s.user_agents?.agent_emoji ?? null,
      color: s.user_agents?.agent_color ?? null,
      bg:    s.user_agents?.agent_bg ?? null,
      score: s.score ?? 0,
    };
    return {
      myAgent:   me?.user_agents?.agent_name ?? null,
      leadAgent: lead?.user_agents?.agent_name ?? null,
      me:        agent(me),
      lead:      agent(lead),
      iCreated:  b.created_by === req.user.id,
      others:    others.length,               // everyone but me
      total:     seatsIn.length,
    };
  };

  // The daily battle ranks the whole day (every heat of that subject), not the
  // one heat a learner sat in, and leaves knocked-out agents out.
  const dailyPlaceOf = new Map();
  const dailyDone = (data ?? []).filter((b) => b.status === "completed" && String(b.recurring_key || "").startsWith("daily:"));
  if (dailyDone.length) {
    const { dailyRanking } = agentNetworkHooks();
    const seen = new Map();
    for (const b of dailyDone.slice(0, 14)) {
      const [, day, , ] = String(b.recurring_key).split(":");
      const k = `${day}|${b.subject}`;
      if (!seen.has(k)) seen.set(k, await dailyRanking(req.user.id, b.subject, day).catch(() => null));
      const r = seen.get(k);
      if (r) dailyPlaceOf.set(b.id, r.me ? { rank: r.me.rank, of: r.me.of } : { rank: null, of: r.players });
    }
  }

  res200(res, (data ?? []).map((b) => {
    const seat = mySeat.get(b.id);
    const card = {
      ...toCard(b, { mine: b.created_by === req.user.id, lineup: lineup(b) }),
      // 'accepted' | 'declined' | 'invited' | null (not in it — I created it)
      myState: !seat ? null
             : seat.declined_at ? "declined"
             : seat.joined_at   ? "accepted"
             : "invited",
      myRole: seat?.role ?? null,
    };
    const players = resultByBattle.get(b.id);
    if (!players?.length) return card;

    const asAgent = (p) => p && {
      id:    p.user_id,
      name:  p.user_agents?.agent_name ?? "Agent",
      emoji: p.user_agents?.agent_emoji ?? "🤖",
      color: p.user_agents?.agent_color ?? null,
      score: p.score ?? 0,
      isYou: p.user_id === req.user.id,
    };
    const mine = players.find((p) => p.user_id === req.user.id);

    return {
      ...card,
      agentA: asAgent(players[0]),
      agentB: asAgent(players[1]),
      winner: players.find((p) => p.is_winner)?.user_id ?? null,
      // A review has no winner — what it has is a mark. The card needs to be
      // able to tell the difference rather than announcing a champion.
      review: b.battle_type === "review" && mine
        ? { correct: mine.correct_answers ?? 0, total: b.total_questions ?? 0 }
        : null,
      myScore:    mine?.score ?? null,
      myRank:     mine?.final_rank ?? null,
      // 0 = knocked out: watched the rest as a spectator, unranked.
      myHp:       mine?.hp ?? null,
      myXpEarned: mine?.xp_earned ?? 0,
      ...(dailyPlaceOf.has(b.id) ? { dailyPlace: dailyPlaceOf.get(b.id) } : {}),
    };
  }));
}

/**
 * GET /api/battle/my-challenges — every invitation waiting on me.
 *
 * This used to read role='opponent' only, i.e. 1v1 duels. A battle a teacher
 * set for the class entered the learner automatically and appeared nowhere they
 * could act on it — the Challenges tab stayed empty while a battle they had
 * never agreed to ran without them. A teacher's battle is now an invitation
 * like any other, so anyone with an unanswered seat belongs in this list.
 */
export async function myChallenges(req, res) {
  // Filtered on the EMBEDDED seat, not by collecting ids and asking for them.
  //
  // The previous version read every seat this user has ever held, kept the
  // unanswered ones, and passed them back as `id.in.(...)`. A learner with a
  // few hundred battles behind them produced a fifteen-kilobyte URL, the
  // request failed, and — because the result was destructured without checking
  // for an error — the endpoint answered 200 with an empty list. Their
  // Challenges tab was permanently empty and nothing anywhere said why. This is
  // the third time this shape has bitten: /my-battles had exactly the same bug.
  const { data, error } = await battles.pendingChallengesOfUser(req.user.id, now());

  // Loudly. Answering 200 with [] when the query failed is what made the last
  // one invisible for so long.
  if (error) throw new Error(`my-challenges: ${error.message}`);

  // The scope's name for the card ("Class · JSS1-2", "Course · Biology 101"),
  // and whether a teacher set it (a teacher hosts; the card says so).
  const rows = data ?? [];
  const courseIds = [...new Set(rows.map((b) => b.course_id).filter(Boolean))];
  const classIds  = [...new Set(rows.map((b) => b.classroom_id).filter(Boolean))];
  const [{ data: courses }, { data: classes }] = await Promise.all([
    people.coursesByIds(courseIds),
    people.classroomsByIds(classIds),
  ]);
  const courseName = new Map((courses ?? []).map((c) => [c.id, c.title]));
  const className  = new Map((classes ?? []).map((c) => [c.id, c.name]));
  // An activity's review battle is platform-made (no creator): the card names the teacher who set it.
  const setBy = [...new Set(rows.filter((b) => !b.created_by && b.review_host === "teacher" && b.requested_by).map((b) => b.requested_by))];
  const { data: setters } = await people.usersByIds(setBy, "id, full_name, avatar_url, role");
  const setter = new Map((setters ?? []).map((u) => [u.id, u]));
  for (const b of rows) if (!b.created_by && setter.has(b.requested_by)) b.users = setter.get(b.requested_by);
  // One card per recurring series I'm in or set (its occurrences are in my Battles tab).
  const series = await seriesCards(req.user.id).catch((e) => { console.warn("[my-challenges] series:", e.message); return []; });
  res200(res, [...rows.map((b) => toCard(b, {
    scopeName: b.course_id ? courseName.get(b.course_id) ?? null : b.classroom_id ? className.get(b.classroom_id) ?? null : null,
    hostRole:  b.users?.role === "instructor" || b.users?.role === "teacher" ? "teacher" : (b.users?.role || null),
  })), ...series]);
}

/**
 * GET /api/battle/battles/:id/participants
 *
 * Who was invited, who accepted, who declined, who hasn't answered — and, once
 * it has run, how they did. The same question the Self Study drawer answers,
 * which a teacher could not ask of a battle at all: the Battles page showed a
 * count and nothing else, so "did my class actually take this?" had no answer.
 *
 * Readable by the creator and by anyone taking part. A learner seeing who else
 * is in their own battle is the roster they already see when it starts.
 */
export async function battleParticipants(req, res) {
  const { battleId } = req.params;
  const { data: battle } = await battles.battleParticipantsHeader(battleId);
  if (!battle) return res.status(404).json({ success: false, error: "Battle not found" });

  const { data: rows } = await seats.seatRows(battleId);

  const mine = battle.created_by === req.user.id
    || (rows ?? []).some((r) => r.user_id === req.user.id);
  if (!mine) return res403(res, "Not your battle");

  const ids = (rows ?? []).map((r) => r.user_id);
  const { data: users } = await people.usersByIds(ids, "id, full_name, username, avatar_url, avatar_emoji");
  const byId = new Map((users ?? []).map((u) => [u.id, u]));

  const peopleRows = (rows ?? []).map((r) => {
    const u = byId.get(r.user_id);
    return {
      userId:    r.user_id,
      fullName:  u?.full_name ?? "Unknown",
      username:  u?.username ?? null,
      avatar:    u?.avatar_url ?? null,
      emoji:     u?.avatar_emoji ?? null,
      role:      r.role,
      // One word for the UI, so it doesn't have to re-derive this from two
      // nullable timestamps and get it subtly different on each page.
      state:     r.declined_at ? "declined" : (r.joined_at ? "accepted" : "invited"),
      joinedAt:  r.joined_at ?? null,
      declinedAt: r.declined_at ?? null,
      score:     r.score ?? 0,
      correct:   r.correct_answers ?? 0,
      wrong:     r.wrong_answers ?? 0,
      isWinner:  !!r.is_winner,
      rank:      r.final_rank ?? null,
      xpEarned:  r.xp_earned ?? 0,
    };
  });

  // The teacher/creator is running it, not competing for a place in it.
  const learners = peopleRows.filter((p) => p.role !== "teacher");
  res200(res, {
    battleId, title: battle.title, status: battle.status,
    participants: peopleRows.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.score - a.score),
    summary: {
      invited:  learners.length,
      accepted: learners.filter((p) => p.state === "accepted").length,
      declined: learners.filter((p) => p.state === "declined").length,
      pending:  learners.filter((p) => p.state === "invited").length,
    },
  });
}

// ─── course / open / session listings ────────────────────────────────────────

export async function courseChallenges(req, res) {
  const { data } = await battles.courseChallenges(req.params.courseId, now());
  res.json({ challenges: data ?? [] });
}

export async function challengeDetail(req, res) {
  const { data } = await battles.challengeForDetail(req.params.challengeId);
  if (!data) return res.status(404).json({ error: "Challenge not found" });
  // null = no deadline, NOT "expired 56 years ago" — which is what
  // new Date(null) would have made of it.
  const expiresIn = expiresInSeconds(data.expires_at);
  res.json({ battle: data, expires_in_seconds: expiresIn });
}

export async function openBattleLobby(req, res) {
  const { data: rows } = await battles.openBattlesOfCourse(req.params.courseId, now());

  const enriched = await Promise.all((rows ?? []).map(async (r) => {
    const { data: joined } = await seats.seatUserId(r.id, req.user.id);
    const { count } = await seats.seatCount(r.id);
    return { ...r, already_joined: !!joined, current_participants: count ?? 0, spots_left: r.max_participants - (count ?? 0) };
  }));

  res.json({ open_battles: enriched });
}

export async function courseBattles(req, res) {
  const { status, type } = req.query;
  const { data: battlesRows } = await battles.battlesOfCourse(req.params.courseId, { status, type });

  const enriched = await Promise.all((battlesRows ?? []).map(async (b) => {
    const { data: p } = await seats.roleOfSeat(b.id, req.user.id);
    return { ...b, my_role: p?.role ?? null };
  }));
  res.json({ battles: enriched });
}

export async function sessionBattles(req, res) {
  const { data, error } = await battles.sessionBattlesOfCourse(req.params.courseId, req.params.sessionId);
  if (error) throw new Error(error.message);
  res200(res, data ?? []);
}

export async function battleLog(req, res) {
  const { since } = req.query;
  const { data } = await questions.battleLog(req.params.battleId, since);
  res.json({ logs: data ?? [], count: data?.length ?? 0 });
}

// ─── RECURRING SERIES (battle/series.js) ─────────────────────────────────────
// Skip one occurrence (the next, or `at`), opt out of the series, or (the
// creator) end it.
const seriesAction = (fn) => async (req, res) => {
  try {
    res200(res, await fn(req));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ success: false, error: e.message });
    throw e;
  }
};

export const skipSeriesOccurrence = seriesAction((req) => skipOne(req.params.seriesId, req.user.id, req.body?.at || null));
export const optOutOfSeries = seriesAction((req) => optOut(req.params.seriesId, req.user.id));
export const endRecurringSeries = seriesAction((req) => endSeries(req.params.seriesId, req.user.id));

