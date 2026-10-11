/**
 * battle/networkBattle.js — a battle between agents found anywhere on the
 * network (search, a challenge request, a rematch, a revision circle), not
 * only inside one course or class. Same tables and the same invitation flow
 * as class battles: the creator is in, everyone else gets an invitation they
 * accept or decline (POST /api/battle/challenges/:id/accept), questions come
 * from the past-papers bank and AI (buildQuestions), and the worker runs it.
 *
 *   kind   1v1    two agents; accepting starts it (or waits for its time)
 *          group  3–8 agents, XP pool shared by rank (battle_type 'classroom')
 *          team   2v2: teams A and B, the higher team total wins (battle_type 'team')
 *
 * `joined` lists players who already said yes (a challenge request's
 * accepters, a revision circle's members): they get a seat, not an invitation.
 */
import db from "../../db.js";
import { buildQuestions } from "./questionSource.js";
import { notifyUser } from "../notify.js";
import { InsufficientCoins } from "../../lib/coins.js";
import { cleanHpPerMiss } from "./hp.js";
import { entryCheck } from "./entry.js";
import { toCard } from "./card.js";

const IDLE_HOURS = Math.max(1, Number(process.env.BATTLE_IDLE_HOURS ?? 48) || 48);

const now = () => new Date().toISOString();
const EXPIRE_AFTER_START_MS = 10_000;
export const NETWORK_LIMITS = Object.freeze({ MIN_Q: 5, MAX_Q: 30, MAX_GROUP: 8, MAX_DAYS_AHEAD: 30, PER_DAY: 15 });

let _q = null;
const queue = async () => (_q ||= (await import("./worker.js")).battleQueue);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** Validate what a network battle needs; → clean options. */
export function cleanBattleOptions(o = {}) {
  const kind = ["1v1", "group", "team"].includes(o.kind) ? o.kind : "1v1";
  const subject = String(o.subject || "").trim().slice(0, 60);
  if (!subject) throw fail("Which subject is the battle on?");
  const total = Math.min(NETWORK_LIMITS.MAX_Q, Math.max(NETWORK_LIMITS.MIN_Q, Math.round(Number(o.total_questions ?? o.total) || 10)));
  let scheduledFor = null;
  if (o.scheduled_for) {
    const t = new Date(o.scheduled_for);
    if (Number.isNaN(t.getTime())) throw fail("That start time couldn't be read — say the day and time again.");
    if (t.getTime() < Date.now() + 60_000) throw fail("That start time has passed — pick a later one, or start now.");
    if (t.getTime() > Date.now() + NETWORK_LIMITS.MAX_DAYS_AHEAD * 86400_000) throw fail("Battles can be scheduled up to 30 days ahead.");
    scheduledFor = t.toISOString();
  }
  return {
    kind, subject, total, scheduledFor,
    topic: o.topic ? String(o.topic).trim().slice(0, 120) : null,
    difficulty: ["easy", "intermediate", "hard"].includes(o.difficulty) ? o.difficulty : "intermediate",
    title: String(o.title || "").trim().slice(0, 120) || `${subject}${o.topic ? ` — ${String(o.topic).slice(0, 60)}` : ""} ${kind === "team" ? "team battle" : "battle"}`,
    xp: Math.min(500, Math.max(50, Math.round(Number(o.xp_prize) || (kind === "1v1" ? 150 : 200)))),
    secondsPerQuestion: Math.min(60, Math.max(10, Math.round(Number(o.seconds_per_question) || 20))),
    hpPerMiss: cleanHpPerMiss(o.hp_per_miss),
    minXp: Math.max(0, Math.round(Number(o.min_xp) || 0)),
  };
}

/** How many players each kind takes. */
export function seatsFor(kind, opponents, joined = []) {
  const n = 1 + opponents.length + joined.length;
  if (kind === "1v1" && n !== 2) throw fail("A 1v1 is you and one other agent.");
  if (kind === "team" && n !== 4) throw fail("A team battle is 2v2 — four agents in all.");
  if (kind === "group" && (n < 3 || n > NETWORK_LIMITS.MAX_GROUP)) throw fail(`A group battle takes 3 to ${NETWORK_LIMITS.MAX_GROUP} agents.`);
  return n;
}

/** Teams A/B: the creator's side first, then alternating (or as given). */
export function assignTeams(creatorId, others, given = {}) {
  const out = { [creatorId]: "A" };
  let a = 1, b = 0;
  for (const id of others) {
    const want = given[id] === "A" || given[id] === "B" ? given[id] : null;
    const team = want && (want === "A" ? a < 2 : b < 2) ? want : a <= b ? "A" : "B";
    out[id] = team; team === "A" ? a++ : b++;
  }
  return out;
}

/**
 * Create the battle and send the invitations.
 * → { battleId, status, invited: [userIds], joined: [userIds], placed }
 */
export async function createNetworkBattle({ creatorId, opponents = [], joined = [], teams = {}, options, startNowIfReady = false, source = "challenge" }) {
  const o = cleanBattleOptions(options);
  const others = [...new Set([...opponents, ...joined])].filter((id) => id && id !== creatorId);
  seatsFor(o.kind, opponents.filter((id) => !joined.includes(id)), joined);

  // Daily cap per creator (question generation costs).
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from("battles").select("id", { count: "exact", head: true })
    .eq("created_by", creatorId).is("course_id", null).is("classroom_id", null).gte("created_at", dayStart.toISOString());
  if ((count ?? 0) >= NETWORK_LIMITS.PER_DAY) throw fail(`You've started ${NETWORK_LIMITS.PER_DAY} battles today — that's the daily limit.`, 429);

  // The creator plays too: they need the coins for their own agent's answers.
  const ce = await entryCheck(creatorId, { battle_type: "battle", total_questions: o.total, min_xp: 0 });
  if (!ce.ok) {
    // Started by someone else's yes (a request accepted, a circle filling)? Then it is the creator who is short, not you.
    throw fail(["challenge", "rematch"].includes(source) ? ce.message.replace("to join", "to start it")
      : "Its creator doesn't have enough coins for their agent's answers right now — try again later.", 402);
  }

  const ids = [creatorId, ...others];
  const { data: agents } = await db.from("user_agents").select("id, user_id").in("user_id", ids);
  const agentOf = new Map((agents || []).map((a) => [a.user_id, a.id]));
  if (!agentOf.get(creatorId)) throw fail("Create your agent first.");
  const noAgent = others.filter((id) => !agentOf.get(id));
  if (noAgent.length) throw fail("One of them doesn't have an agent yet.");

  // A 1v1 between two people who already have one open is a duplicate.
  if (o.kind === "1v1") {
    const { data: mine } = await db.from("battle_participants").select("battle_id, battles!inner(status, battle_type)")
      .eq("user_id", creatorId).in("battles.status", ["lobby", "scheduled", "live"]).eq("battles.battle_type", "1v1").limit(50);
    const myOpen = (mine || []).map((r) => r.battle_id);
    if (myOpen.length) {
      const { data: shared } = await db.from("battle_participants").select("battle_id").in("battle_id", myOpen).eq("user_id", others[0]).limit(1);
      if (shared?.length) throw fail("You already have a battle open with them — finish or cancel it first.", 409);
    }
  }

  const battleType = o.kind === "team" ? "team" : o.kind === "group" ? "classroom" : "1v1";
  const everyoneIn = others.every((id) => joined.includes(id));
  const scheduled = !!o.scheduledFor;
  const { data: battle, error } = await db.from("battles").insert({
    course_id: null, classroom_id: null, battle_type: battleType,
    title: o.title, description: source === "rematch" ? "Rematch" : null, hp_per_miss: o.hpPerMiss, min_xp: o.minXp,
    topic: o.topic, subject: o.subject, difficulty: o.difficulty,
    total_questions: o.total, time_limit_seconds: o.total * o.secondsPerQuestion,
    xp_prize: o.xp, xp_pool: o.xp * (o.kind === "1v1" ? 1 : Math.ceil(ids.length / 2)),
    max_participants: ids.length, total_participants: ids.length,
    status: scheduled && o.kind !== "1v1" ? "scheduled" : "lobby",
    // Unscheduled invitations stay open BATTLE_IDLE_HOURS, then run with
    // whoever accepted (if enough did) or expire — never wait for ever.
    scheduled_start: o.scheduledFor, expires_at: o.scheduledFor || new Date(Date.now() + IDLE_HOURS * 3600_000).toISOString(),
    created_by: creatorId,
  }).select().single();
  if (error) throw new Error(error.message);

  let fill;
  try {
    fill = await buildQuestions({
      battleId: battle.id, source: "auto", total: o.total, subject: o.subject, topic: o.topic,
      difficulty: o.difficulty, classLabel: null, userId: creatorId, durationSeconds: o.total * o.secondsPerQuestion,
    });
  } catch (e) {
    await db.from("battles").delete().eq("id", battle.id);
    if (e instanceof InsufficientCoins) throw fail("Not enough coins to write the questions — top up, or pick a subject with past papers.", 402);
    throw e;
  }
  if ((fill?.placed ?? 0) < NETWORK_LIMITS.MIN_Q) {
    await db.from("battles").delete().eq("id", battle.id);
    throw fail(`Couldn't put together enough ${o.subject} questions — try another subject or topic.`);
  }
  if (fill.placed !== o.total) {
    await db.from("battles").update({ total_questions: fill.placed, time_limit_seconds: fill.placed * (fill.secondsPerQuestion || o.secondsPerQuestion) }).eq("id", battle.id);
  }

  const teamOf = o.kind === "team" ? assignTeams(creatorId, others, teams) : {};
  const seat = (userId, role, isIn) => ({
    battle_id: battle.id, user_id: userId, agent_id: agentOf.get(userId), role,
    joined_at: isIn ? now() : null, ...(teamOf[userId] ? { team: teamOf[userId] } : {}),
  });
  await db.from("battle_participants").insert([
    seat(creatorId, "creator", true),
    ...others.map((id) => seat(id, o.kind === "1v1" ? "opponent" : "participant", joined.includes(id))),
  ]);

  const q = await queue();
  if (o.scheduledFor) {
    await q.add("expire-battle", { action: "expire-battle", battleId: battle.id },
      { delay: Math.max(0, Date.parse(o.scheduledFor) - Date.now() + EXPIRE_AFTER_START_MS) });
  }
  // Everyone already said yes (a request or circle): start now or at its time.
  if (everyoneIn && (startNowIfReady || scheduled)) {
    // Not "live" here: the start job only starts a battle that is waiting
    // (lobby/scheduled) and flips it live itself. Marking it live first left
    // a full request or circle stuck "live" with no questions ever asked.
    if (scheduled) await db.from("battles").update({ status: "scheduled" }).eq("id", battle.id);
    await q.add("start-battle", { action: "start-battle", battleId: battle.id },
      { delay: scheduled ? Math.max(0, Date.parse(o.scheduledFor) - Date.now()) : 3000, jobId: `start-${battle.id}` });
    for (const id of ids) global.io?.to(`user:${id}`).emit("join_battle_room", { battleId: battle.id });
  } else if (!scheduled) {
    await q.add("expire-battle", { action: "expire-battle", battleId: battle.id },
      { delay: IDLE_HOURS * 3600_000, jobId: `idle-${battle.id}` });
  }
  if (!(everyoneIn && (startNowIfReady || scheduled)) && scheduled && o.kind !== "1v1") {
    await q.add("start-battle", { action: "start-battle", battleId: battle.id },
      { delay: Math.max(0, Date.parse(o.scheduledFor) - Date.now()), jobId: `start-${battle.id}` });
  }

  const { data: me } = await db.from("users").select("full_name, avatar_url").eq("id", creatorId).maybeSingle();
  const who = me?.full_name?.split(" ")[0] || "Someone";
  const invited = others.filter((id) => !joined.includes(id));
  const { data: freshRow } = invited.length ? await db.from("battles").select("*").eq("id", battle.id).maybeSingle() : { data: null };
  const fresh = freshRow && { ...freshRow, users: { full_name: me?.full_name ?? null, avatar_url: me?.avatar_url ?? null } };
  for (const id of invited) {
    await notifyUser({
      userId: id, type: "battle_challenge",
      title: o.kind === "1v1" ? `⚔️ ${who} challenged your agent!` : `⚔️ ${who} invited you to a ${o.kind === "team" ? "2v2 team" : "group"} battle`,
      content: `${o.subject}${o.topic ? ` · ${o.topic}` : ""} · ${o.xp} XP${o.scheduledFor ? ` · ${new Date(o.scheduledFor).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}` : ""}`,
      relatedId: battle.id, link: "/app?tab=battles",
    }).catch(() => {});
    // The full card (deadline, questions, agents, HP rule, entry needs), the
    // same shape GET /my-challenges returns.
    if (fresh) global.io?.to(`user:${id}`).emit("new_challenge", { ...toCard(fresh), ...(teamOf[id] ? { team: teamOf[id] } : {}) });
  }
  // Everyone who had already said yes (a request's seat-takers, a circle's
  // members) hears that their battle is on — not only its creator.
  if (joined.length) {
    for (const id of joined) {
      await notifyUser({
        userId: id, type: "battle_ready",
        title: scheduled ? `📅 Your ${o.subject} battle is set` : `⚔️ Your ${o.subject} battle is starting`,
        content: `${o.title}${scheduled ? ` · ${new Date(o.scheduledFor).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}` : ""}`,
        relatedId: battle.id, link: "/app?tab=battles",
      }).catch(() => {});
      global.io?.to(`user:${id}`).emit("battle_ready", { battleId: battle.id, status: scheduled ? "scheduled" : "starting" });
    }
  }
  return { battleId: battle.id, status: everyoneIn ? (scheduled ? "scheduled" : "starting") : "invited", invited, joined, placed: fill.placed, kind: o.kind, teams: teamOf };
}
