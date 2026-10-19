/**
 * modules/autonomy/deliver.js — a planner proposal posted into the learner's
 * chat as an agent message with reply buttons (Grand Plan §7.16.3, D49):
 *
 *   which chat   the chat the idea came from, if used in the last 7 days;
 *                else their latest chat; else a new one titled from the idea
 *   when         not in quiet hours; not while they are mid-conversation
 *                (a message in the last 10 min — a later sweep posts it);
 *                at most one proactive message a day
 *   how          an agent message whose meta carries the proposal; the same
 *                proposal stays in Suggestions; a decision in either place
 *                updates both (markPostedDecision)
 *
 * The message is written by code from the proposal (facts from the harness);
 * nothing is executed until the learner taps.
 */
import db from "../../db.js";
import { notifyUser } from "../notify.js";
import { inQuiet, quietOf } from "./quietHours.js";
import { READY } from "./readyKinds.js";
import { collectMaterials, materialsFrom } from "../adaptive-learning/chat-materials.js";

const edu = () => db.schema("edu");
export const DELIVERY = Object.freeze({
  SOURCE_CHAT_DAYS: 7,
  BUSY_MS: 10 * 60 * 1000,
  DAILY: 1,
  WINDOW_MS: 24 * 3600 * 1000,
});

/** The message the learner reads — code-written from the proposal (what "Yes" does: readyKinds READY). */
export function proactiveMessage(p, { timeZone = "Africa/Lagos" } = {}) {
  const why = String(p.rationale || "").trim().replace(/\s+/g, " ");
  const when = p.kind === "session" && p.payload?.scheduledAt
    ? ` (${new Date(p.payload.scheduledAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone })})` : "";
  if (p.kind === "goal" && p.payload?.implied) return `One thing I noticed: ${why}\n\nWant me to make **${p.title}** a goal? I'll keep track of what gets you there.`;
  return `One thing I noticed: ${why}\n\nI've got this ready — **${p.title}**${when}: ${READY[p.kind]?.doing || "ready when you are"}. Want me to go ahead?`;
}

/** What the chat card carries: the buttons' words and the prepared preview (facts from code). */
export function proposalMeta(p) {
  const r = READY[p.kind] || {};
  return { id: p.id, kind: p.kind, title: p.title, status: "proposed",
    yes: p.kind === "goal" && p.payload?.implied ? "Make it a goal" : r.yes || "Yes, go ahead", ...(r.cost ? { cost: r.cost } : {}),
    ...(p.preview ? { preview: p.preview } : {}) };
}

/** Pick the chat by the D49 rule. → { chatId, created } | null */
export async function chatFor(userId, sourceChatId, title) {
  const since = new Date(Date.now() - DELIVERY.SOURCE_CHAT_DAYS * 864e5).toISOString();
  if (sourceChatId) {
    const { data } = await db.from("chat_sessions").select("id, last_message_at")
      .eq("id", sourceChatId).eq("user_id", userId).maybeSingle();
    if (data && data.last_message_at && data.last_message_at >= since) return { chatId: data.id, created: false, why: "source" };
  }
  const { data: latest } = await db.from("chat_sessions").select("id")
    .eq("user_id", userId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (latest) return { chatId: latest.id, created: false, why: "latest" };
  const { data: made, error } = await db.from("chat_sessions")
    .insert({ user_id: userId, title: String(title || "From your agent").slice(0, 80) }).select("id").single();
  if (error || !made) return null;
  return { chatId: made.id, created: true, why: "new" };
}

/**
 * Post this learner's newest unposted proposal, if the rules allow now.
 * → { posted: true, proposalId, chatId, why } | { posted: false, reason }
 * `now` / `ignoreQuietHours` are the gate's levers (the rules stay the same).
 */
export async function deliverProactive(userId, { now = new Date(), ignoreQuietHours = false } = {}) {
  // Their consent and their own quiet hours, in their time zone (§7.16.7).
  const { data: auto } = await edu().from("learner_agent_autonomy").select("enabled, proactive, quiet_start, quiet_end, time_zone").eq("user_id", userId).maybeSingle();
  // Instructors have no Online switch: their class suggestions are on unless they turned them off.
  let allowed = !!auto?.enabled && auto.proactive !== false;
  if (!allowed && auto?.proactive !== false) {
    const { data: u } = await db.from("users").select("role").eq("id", userId).maybeSingle();
    allowed = u?.role === "instructor";
  }
  if (!allowed) return { posted: false, reason: "consent_off" };
  const quiet = quietOf(auto);
  if (!ignoreQuietHours && inQuiet(now, quiet)) return { posted: false, reason: "quiet_hours" };
  const since = new Date(now.getTime() - DELIVERY.WINDOW_MS).toISOString();
  const { count: today } = await edu().from("agent_proposals").select("id", { count: "exact", head: true })
    .eq("user_id", userId).gte("posted_at", since);
  if ((today ?? 0) >= DELIVERY.DAILY) return { posted: false, reason: "daily_cap" };

  const { data: p } = await edu().from("agent_proposals")
    .select("id, kind, title, rationale, payload, preview, source_chat_id, expires_at")
    .eq("user_id", userId).eq("status", "proposed").is("posted_at", null).gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!p) return { posted: false, reason: "nothing_to_post" };

  const target = await chatFor(userId, p.source_chat_id, p.title);
  if (!target) return { posted: false, reason: "no_chat" };
  if (!target.created) {
    const { data: last } = await db.from("chat_messages").select("created_at").eq("session_id", target.chatId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last && now.getTime() - new Date(last.created_at).getTime() < DELIVERY.BUSY_MS) return { posted: false, reason: "chat_busy" };
  }

  // Claim first: one post per proposal, whoever gets here first.
  const { data: claimed } = await edu().from("agent_proposals")
    .update({ posted_at: now.toISOString(), chat_session_id: target.chatId })
    .eq("id", p.id).is("posted_at", null).eq("status", "proposed").select("id").maybeSingle();
  if (!claimed) return { posted: false, reason: "already_posted" };

  const meta = { proposal: proposalMeta(p) };
  const { data: msg, error } = await db.from("chat_messages")
    .insert({ session_id: target.chatId, user_id: userId, role: "agent", text: proactiveMessage(p, { timeZone: quiet.timeZone }), meta })
    .select("id").single();
  if (error || !msg) {
    await edu().from("agent_proposals").update({ posted_at: null, chat_session_id: null }).eq("id", p.id);
    return { posted: false, reason: "write_failed" };
  }
  await edu().from("agent_proposals").update({ chat_message_id: msg.id }).eq("id", p.id);
  await db.from("chat_sessions").update({ last_message_at: now.toISOString() }).eq("id", target.chatId).eq("user_id", userId);

  await notifyUser({
    userId, type: "agent_proposals", relatedId: p.id,
    link: `/app?tab=agent&sessionId=${encodeURIComponent(target.chatId)}`,
    title: "Your agent noticed something",
    content: String(p.title).slice(0, 200),
  }).catch(() => {});
  try { global.io?.to(`user:${userId}`).emit("chat_follow_up_ready", { sessionId: target.chatId, proposalId: p.id, title: p.title }); } catch { /* the notification links to it */ }
  return { posted: true, proposalId: p.id, chatId: target.chatId, messageId: msg.id, why: target.why };
}

/** A decision taken in either place shows on the chat message too. Never throws. */
export async function markPostedDecision(userId, proposalId, status) {
  try {
    const { data: p } = await edu().from("agent_proposals").select("chat_message_id").eq("id", proposalId).eq("user_id", userId).maybeSingle();
    if (!p?.chat_message_id) return;
    const { data: msg } = await db.from("chat_messages").select("meta").eq("id", p.chat_message_id).eq("user_id", userId).maybeSingle();
    if (!msg?.meta?.proposal) return;
    await db.from("chat_messages").update({ meta: { ...msg.meta, proposal: { ...msg.meta.proposal, status } } })
      .eq("id", p.chat_message_id).eq("user_id", userId);
  } catch { /* the inbox is the source of truth */ }
}

/** The sweep: learners with an unposted proposal from the last day get one try each. */
export async function deliverDue({ limit = 20 } = {}) {
  const since = new Date(Date.now() - DELIVERY.WINDOW_MS).toISOString();
  const { data } = await edu().from("agent_proposals").select("user_id")
    .eq("status", "proposed").is("posted_at", null).gte("created_at", since).limit(limit * 3);
  const users = [...new Set((data || []).map((r) => r.user_id))].slice(0, limit);
  let posted = 0;
  for (const u of users) {
    const r = await deliverProactive(u).catch(() => ({ posted: false }));
    if (r.posted) posted++;
  }
  return { checked: users.length, posted };
}

/**
 * After Yes (§7.16.2 step 6, "Report"): the result in the same thread — what
 * was done, and the thing itself to open (built from ids, never prose).
 * → { text, meta } | null (nothing to say: a follow-up continues as a chat turn)
 */
export function reportFor(p, result = {}) {
  const t = `**${String(result.title || p.title || "").slice(0, 120)}**`;
  const pl = p.payload || {};
  switch (p.kind) {
    case "task": case "practice": case "goal_nudge":
      return { text: `Done — ${t} is in your tasks.` };
    case "goal":
      return { text: `Done — ${t} is one of your goals now. I'll keep an eye on it with you.` };
    case "session":
      return { text: `Done — I'll check in with you${result.scheduledAt ? ` on ${new Date(result.scheduledAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: result.timeZone || "Africa/Lagos" })}` : ""}.` };
    case "quiz_from_records":
      return { text: `Here's your quiz — it opens on your **${pl.recordName}**, and the reader writes the questions from the whole document.`,
        meta: { materials: collectMaterials([materialsFrom("search_my_library", { records: [{ recordId: pl.recordId, name: pl.recordName, tool: "quiz" }] })]) } };
    case "teach_weak_topic":
      return { text: `Tap **Teach me** and walk me through **${pl.topic}** — even roughly. I'll quiz you on it after.`,
        meta: { materials: collectMaterials([materialsFrom("get_weak_topics", { weak_topics: [{ topic: pl.topic, subject: pl.subject }] })]) } };
    case "study_plan":
      return result.sessionId ? { text: "Here's your plan from the syllabus — check it, and tap Approve when it looks right. Nothing is charged before that.", meta: { studyPrepSessionId: result.sessionId } } : null;
    case "revision_battle":
      return { text: `Your Agent Check on **${pl.topic}** is starting — ${result.placed || 5} questions, and your agent answers from what you taught it.`, meta: result.battleId ? { battle: { id: result.battleId, kind: "check" } } : undefined };
    case "fix_it":
      return { text: `Done — I've spread them over the next ${result.days || 3} days. They're in your tasks with their new dates.` };
    case "chase_missing":
      return { text: `Done — I've reminded ${result.reminded ?? 0} learner${result.reminded === 1 ? "" : "s"} to start ${t}.` };
    case "revise_low_scores": case "next_activity":
      return result.draft ? { text: `Here's the draft — ${t}. Check it, change anything, and tap Assign when it's right. Nothing is sent before that.`, meta: { previews: [result.draft], tools: ["prepare_activity"] } } : null;
    default:
      return null;
  }
}

/** Post the report into the chat the proposal was posted in. Never throws. */
export async function reportInChat(userId, p, result) {
  try {
    if (!p?.chat_session_id) return null;
    const r = reportFor(p, result);
    if (!r) return null;
    const meta = { ...(r.meta || {}), reportOf: p.id };
    const { data: msg } = await db.from("chat_messages")
      .insert({ session_id: p.chat_session_id, user_id: userId, role: "agent", text: r.text, meta }).select("id, session_id, text, meta, created_at").single();
    if (!msg) return null;
    await edu().from("agent_proposals").update({ report_message_id: msg.id }).eq("id", p.id).eq("user_id", userId);
    await db.from("chat_sessions").update({ last_message_at: new Date().toISOString() }).eq("id", p.chat_session_id).eq("user_id", userId);
    return msg;
  } catch { return null; }
}
