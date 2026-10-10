/**
 * agent-network/challenges.js — battles between agents across the network.
 *
 *   challengeAgents(me, input)        challenge one (1v1), 2–7 (group) or three (2v2 team) agents found
 *                                     by search — now, or at a set time
 *   postChallengeRequest(me, input)   "JAMB Chemistry 1v1, 10 questions, tonight at 8" for others to take
 *   searchChallengeRequests(me, f)    open requests the viewer may take, best first
 *   acceptChallengeRequest(me, id)    take a seat; when the seats are full the battle is made
 *   cancelChallengeRequest(me, id)
 *   rematch(me, battleId)             the same battle again with the same agents
 *
 * Who may be challenged follows their privacy (canFind) and "open to
 * challenges"; blocks hide both ways.
 */
import db from "../../db.js";
import { createNetworkBattle, cleanBattleOptions } from "../battle/networkBattle.js";
import { canFind } from "./filters.js";
import { relationsOf, blockedWith, getSettings } from "./network.js";
import { notifyUser } from "../notify.js";

const edu = () => db.schema("edu");
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const REQUEST_LIMITS = Object.freeze({ OPEN_PER_LEARNER: 3, DEFAULT_HOURS: 24, MAX_HOURS: 24 * 7 });

/** Resolve "@ada" / userIds to user ids. */
async function resolveIds(list = []) {
  const ids = new Set(), handles = [];
  for (const raw of Array.isArray(list) ? list : [list]) {
    const s = String(raw || "").trim();
    if (!s) continue;
    if (/^[0-9a-f-]{36}$/i.test(s)) ids.add(s); else handles.push(s.replace(/^@/, ""));
  }
  for (const h of handles) {
    const { data } = await db.from("users").select("id").ilike("username", h).limit(1);
    if (!data?.length) throw fail(`No learner called @${h}.`);
    ids.add(data[0].id);
  }
  return [...ids];
}

/** Can `me` challenge each of `ids`? → throws with a clear reason when not. */
async function checkChallengeable(meId, ids) {
  const [rel, blocked, { data: me }, { data: users }] = await Promise.all([
    relationsOf(meId), blockedWith(meId),
    db.from("users").select("school_name").eq("id", meId).maybeSingle(),
    db.from("users").select("id, full_name, username, role, school_name, deactivated_at, deleted_at").in("id", ids),
  ]);
  const byId = new Map((users || []).map((u) => [u.id, u]));
  for (const id of ids) {
    const u = byId.get(id);
    const settings = await getSettings(id);
    const target = { id, role: u?.role, school: u?.school_name, deactivated: !!(u?.deactivated_at || u?.deleted_at), settings };
    const relFlags = { classmate: rel.classmates.has(id), coursemate: rel.coursemates.has(id) || rel.liveMates.has(id) };
    if (!u || !canFind({ id: meId, school: me?.school_name }, target, relFlags, blocked)) throw fail("One of those agents isn't available to challenge.", 403);
    if (settings.open_to_challenges === false) throw fail(`${(u.full_name || u.username).split(" ")[0]} isn't taking challenges right now.`, 409);
  }
  return byId;
}

/**
 * Challenge agents directly.
 * input: { opponents: [userId|@username], kind: 1v1|group|team, teammate?: userId (team), subject, topic, exam,
 *          difficulty, total_questions, scheduled_for, title }
 */
export async function challengeAgents(meId, input = {}) {
  const kind = ["1v1", "group", "team"].includes(input.kind) ? input.kind : "1v1";
  const opponents = await resolveIds(input.opponents ?? input.opponent ?? []);
  const teammate = kind === "team" && input.teammate ? (await resolveIds([input.teammate]))[0] : null;
  const everyone = [...new Set([...opponents, ...(teammate ? [teammate] : [])])].filter((id) => id !== meId);
  if (!everyone.length) throw fail("Who should your agent challenge? Find them with search_agents first.");
  await checkChallengeable(meId, everyone);
  const teams = teammate ? { [teammate]: "A", ...Object.fromEntries(opponents.filter((id) => id !== teammate).map((id) => [id, "B"])) } : {};
  return createNetworkBattle({ creatorId: meId, opponents: everyone, teams, options: { ...input, kind }, source: "challenge" });
}

/* ── Challenge requests ─────────────────────────────────────────────────── */

const REQUEST_SCOPES = ["everyone", "school", "classmates", "course", "community"];

export async function postChallengeRequest(meId, input = {}) {
  const kind = ["1v1", "team", "group"].includes(input.kind ?? input.battle_type) ? (input.kind ?? input.battle_type) : "1v1";
  const o = cleanBattleOptions({ ...input, kind });
  const { count } = await edu().from("challenge_requests").select("id", { count: "exact", head: true })
    .eq("created_by", meId).eq("status", "open").gt("expires_at", new Date().toISOString());
  if ((count ?? 0) >= REQUEST_LIMITS.OPEN_PER_LEARNER) throw fail(`You have ${REQUEST_LIMITS.OPEN_PER_LEARNER} open requests — cancel one or wait for takers.`, 429);
  const hours = Math.min(REQUEST_LIMITS.MAX_HOURS, Math.max(1, Number(input.expires_in_hours) || REQUEST_LIMITS.DEFAULT_HOURS));
  const expires = o.scheduledFor ? new Date(Date.parse(o.scheduledFor) - 60_000) : new Date(Date.now() + hours * 3600_000);
  const maxPlayers = kind === "1v1" ? 2 : kind === "team" ? 4 : Math.min(8, Math.max(3, Math.round(Number(input.max_players) || 4)));
  const scope = REQUEST_SCOPES.includes(input.scope) ? input.scope : "everyone";
  const row = {
    created_by: meId, battle_type: kind === "group" ? "open" : kind, title: o.title, subject: o.subject, topic: o.topic,
    exam: input.exam ? String(input.exam).toUpperCase().slice(0, 20) : null, difficulty: o.difficulty, total_questions: o.total,
    max_players: maxPlayers, scope, scope_id: ["course", "community"].includes(scope) && input.scope_id ? String(input.scope_id) : null,
    min_xp: Number.isFinite(Number(input.min_xp)) ? Math.max(0, Math.round(Number(input.min_xp))) : null,
    max_xp: Number.isFinite(Number(input.max_xp)) ? Math.max(0, Math.round(Number(input.max_xp))) : null,
    scheduled_for: o.scheduledFor, note: input.note ? String(input.note).slice(0, 280) : null,
    expires_at: expires.toISOString(),
  };
  const { data, error } = await edu().from("challenge_requests").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

const kindOfRequest = (r) => (r.battle_type === "open" ? "group" : r.battle_type);

/** May `me` take this request? (scope, XP bounds, blocks, not full, not mine) */
function mayTake(r, me, rel, blocked) {
  if (r.created_by === me.id || blocked.has(r.created_by)) return false;
  if ((r.accepted_by || []).includes(me.id)) return false;
  if (r.min_xp != null && me.xp < r.min_xp) return false;
  if (r.max_xp != null && me.xp > r.max_xp) return false;
  switch (r.scope) {
    case "classmates": return rel.classmates.has(r.created_by) || rel.coursemates.has(r.created_by) || rel.liveMates.has(r.created_by);
    case "school": return rel.classmates.has(r.created_by) || (!!me.school && !!r._school && me.school.toLowerCase() === r._school.toLowerCase());
    case "course": return rel.courses.some((c) => c.id === r.scope_id);
    case "community": return rel.communities.some((c) => c.id === r.scope_id);
    default: return true;
  }
}

/** Open requests the viewer may take. f: { subject, exam, kind, topic, starting_within_hours, mine } */
export async function searchChallengeRequests(meId, f = {}) {
  const nowIso = new Date().toISOString();
  if (f.mine) {
    const { data } = await edu().from("challenge_requests").select("*").eq("created_by", meId).order("created_at", { ascending: false }).limit(20);
    return { requests: data || [] };
  }
  let q = edu().from("challenge_requests").select("*").eq("status", "open").gt("expires_at", nowIso).order("created_at", { ascending: false }).limit(200);
  if (f.subject) q = q.ilike("subject", `%${String(f.subject).slice(0, 60)}%`);
  if (f.exam) q = q.ilike("exam", String(f.exam).slice(0, 20));
  if (f.topic) q = q.ilike("topic", `%${String(f.topic).slice(0, 80)}%`);
  if (f.kind) q = q.eq("battle_type", f.kind === "group" ? "open" : f.kind);
  const [{ data: rows }, rel, blocked, { data: meU }, { data: meA }] = await Promise.all([
    q, relationsOf(meId), blockedWith(meId),
    db.from("users").select("school_name").eq("id", meId).maybeSingle(),
    db.from("user_agents").select("total_xp").eq("user_id", meId).maybeSingle(),
  ]);
  const creators = [...new Set((rows || []).map((r) => r.created_by))];
  const [{ data: users }, { data: agents }, { data: presence }] = creators.length ? await Promise.all([
    db.from("users").select("id, full_name, username, school_name").in("id", creators),
    db.from("user_agents").select("user_id, agent_name, agent_emoji, total_xp, level").in("user_id", creators),
    edu().from("learner_presence").select("user_id, last_seen_at").in("user_id", creators),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];
  const U = new Map((users || []).map((u) => [u.id, u])), A = new Map((agents || []).map((a) => [a.user_id, a])), P = new Map((presence || []).map((p) => [p.user_id, p.last_seen_at]));
  const me = { id: meId, school: meU?.school_name || null, xp: meA?.total_xp || 0 };
  const within = Number(f.starting_within_hours) > 0 ? Date.now() + Number(f.starting_within_hours) * 3600_000 : null;
  const out = [];
  for (const r of rows || []) {
    const u = U.get(r.created_by), a = A.get(r.created_by);
    if (!u || !a) continue;
    if (!mayTake({ ...r, _school: u.school_name }, me, rel, blocked)) continue;
    if (within && r.scheduled_for && Date.parse(r.scheduled_for) > within) continue;
    out.push({
      id: r.id, title: r.title, kind: kindOfRequest(r), subject: r.subject, topic: r.topic, exam: r.exam, difficulty: r.difficulty,
      questions: r.total_questions, seats: `${1 + (r.accepted_by || []).length}/${r.max_players}`, scheduledFor: r.scheduled_for,
      expiresAt: r.expires_at, note: r.note,
      by: { userId: u.id, name: (u.full_name || u.username).split(" ")[0], username: `@${u.username}`, agent: `${a.agent_emoji || "🤖"} ${a.agent_name}`, level: a.level || 1, xp: a.total_xp || 0,
        online: !!P.get(u.id) && Date.now() - Date.parse(P.get(u.id)) < 150_000 },
      fair: Math.abs((a.total_xp || 0) - me.xp),
    });
  }
  out.sort((x, y) => Number(y.by.online) - Number(x.by.online) || x.fair - y.fair);
  return { requests: out.slice(0, 20), total: out.length };
}

/** Take a seat on a request; the battle is made once the seats are full. */
export async function acceptChallengeRequest(meId, requestId) {
  const { data: r } = await edu().from("challenge_requests").select("*").eq("id", requestId).maybeSingle();
  if (!r || r.status !== "open" || Date.parse(r.expires_at) < Date.now()) throw fail("That challenge request is no longer open.", 409);
  const [rel, blocked, { data: meU }, { data: meA }, { data: owner }] = await Promise.all([
    relationsOf(meId), blockedWith(meId),
    db.from("users").select("school_name").eq("id", meId).maybeSingle(),
    db.from("user_agents").select("id, total_xp").eq("user_id", meId).maybeSingle(),
    db.from("users").select("school_name, full_name, username").eq("id", r.created_by).maybeSingle(),
  ]);
  if (!meA) throw fail("Create your agent first.");
  if (!mayTake({ ...r, _school: owner?.school_name }, { id: meId, school: meU?.school_name, xp: meA.total_xp || 0 }, rel, blocked)) throw fail("This request isn't open to you.", 403);

  const accepted = [...(r.accepted_by || []), meId];
  const full = 1 + accepted.length >= r.max_players;
  // Optimistic lock on the seat list: two people taking the last seat at once.
  const { data: upd } = await edu().from("challenge_requests")
    .update({ accepted_by: accepted, ...(full ? { status: "accepted" } : {}) })
    .eq("id", r.id).eq("status", "open").eq("accepted_by", `{${(r.accepted_by || []).join(",")}}`).select("id");
  if (!upd?.length) throw fail("Someone took that seat a moment ago — try again.", 409);

  if (!full) {
    await notifyUser({ userId: r.created_by, type: "battle_accepted", title: "🙌 Someone joined your challenge request",
      content: `${r.title} · ${1 + accepted.length}/${r.max_players} seats`, relatedId: r.id, link: "/app?tab=battles" }).catch(() => {});
    return { seated: true, full: false, seats: `${1 + accepted.length}/${r.max_players}` };
  }
  try {
    const battle = await createNetworkBattle({
      creatorId: r.created_by, opponents: accepted, joined: accepted, startNowIfReady: true, source: "request",
      options: { kind: kindOfRequest(r), subject: r.subject, topic: r.topic, difficulty: r.difficulty, total_questions: r.total_questions, scheduled_for: r.scheduled_for, title: r.title },
    });
    await edu().from("challenge_requests").update({ battle_id: battle.battleId }).eq("id", r.id);
    await notifyUser({ userId: r.created_by, type: "battle_accepted", title: "⚔️ Your challenge request was taken!",
      content: `${r.title} · ${r.scheduled_for ? "starts at its time" : "starting now"}`, relatedId: battle.battleId, link: "/app?tab=battles" }).catch(() => {});
    return { seated: true, full: true, battleId: battle.battleId, status: battle.status };
  } catch (e) {
    // The battle couldn't be made: give the seat back so the request stays open.
    await edu().from("challenge_requests").update({ accepted_by: r.accepted_by || [], status: "open" }).eq("id", r.id);
    throw e;
  }
}

export async function cancelChallengeRequest(meId, requestId) {
  const { data } = await edu().from("challenge_requests").update({ status: "cancelled" })
    .eq("id", requestId).eq("created_by", meId).eq("status", "open").select("id");
  if (!data?.length) throw fail("That request isn't yours or isn't open.", 404);
  return { cancelled: requestId };
}

/* ── Rematch ────────────────────────────────────────────────────────────── */

export async function rematch(meId, battleId) {
  const { data: b } = await db.from("battles").select("id, battle_type, title, subject, topic, difficulty, total_questions, status, recurring_key").eq("id", battleId).maybeSingle();
  if (b?.recurring_key) throw fail("The daily battle comes round again tomorrow — no rematch needed.", 409);
  if (!b || !["completed", "expired"].includes(b.status)) throw fail("That battle isn't finished yet.", 409);
  const { data: seats } = await db.from("battle_participants").select("user_id, role, team").eq("battle_id", battleId);
  const players = (seats || []).filter((s) => s.role !== "teacher");
  if (!players.some((s) => s.user_id === meId)) throw fail("You weren't in that battle.", 403);
  const others = players.filter((s) => s.user_id !== meId).map((s) => s.user_id);
  if (!others.length) throw fail("A review has nobody to rematch.");
  await checkChallengeable(meId, others);
  const kind = b.battle_type === "team" ? "team" : others.length === 1 ? "1v1" : "group";
  const myTeam = players.find((s) => s.user_id === meId)?.team;
  const teams = kind === "team" ? Object.fromEntries(players.filter((s) => s.user_id !== meId).map((s) => [s.user_id, s.team === myTeam ? "A" : "B"])) : {};
  return createNetworkBattle({
    creatorId: meId, opponents: others, teams, source: "rematch",
    options: { kind, subject: b.subject || "General", topic: b.topic, difficulty: b.difficulty, total_questions: b.total_questions, title: `Rematch: ${b.title}`.slice(0, 120) },
  });
}
