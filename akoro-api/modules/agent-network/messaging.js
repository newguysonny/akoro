/**
 * agent-network/messaging.js — learners' agents talking to each other.
 *
 * Learners never message each other directly: their AGENTS do, and only
 * through this file. Every message is screened (no emails, phone numbers or
 * invite links), length-capped, rate-limited, and follows the recipient's
 * "who can message my agent" setting and blocks.
 *
 *   messageAgent(from, { to, question, kind })
 *     consult    the other agent is ONLINE → it answers now, as a protégé: only
 *                from what its own learner taught it (or says it wasn't taught
 *                that). The ASKER pays for that answer. Offline → the question
 *                waits in its inbox and is answered when its learner is back.
 *     suggestion an idea left for the other agent (no answer expected)
 *   inbox(me)                     messages to my agent (unread first) and answers to mine
 *   replyToAgent(me, id, text)    my agent answers a waiting question (with my learner)
 *   consultOnlineAgents(me, q)    ask up to two ONLINE agents at once (the real peer consult)
 *   inboxBrief(me)                one short line for the Agent Chat prompt: "3 messages waiting"
 */
import db from "../../db.js";
import { OPENAI_MODEL, openai } from "../../lib/aiModel.js";
import { notifyUser } from "../notify.js";
import { loadTaughtKnowledge } from "../adaptive-learning/protege.js";
import { canMessage, presenceOf } from "./filters.js";
import { relationsOf, blockedWith, getSettings, onlineIds } from "./network.js";

const edu = () => db.schema("edu");
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const MESSAGE_LIMITS = Object.freeze({ PER_DAY: 20, PER_RECIPIENT_PER_DAY: 5, MAX_CHARS: 400, ANSWER_MAX_CHARS: 700 });
export const AGENT_CONSULT_FEATURE = "agent_consult";

const first = (full, username) => String(full || "").trim().split(/\s+/)[0] || username || "a learner";
const dayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

/** "@ada" or a userId → { id, ...user } */
async function resolveUser(to) {
  const s = String(to || "").trim();
  if (!s) throw fail("Which agent? Find them with search_agents first.");
  const q = /^[0-9a-f-]{36}$/i.test(s)
    ? db.from("users").select("id, full_name, username, role, school_name, deactivated_at, deleted_at").eq("id", s)
    : db.from("users").select("id, full_name, username, role, school_name, deactivated_at, deleted_at").ilike("username", s.replace(/^@/, ""));
  const { data } = await q.limit(1);
  if (!data?.length) throw fail("No learner by that name.");
  return data[0];
}

/** Screen the text that crosses between learners: length, and no contact details. */
const EMAIL_LIKE = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;
const PHONE_LIKE = /\+?\d[\d\s().-]{7,}\d/;
const INVITE_LIKE = /(https?:\/\/|www\.|t\.me|wa\.me|whatsapp|telegram|discord\.gg|bit\.ly|instagram\.com|tiktok\.com|snapchat)/i;
export function screenMessage(raw, { min = 10, max = MESSAGE_LIMITS.MAX_CHARS } = {}) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (text.length < min) return { ok: false, reason: "too_short" };
  if (text.length > max) return { ok: false, reason: "too_long" };
  if (EMAIL_LIKE.test(text) || PHONE_LIKE.test(text) || INVITE_LIKE.test(text)) return { ok: false, reason: "contact_details" };
  return { ok: true, question: text };
}
const SCREEN_REASON = {
  too_short: "Say a little more — at least a full question.",
  too_long: "That's too long — keep it to a few sentences.",
  contact_details: "Messages between agents can't carry emails, phone numbers or invite links.",
};

/** The protégé's answer to another agent — only from its own learner's teaching. */
export function buildPeerAnswerMessages({ agentName, learnerFirst, question, taught = [], askerAgent }) {
  const system = [
    `You are ${agentName}, ${learnerFirst}'s study agent on Akoro. You are a protégé: you only know what ${learnerFirst} has taught you.`,
    `Another learner's agent (${askerAgent}) is asking you something. Answer ONLY from "What ${learnerFirst} taught you" below.`,
    `If nothing there covers it, say plainly that ${learnerFirst} hasn't taught you that yet — then give ONE general study tip instead. Never invent facts.`,
    `Never share anything personal about ${learnerFirst}: no school, location, contacts, schedule or results. Under 100 words, friendly, no greeting.`,
    'Return JSON: { "answer": string, "from_taught": boolean }',
  ].join("\n");
  const user = `Question: ${question}\n\nWhat ${learnerFirst} taught you:\n` +
    (taught.length ? taught.map((c) => `- [${[c.subject, c.topic].filter(Boolean).join(" — ")}] ${String(c.content).slice(0, 500)}`).join("\n") : "(nothing on this)");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

export function shapeAnswer(raw) {
  let j = {};
  try { j = typeof raw === "string" ? JSON.parse(raw) : raw || {}; } catch { j = { answer: String(raw || "") }; }
  const answer = String(j.answer || "").trim().slice(0, MESSAGE_LIMITS.ANSWER_MAX_CHARS);
  // Whatever the model says, never pass on contact details.
  const clean = answer.replace(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g, "[removed]").replace(/\+?\d[\d\s().-]{7,}\d/g, "[removed]");
  return { answer: clean, fromTaught: j.from_taught === true };
}

/** One online agent answers now (billed to the asker). */
async function answerNow({ asker, target, question, subject, topic, deps }) {
  const [{ data: agent }, { data: askerAgent }] = await Promise.all([
    db.from("user_agents").select("agent_name, agent_emoji").eq("user_id", target.id).maybeSingle(),
    db.from("user_agents").select("agent_name").eq("user_id", asker).maybeSingle(),
  ]);
  const taught = await loadTaughtKnowledge({ studentId: target.id, query: [subject, topic, question].filter(Boolean).join(" "), deps }).catch(() => ({ chunks: [] }));
  const res = await openai.chat.completions.create({
    model: OPENAI_MODEL, temperature: 0.5, max_tokens: 260,
    response_format: { type: "json_object" },
    __userId: asker, __feature: AGENT_CONSULT_FEATURE,          // the ASKER pays
    messages: buildPeerAnswerMessages({
      agentName: agent?.agent_name || "Agent", learnerFirst: first(target.full_name, target.username),
      question, taught: (taught.chunks || []).slice(0, 4), askerAgent: askerAgent?.agent_name || "another agent",
    }),
  });
  return { ...shapeAnswer(res.choices?.[0]?.message?.content), agentName: agent?.agent_name || "Agent", agentEmoji: agent?.agent_emoji || "🤖" };
}

async function checkMessageable(fromId, target) {
  const [rel, blocked, { data: me }, settings] = await Promise.all([
    relationsOf(fromId), blockedWith(fromId), db.from("users").select("school_name").eq("id", fromId).maybeSingle(), getSettings(target.id),
  ]);
  const t = { id: target.id, role: target.role, school: target.school_name, deactivated: !!(target.deactivated_at || target.deleted_at), settings };
  const relFlags = { classmate: rel.classmates.has(target.id), coursemate: rel.coursemates.has(target.id) || rel.liveMates.has(target.id) };
  if (!canMessage({ id: fromId, school: me?.school_name }, t, relFlags, blocked)) throw fail("That agent isn't taking messages from you.", 403);
}

async function checkLimits(fromId, toId) {
  const since = dayStart();
  const [{ count: all }, { count: toThem }] = await Promise.all([
    edu().from("agent_messages").select("id", { count: "exact", head: true }).eq("from_user", fromId).gte("created_at", since),
    edu().from("agent_messages").select("id", { count: "exact", head: true }).eq("from_user", fromId).eq("to_user", toId).gte("created_at", since),
  ]);
  if ((all ?? 0) >= MESSAGE_LIMITS.PER_DAY) throw fail(`Your agent has sent ${MESSAGE_LIMITS.PER_DAY} messages today — that's the daily limit.`, 429);
  if ((toThem ?? 0) >= MESSAGE_LIMITS.PER_RECIPIENT_PER_DAY) throw fail("That's enough messages to that agent for today — try again tomorrow.", 429);
}

/** Send a consult or a suggestion to another agent. */
export async function messageAgent(fromId, input = {}, { deps } = {}) {
  const kind = input.kind === "suggestion" ? "suggestion" : "consult";
  const target = await resolveUser(input.to ?? input.userId ?? input.username);
  if (target.id === fromId) throw fail("That's your own agent.");
  const screened = screenMessage(input.question ?? input.body ?? input.message);
  if (!screened.ok) throw fail(SCREEN_REASON[screened.reason] || "That message can't be sent.");
  await checkMessageable(fromId, target);
  await checkLimits(fromId, target.id);

  const { data: me } = await db.from("users").select("full_name, username").eq("id", fromId).maybeSingle();
  const { data: myAgent } = await db.from("user_agents").select("agent_name, agent_emoji").eq("user_id", fromId).maybeSingle();
  const online = (await onlineIds([target.id])).has(target.id);
  const subject = input.subject ? String(input.subject).slice(0, 60) : null;
  const topic = input.topic ? String(input.topic).slice(0, 80) : null;

  let answered = null;
  if (kind === "consult" && online && deps) {
    answered = await answerNow({ asker: fromId, target, question: screened.question, subject, topic, deps }).catch((e) => {
      console.warn("[agent-network] live answer failed:", String(e?.message || e).slice(0, 120));
      return null;
    });
  }
  const { data: row, error } = await edu().from("agent_messages").insert({
    from_user: fromId, to_user: target.id, kind, subject, topic, body: screened.question,
    ...(answered?.answer ? { answer: answered.answer, answer_source: answered.fromTaught ? "taught" : "not_taught", status: "answered", answered_at: new Date().toISOString() } : {}),
  }).select("id, status").single();
  if (error) throw new Error(error.message);

  const asker = `${first(me?.full_name, me?.username)}'s agent ${myAgent?.agent_name || ""}`.trim();
  await notifyUser({
    userId: target.id, type: "agent_message",
    title: kind === "suggestion" ? `💡 ${asker} left your agent an idea` : answered ? `💬 ${asker} asked your agent — it answered` : `💬 ${asker} asked your agent something`,
    content: screened.question.slice(0, 140), relatedId: row.id, link: "/app?tab=agent",
  }).catch(() => {});

  return {
    messageId: row.id, kind, to: { userId: target.id, name: first(target.full_name, target.username), username: `@${target.username}` },
    delivered: answered?.answer ? "answered_now" : online ? "delivered" : "left_in_inbox",
    ...(answered?.answer ? { answer: answered.answer, fromTaught: answered.fromTaught, agent: `${answered.agentEmoji} ${answered.agentName}` } : {}),
  };
}

/** Messages to my agent (and answers to my agent's questions). */
export async function inbox(userId, { markRead = true, limit = 20 } = {}) {
  const [{ data: incoming }, { data: answers }] = await Promise.all([
    edu().from("agent_messages").select("*").eq("to_user", userId).order("created_at", { ascending: false }).limit(limit),
    edu().from("agent_messages").select("*").eq("from_user", userId).not("answer", "is", null).is("answer_read_at", null).order("answered_at", { ascending: false }).limit(10),
  ]);
  const people = [...new Set([...(incoming || []).map((m) => m.from_user), ...(answers || []).map((m) => m.to_user)])];
  const [{ data: users }, { data: agents }] = people.length ? await Promise.all([
    db.from("users").select("id, full_name, username").in("id", people),
    db.from("user_agents").select("user_id, agent_name, agent_emoji").in("user_id", people),
  ]) : [{ data: [] }, { data: [] }];
  const U = new Map((users || []).map((u) => [u.id, u])), A = new Map((agents || []).map((a) => [a.user_id, a]));
  const who = (id) => ({ userId: id, name: first(U.get(id)?.full_name, U.get(id)?.username), username: `@${U.get(id)?.username || ""}`, agent: `${A.get(id)?.agent_emoji || "🤖"} ${A.get(id)?.agent_name || "Agent"}` });
  const out = {
    incoming: (incoming || []).map((m) => ({ id: m.id, kind: m.kind, from: who(m.from_user), subject: m.subject, topic: m.topic, message: m.body,
      status: m.status, myAgentAnswered: m.answer || null, at: m.created_at, unread: !m.read_at })),
    answersToMe: (answers || []).map((m) => ({ id: m.id, to: who(m.to_user), question: m.body, answer: m.answer, fromTaught: m.answer_source === "taught", at: m.answered_at })),
  };
  if (markRead) {
    const ids = [...(incoming || []).filter((m) => !m.read_at).map((m) => m.id)];
    const now = new Date().toISOString();
    if (ids.length) await edu().from("agent_messages").update({ read_at: now, ...{} }).in("id", ids);
    // The asker's own "seen" mark. It used to share read_at with the recipient,
    // so the recipient opening their inbox hid the answer from the asker for good.
    if ((answers || []).length) await edu().from("agent_messages").update({ answer_read_at: now }).in("id", answers.map((m) => m.id)).eq("from_user", userId);
  }
  return out;
}

/** My agent answers a question that waited in its inbox (the learner helped write it). */
export async function replyToAgent(userId, messageId, text) {
  const { data: m } = await edu().from("agent_messages").select("*").eq("id", messageId).eq("to_user", userId).maybeSingle();
  if (!m) throw fail("That message isn't in your agent's inbox.", 404);
  if (m.kind !== "consult") throw fail("That one was an idea, not a question — nothing to answer.");
  // Already answered (by the agent, live): don't overwrite what the asker may have read.
  if (m.answer) throw fail("Your agent already answered that one.", 409);
  const s = screenMessage(text, { min: 2, max: MESSAGE_LIMITS.ANSWER_MAX_CHARS });
  if (!s.ok) throw fail(SCREEN_REASON[s.reason] || "That reply can't be sent.");
  await edu().from("agent_messages").update({ answer: s.question, answer_source: "learner", status: "answered", answered_at: new Date().toISOString(), answer_read_at: null }).eq("id", m.id);
  const { data: me } = await db.from("users").select("full_name, username").eq("id", userId).maybeSingle();
  await notifyUser({ userId: m.from_user, type: "agent_message", title: `💬 ${first(me?.full_name, me?.username)}'s agent answered your agent`,
    content: s.question.slice(0, 140), relatedId: m.id, link: "/app?tab=agent" }).catch(() => {});
  return { replied: m.id };
}

/** The peer consult, for real: up to two ONLINE agents that will take messages answer now. */
export async function consultOnlineAgents(userId, question, { topic = null, deps, limit = 2 } = {}) {
  const screened = screenMessage(question);
  if (!screened.ok) return { consulted: 0, replies: [], note: screened.reason };
  const online = [...(await onlineIds())].filter((id) => id !== userId).slice(0, 60);
  if (!online.length) return { consulted: 0, replies: [], note: "nobody_online" };
  const blocked = await blockedWith(userId);
  const { data: users } = await db.from("users").select("id, full_name, username, role, school_name, deactivated_at, deleted_at").in("id", online);
  const picks = [];
  for (const u of (users || []).sort(() => Math.random() - 0.5)) {
    if (picks.length >= limit || blocked.has(u.id) || u.role !== "student") continue;
    try { await checkMessageable(userId, u); await checkLimits(userId, u.id); picks.push(u); } catch { /* not this one */ }
  }
  const replies = [];
  for (const u of picks) {
    const a = await answerNow({ asker: userId, target: u, question: screened.question, topic, deps }).catch(() => null);
    if (!a?.answer) continue;
    await edu().from("agent_messages").insert({ from_user: userId, to_user: u.id, kind: "consult", topic, body: screened.question,
      answer: a.answer, answer_source: a.fromTaught ? "taught" : "not_taught", status: "answered", answered_at: new Date().toISOString() });
    replies.push({ agent: a.agentName, emoji: a.agentEmoji, learner: first(u.full_name, u.username), username: `@${u.username}`, reply: a.answer, fromTaught: a.fromTaught });
  }
  return { consulted: replies.length, replies, live: true };
}

/** One line for the Agent Chat prompt, so the agent brings waiting messages up. */
export async function inboxBrief(userId) {
  const [{ count: waiting }, { count: answers }] = await Promise.all([
    edu().from("agent_messages").select("id", { count: "exact", head: true }).eq("to_user", userId).is("read_at", null),
    edu().from("agent_messages").select("id", { count: "exact", head: true }).eq("from_user", userId).not("answer", "is", null).is("answer_read_at", null),
  ]);
  if (!waiting && !answers) return "";
  return `\n\n## Your agent inbox\n${waiting ? `${waiting} message${waiting === 1 ? "" : "s"} from other learners' agents waiting. ` : ""}` +
    `${answers ? `${answers} answer${answers === 1 ? "" : "s"} to your earlier questions arrived. ` : ""}` +
    "Mention this briefly when it fits, and open them with check_agent_inbox if the learner wants.";
}

export { presenceOf };
