/**
 * agent-network/outreach.js — Phase 21 part 2: a learner's agent STARTS a
 * conversation with another agent on its own. Its learner supervises: the
 * agent tells them what it did, and asks first only where permission is
 * needed (rules in outreachCore.js, pure).
 *
 *   findHelper({ learnerId, conceptId, subject, topic })
 *       a friend's agent whose learner has mastered the concept or got past the
 *       same struggle; else a learner who opted in to help others. Never a
 *       blocked pair.
 *   reachOut({ learnerId, trigger, purpose, ... })
 *       send   → messageAgent(origin 'agent') + a line in the learner's chat
 *       ask    → an agent_outreach card (Allow / Reject / Later); nothing is
 *                sent until Allow
 *       skip   → nothing (blocked, cap, Offline, quiet hours, no helper)
 *   approveOutreach(userId, payload)   the card's Allow
 *   reportOutreachAnswer(messageId)    the other agent answered later: tell the asker
 *
 * Triggers: a struggle opened (struggles.afterLearningEvent) and a Study Prep
 * topic starting (study-prep/wiring.js), both fire-and-forget; the chat tool
 * and the gate call reachOut directly.
 */
import db from "../../db.js";
import { OUTREACH, KIND_FOR_PURPOSE, decideOutreach, outreachQuestion, outreachLearnerText } from "./outreachCore.js";
import { isProtectedLearner } from "./autoReplyCore.js";
import { blockedWith } from "./network.js";
import { inQuiet, quietOf } from "../autonomy/quietHours.js";

const edu = () => db.schema("edu");
const first = (full, username) => String(full || "").trim().split(/\s+/)[0] || username || "a learner";
const UUID = /^[0-9a-f-]{36}$/i;
const dayStart = (now = new Date()) => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };
const MASTERED = 0.8;

async function friendIds(userId) {
  const [{ data: a }, { data: b }] = await Promise.all([
    edu().from("agent_friends").select("user_b").eq("user_a", userId).eq("status", "accepted"),
    edu().from("agent_friends").select("user_a").eq("user_b", userId).eq("status", "accepted"),
  ]);
  return new Set([...(a || []).map((r) => r.user_b), ...(b || []).map((r) => r.user_a)]);
}

/** Who knows this concept: mastery first, then a resolved (non-sensitive) struggle. → Map(userId → score) */
async function knowersOf(conceptId, { among = null, exclude } = {}) {
  const scores = new Map();
  if (!conceptId || !UUID.test(String(conceptId))) return scores;
  let m = edu().from("learner_concept_state").select("learner_id, mastery").eq("concept_id", conceptId).gte("mastery", MASTERED);
  let s = edu().from("learning_struggles").select("learner_id").eq("concept_id", conceptId).eq("status", "resolved").eq("sensitive", false);
  if (among) { const ids = [...among]; if (!ids.length) return scores; m = m.in("learner_id", ids); s = s.in("learner_id", ids); }
  const [{ data: mastered }, { data: resolved }] = await Promise.all([m.order("mastery", { ascending: false }).limit(50), s.limit(50)]);
  for (const r of mastered || []) if (!exclude.has(r.learner_id)) scores.set(r.learner_id, Number(r.mastery) || MASTERED);
  for (const r of resolved || []) if (!exclude.has(r.learner_id) && !scores.has(r.learner_id)) scores.set(r.learner_id, 0.7);
  return scores;
}

async function describe(userId, { friends, blocked }) {
  const [{ data: u }, { data: a }] = await Promise.all([
    db.from("users").select("id, full_name, username, study_level, year_group, deactivated_at, deleted_at").eq("id", userId).maybeSingle(),
    db.from("user_agents").select("help_others_opt_in, help_others_chosen_at").eq("user_id", userId).maybeSingle(),
  ]);
  if (!u || u.deactivated_at || u.deleted_at) return null;
  const { helpsOthers } = await import("../adaptive-learning/peerConsult.js");
  const young = isProtectedLearner({ studyLevel: u.study_level, yearGroup: u.year_group });
  return { userId, name: first(u.full_name, u.username), username: u.username, isFriend: friends.has(userId), optedIn: helpsOthers(a, { young }), blocked: blocked.has(userId) };
}

/** The best agent to ask. `target` (id or @username) names one directly. → helper | null */
export async function findHelper({ learnerId, conceptId = null, subject = null, topic = null, target = null, friendsOnly = false } = {}) {
  const [friends, blocked] = await Promise.all([friendIds(learnerId), blockedWith(learnerId)]);
  if (target) {
    const key = String(target).trim().replace(/^@/, "");
    const q = db.from("users").select("id");
    const { data } = await (UUID.test(key) ? q.eq("id", key) : q.ilike("username", key)).maybeSingle();
    if (!data || data.id === learnerId) return null;
    return describe(data.id, { friends, blocked });
  }
  if (!conceptId && topic) {
    const { conceptIdFor } = await import("../adaptive-learning/peerConsult.js");
    conceptId = await conceptIdFor(topic, subject).catch(() => null);
  }
  const exclude = new Set([learnerId, ...blocked]);
  const pick = async (scores) => {
    for (const [id] of [...scores.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8)) {
      const h = await describe(id, { friends, blocked });
      if (h && !h.blocked && (h.isFriend || h.optedIn)) return h;
    }
    return null;
  };
  const friend = await pick(await knowersOf(conceptId, { among: friends, exclude }));
  if (friend || friendsOnly) return friend;
  return pick(await knowersOf(conceptId, { exclude }));
}

/** Has this agent already reached out about this topic today (a message or an open card)? */
async function alreadyAsked(learnerId, topic, since) {
  if (!topic) return false;
  const [{ count: sent }, { count: cards }] = await Promise.all([
    edu().from("agent_messages").select("id", { count: "exact", head: true }).eq("from_user", learnerId).eq("origin", "agent").ilike("topic", topic).gte("created_at", since),
    edu().from("agent_proposals").select("id", { count: "exact", head: true }).eq("user_id", learnerId).eq("kind", "agent_outreach").eq("status", "proposed").eq("payload->>topic", topic),
  ]);
  return (sent ?? 0) + (cards ?? 0) > 0;
}

async function send(learnerId, { helper, purpose, trigger, subject, topic, question, deps }) {
  const { messageAgent } = await import("./messaging.js");
  if (!deps && purpose === "study_question") deps = (await import("../adaptive-learning/chat.js")).protegeDeps;
  return messageAgent(learnerId, { to: helper.userId, kind: KIND_FOR_PURPOSE[purpose], question, subject, topic, origin: "agent", trigger, purpose }, { deps });
}

/**
 * Start a conversation with another agent, or ask the learner first. Never throws.
 * `force`: the gate's lever past Offline / quiet hours (never the permission rules).
 * → { action, reason, helper?, messageId?, delivered?, answer?, proposalId? }
 */
export async function reachOut({ learnerId, trigger = "manual", purpose = "study_question", subject = null, topic = null, conceptId = null,
  gaps = [], target = null, friendsOnly = false, force = false, deps = null, now = new Date() } = {}) {
  try {
    if (!learnerId) return { action: "skip", reason: "no_learner" };
    const since = dayStart(now);
    const [{ data: me }, { data: auto }, { count: sentToday }] = await Promise.all([
      db.from("users").select("study_level, year_group").eq("id", learnerId).maybeSingle(),
      edu().from("learner_agent_autonomy").select("enabled, quiet_start, quiet_end, time_zone").eq("user_id", learnerId).maybeSingle(),
      edu().from("agent_messages").select("id", { count: "exact", head: true }).eq("from_user", learnerId).eq("origin", "agent").gte("created_at", since),
    ]);
    if (!target && await alreadyAsked(learnerId, topic, since)) return { action: "skip", reason: "already_asked" };
    const helper = await findHelper({ learnerId, conceptId, subject, topic, target, friendsOnly });
    const decision = decideOutreach({
      purpose, target: helper || {}, protectedLearner: isProtectedLearner({ studyLevel: me?.study_level, yearGroup: me?.year_group }),
      sentToday: sentToday ?? 0, agentOnline: force || !!auto?.enabled, quiet: !force && inQuiet(now, quietOf(auto || {})),
    });
    // A topic starting is only worth a friend's word — never a card asking about a stranger.
    if (friendsOnly && decision.action === "ask_learner" && decision.reason === "stranger") return { action: "skip", reason: "friends_only" };
    const who = helper ? { userId: helper.userId, name: helper.name, username: helper.username ? `@${helper.username}` : null } : null;
    if (decision.action === "skip") return { ...decision, ...(who ? { helper: who } : {}) };

    const question = outreachQuestion({ trigger, topic, gaps, purpose });
    const { post } = await import("./autoReply.js");
    if (decision.action === "send") {
      const r = await send(learnerId, { helper, purpose, trigger, subject, topic, question, deps });
      await post(learnerId, outreachLearnerText({ action: "send", helperName: helper.name, topic, answer: r.answer || null }),
        { outreach: { messageId: r.messageId, to: who, trigger, purpose, answered: !!r.answer } });
      return { ...decision, helper: who, messageId: r.messageId, delivered: r.delivered, ...(r.answer ? { answer: r.answer } : {}) };
    }

    // ask_learner: one card; nothing leaves until Allow.
    const yes = purpose === "friend_request" ? "Ask them" : purpose === "battle_invite" ? "Invite" : purpose === "share_data" ? "Share" : "Ask them";
    const title = purpose === "friend_request" ? `Be study friends with ${helper.name}?` : purpose === "battle_invite" ? `Invite ${helper.name} to a battle?`
      : purpose === "share_data" ? `Share your notes with ${helper.name}?` : `Ask ${helper.name}'s agent for help?`;
    const text = outreachLearnerText({ action: "ask_learner", helperName: helper.name, topic, purpose });
    const payload = { to: helper.userId, toName: helper.name, purpose, trigger, subject, topic, conceptId, question, reason: decision.reason };
    const rule = `agent_outreach:${purpose}:${decision.reason}`;
    const { data: prop, error } = await edu().from("agent_proposals").insert({
      user_id: learnerId, kind: "agent_outreach", title, rationale: text.slice(0, 500), payload, status: "proposed",
      expires_at: new Date(now.getTime() + 3 * 864e5).toISOString(), basis: "inferred", basis_rule: rule,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const where = await post(learnerId, text, { proposal: { id: prop.id, kind: "agent_outreach", title, status: "proposed", yes, basis: "inferred", rule } });
    await edu().from("agent_proposals").update({ posted_at: now.toISOString(), chat_session_id: where?.chatId || null, chat_message_id: where?.messageId || null }).eq("id", prop.id);
    return { ...decision, helper: who, proposalId: prop.id };
  } catch (e) {
    console.warn("[agent-outreach] not started:", String(e?.message || e).slice(0, 160));
    return { action: "skip", reason: "error", error: String(e?.message || e).slice(0, 160) };
  }
}

/** Allow on an agent_outreach card: the message goes now (the other side's rules still apply). */
export async function approveOutreach(userId, payload = {}, { deps = null } = {}) {
  if (!payload.to || !OUTREACH.PURPOSES.includes(payload.purpose)) throw Object.assign(new Error("That request is out of date."), { status: 409 });
  const blocked = await blockedWith(userId);
  if (blocked.has(payload.to)) throw Object.assign(new Error("You can't message that learner's agent."), { status: 403 });
  const helper = { userId: payload.to, name: payload.toName || "them" };
  const r = await send(userId, { helper, purpose: payload.purpose, trigger: payload.trigger || "manual", subject: payload.subject || null, topic: payload.topic || null,
    question: payload.question || outreachQuestion({ topic: payload.topic, purpose: payload.purpose }), deps });
  // The proposal's report (autonomy/deliver.js) tells the learner — with the answer when it came at once.
  return { sent: true, messageId: r.messageId, delivered: r.delivered, to: r.to, ...(r.answer ? { answer: r.answer } : {}) };
}

/** The other agent answered after the fact: one line in the asker's chat. Never throws. */
export async function reportOutreachAnswer(messageId) {
  try {
    const { data: m } = await edu().from("agent_messages").select("id, from_user, to_user, topic, answer, origin, kind").eq("id", messageId).maybeSingle();
    if (!m?.answer || m.origin !== "agent") return { reported: false };
    const { data: u } = await db.from("users").select("full_name, username").eq("id", m.to_user).maybeSingle();
    const { post } = await import("./autoReply.js");
    const text = m.kind === "friend_request" ? `${first(u?.full_name, u?.username)} answered your friend request: “${String(m.answer).slice(0, 300)}”`
      : outreachLearnerText({ helperName: first(u?.full_name, u?.username), topic: m.topic, answer: m.answer });
    const where = await post(m.from_user, text, { outreach: { messageId: m.id, answered: true } });
    await edu().from("agent_messages").update({ answer_read_at: new Date().toISOString() }).eq("id", m.id);
    return { reported: !!where };
  } catch (e) {
    console.warn("[agent-outreach] answer not reported:", String(e?.message || e).slice(0, 160));
    return { reported: false };
  }
}
