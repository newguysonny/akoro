// Agent tools over the learner's own Agent Chat history: list their chats,
// read one, and drop a message into one. Every query is scoped to the
// learner (user_id) — a chatId from anywhere else simply isn't found.
import db from "../../db.js";
import { notifyUser } from "../notify.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clip = (text, max) => { const s = String(text ?? ""); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

/** The chat id if it is one of this learner's chats, else null. */
export async function ownedChatId(userId, chatId) {
  if (!userId || typeof chatId !== "string" || !UUID.test(chatId.trim())) return null;
  const { data } = await db.from("chat_sessions").select("id").eq("id", chatId.trim()).eq("user_id", userId).maybeSingle();
  return data?.id ?? null;
}

export async function listChats(userId, { search = "", limit = 15, currentChatId = null } = {}) {
  let q = db.from("chat_sessions").select("id, title, created_at, last_message_at")
    .eq("user_id", userId).order("last_message_at", { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 15, 1), 30));
  const term = String(search || "").trim().replace(/[%_,()]/g, " ").slice(0, 80);
  if (term) q = q.ilike("title", `%${term}%`);
  const { data, error } = await q;
  if (error) throw new Error("Could not load your chats");
  return {
    chats: (data ?? []).map((c) => ({
      chatId: c.id, title: c.title, lastMessageAt: c.last_message_at, createdAt: c.created_at,
      isThisChat: Boolean(currentChatId && c.id === currentChatId),
    })),
    note: "Use chatId with read_chat to read one, post_to_chat to drop a message into one, or schedule_chat_follow_up (where='chat') to send one later.",
  };
}

export async function readChat(userId, chatId, { limit = 30 } = {}) {
  const id = await ownedChatId(userId, chatId);
  if (!id) return { error: "That chat wasn't found among your chats — call list_chats for a valid chatId." };
  const { data: session } = await db.from("chat_sessions").select("id, title, last_message_at").eq("id", id).maybeSingle();
  const n = Math.min(Math.max(Number(limit) || 30, 1), 60);
  const { data, error } = await db.from("chat_messages").select("role, text, created_at")
    .eq("session_id", id).eq("user_id", userId).order("created_at", { ascending: false }).limit(n);
  if (error) return { error: "Could not read that chat" };
  const messages = (data ?? []).reverse().map((m) => ({ from: m.role === "agent" ? "agent" : "learner", text: clip(m.text, 1200), at: m.created_at }));
  return { chatId: id, title: session?.title ?? "Chat", messages, shown: messages.length, note: messages.length === n ? `Showing the latest ${n} messages.` : undefined };
}

/** Post an agent message into one of the learner's chats, now. */
export async function postToChat(userId, { chatId, message, currentChatId = null }) {
  const text = String(message ?? "").trim();
  if (!text) return { error: "message is required" };
  if (text.length > 4000) return { error: "message must be at most 4000 characters" };
  const id = await ownedChatId(userId, chatId);
  if (!id) return { error: "That chat wasn't found among your chats — call list_chats for a valid chatId." };
  if (currentChatId && id === currentChatId) {
    return { error: "That is this chat — just say it in your reply instead of posting it." };
  }
  const now = new Date().toISOString();
  const { data: row, error } = await db.from("chat_messages")
    .insert({ session_id: id, user_id: userId, role: "agent", text }).select("id").single();
  if (error) return { error: "Could not post the message" };
  await db.from("chat_sessions").update({ updated_at: now, last_message_at: now }).eq("id", id).eq("user_id", userId).then(() => {}, () => {});
  const { data: session } = await db.from("chat_sessions").select("title").eq("id", id).maybeSingle();
  try {
    await notifyUser({
      userId, type: "agent_follow_up", title: session?.title || "New message from your agent",
      content: clip(text, 280), relatedId: id, link: `/app?tab=agent&sessionId=${encodeURIComponent(id)}`,
    });
  } catch { /* the message itself is saved */ }
  try { global.io?.to(`user:${userId}`).emit("chat_follow_up_ready", { sessionId: id, title: session?.title }); } catch { /* best effort */ }
  return { posted: true, chatId: id, messageId: row.id, title: session?.title ?? "Chat" };
}
