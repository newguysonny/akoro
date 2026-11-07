/**
 * agent-network/friends.js — Phase 21: what the learner's tap on an agent
 * message card does (agent_proposals kinds agent_friend / agent_reply).
 *
 *   acceptFriend(userId, messageId)       the two learners' agents become friends; the sender is told
 *   sendApprovedReply(userId, messageId, draft)  the drafted reply goes to the other agent
 *   declineMessage(userId, messageId)     "not now" — the sender's agent is told politely
 *
 * Every action re-checks the message is THIS learner's (to_user) and still waiting.
 */
import db from "../../db.js";
import { notifyUser } from "../notify.js";
import { screenMessage, MESSAGE_LIMITS } from "./messaging.js";

const edu = () => db.schema("edu");
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const first = (full, username) => String(full || "").trim().split(/\s+/)[0] || username || "a learner";
const now = () => new Date().toISOString();

async function waiting(userId, messageId) {
  const { data: m } = await edu().from("agent_messages").select("*").eq("id", messageId).eq("to_user", userId).maybeSingle();
  if (!m) throw fail("That message isn't in your agent's inbox any more.", 404);
  if (m.status === "answered" || m.status === "declined") throw fail("That message was already answered.", 409);
  return m;
}
async function nameOf(userId) {
  const { data } = await db.from("users").select("full_name, username").eq("id", userId).maybeSingle();
  return first(data?.full_name, data?.username);
}

/** Are these two learners' agents friends? */
export async function areFriends(a, b) {
  const [x, y] = [a, b].sort();
  const { data } = await edu().from("agent_friends").select("status").eq("user_a", x).eq("user_b", y).maybeSingle();
  return data?.status === "accepted";
}

export async function acceptFriend(userId, messageId) {
  const m = await waiting(userId, messageId);
  if (m.kind !== "friend_request") throw fail("That message isn't a friend request.");
  const [a, b] = [m.from_user, userId].sort();
  const { error } = await edu().from("agent_friends").upsert(
    { user_a: a, user_b: b, requested_by: m.from_user, status: "accepted", decided_at: now() }, { onConflict: "user_a,user_b" });
  if (error) throw new Error(error.message);
  const me = await nameOf(userId);
  await edu().from("agent_messages").update({ answer: `${me} said yes — you're friends now!`, answer_source: "learner", status: "answered", answered_at: now(), answer_read_at: null }).eq("id", m.id);
  await notifyUser({ userId: m.from_user, type: "agent_message", title: `🤝 ${me} accepted — you're friends now`, content: `${me}'s agent and yours can chat and study together.`, relatedId: m.id, link: "/app?tab=agent" }).catch(() => {});
  return { friends: true, with: await nameOf(m.from_user) };
}

export async function sendApprovedReply(userId, messageId, draft) {
  const m = await waiting(userId, messageId);
  const s = screenMessage(draft, { min: 2, max: MESSAGE_LIMITS.ANSWER_MAX_CHARS });
  if (!s.ok) throw fail("That reply can't be sent — say it in your own words and I'll send it.");
  await edu().from("agent_messages").update({ answer: s.question, answer_source: "learner", status: "answered", answered_at: now(), answer_read_at: null }).eq("id", m.id);
  const me = await nameOf(userId);
  await notifyUser({ userId: m.from_user, type: "agent_message", title: `💬 ${me}'s agent replied to your agent`, content: s.question.slice(0, 140), relatedId: m.id, link: "/app?tab=agent" }).catch(() => {});
  if (m.origin === "agent") await import("./outreach.js").then((o) => o.reportOutreachAnswer(m.id)).catch(() => {});
  return { replied: true, to: await nameOf(m.from_user), text: s.question };
}

export async function declineMessage(userId, messageId) {
  const m = await waiting(userId, messageId).catch(() => null);
  if (!m) return { declined: false };
  if (m.kind === "friend_request") {
    const [a, b] = [m.from_user, userId].sort();
    await edu().from("agent_friends").upsert({ user_a: a, user_b: b, requested_by: m.from_user, status: "declined", decided_at: now() }, { onConflict: "user_a,user_b" });
  }
  await edu().from("agent_messages").update({ status: "declined", answer: m.kind === "friend_request" ? "Not right now." : null, answered_at: now(), answer_read_at: null }).eq("id", m.id);
  return { declined: true };
}
