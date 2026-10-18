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
import { inQuietHours } from "./cycle.js";

const edu = () => db.schema("edu");
export const DELIVERY = Object.freeze({
  SOURCE_CHAT_DAYS: 7,
  BUSY_MS: 10 * 60 * 1000,
  DAILY: 1,
  WINDOW_MS: 24 * 3600 * 1000,
});

const DOING = {
  task: "I'll add it to your tasks",
  practice: "a short focused practice",
  session: "I'll check in with you then",
  goal: "I'll add it to your goals",
};

/** The message the learner reads — code-written from the proposal. */
export function proactiveMessage(p) {
  const why = String(p.rationale || "").trim().replace(/\s+/g, " ");
  const when = p.kind === "session" && p.payload?.scheduledAt
    ? ` (${new Date(p.payload.scheduledAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })})` : "";
  return `One thing I noticed: ${why}\n\nI've got this ready — **${p.title}**${when}: ${DOING[p.kind] || "ready when you are"}. Want me to go ahead?`;
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
  if (!ignoreQuietHours && inQuietHours(now)) return { posted: false, reason: "quiet_hours" };
  const since = new Date(now.getTime() - DELIVERY.WINDOW_MS).toISOString();
  const { count: today } = await edu().from("agent_proposals").select("id", { count: "exact", head: true })
    .eq("user_id", userId).gte("posted_at", since);
  if ((today ?? 0) >= DELIVERY.DAILY) return { posted: false, reason: "daily_cap" };

  const { data: p } = await edu().from("agent_proposals")
    .select("id, kind, title, rationale, payload, source_chat_id, expires_at")
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

  const meta = { proposal: { id: p.id, kind: p.kind, title: p.title, status: "proposed" } };
  const { data: msg, error } = await db.from("chat_messages")
    .insert({ session_id: target.chatId, user_id: userId, role: "agent", text: proactiveMessage(p), meta })
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
