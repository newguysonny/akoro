// Agent tools over the learner's own Agent Chat history: list their chats,
// read one, and drop a message into one. Every query is scoped to the
// learner (user_id) — a chatId from anywhere else simply isn't found.
import db from "../../db.js";
import { notifyUser } from "../notify.js";
import { embedForSearch } from "../../lib/searchEmbedding.js";
import { appLink } from "../../lib/urls.js";

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

export async function readChat(userId, chatId, { limit = 30, around = null } = {}) {
  const id = await ownedChatId(userId, chatId);
  if (!id) return { error: "That chat wasn't found among your chats — call list_chats for a valid chatId." };
  const { data: session } = await db.from("chat_sessions").select("id, title, last_message_at").eq("id", id).maybeSingle();
  const n = Math.min(Math.max(Number(limit) || 30, 1), 60);
  const shape = (m) => ({ from: m.role === "agent" ? "agent" : "learner", text: clip(m.text, 1200), at: m.created_at });
  // `around` (a message time from search_chats): the messages either side of
  // that point, so a detail from deep in a long chat is reachable — not only
  // the latest page.
  const at = around && !Number.isNaN(Date.parse(around)) ? new Date(around).toISOString() : null;
  if (at) {
    const half = Math.max(1, Math.floor(n / 2));
    const [before, after] = await Promise.all([
      db.from("chat_messages").select("role, text, created_at").eq("session_id", id).eq("user_id", userId)
        .lte("created_at", at).order("created_at", { ascending: false }).limit(half),
      db.from("chat_messages").select("role, text, created_at").eq("session_id", id).eq("user_id", userId)
        .gt("created_at", at).order("created_at", { ascending: true }).limit(n - half),
    ]);
    if (before.error || after.error) return { error: "Could not read that chat" };
    const messages = [...(before.data ?? []).reverse(), ...(after.data ?? [])].map(shape);
    return { chatId: id, title: session?.title ?? "Chat", messages, shown: messages.length, note: `Showing the messages around ${at}.` };
  }
  const { data, error } = await db.from("chat_messages").select("role, text, created_at")
    .eq("session_id", id).eq("user_id", userId).order("created_at", { ascending: false }).limit(n);
  if (error) return { error: "Could not read that chat" };
  const messages = (data ?? []).reverse().map(shape);
  return { chatId: id, title: session?.title ?? "Chat", messages, shown: messages.length, note: messages.length === n ? `Showing the latest ${n} messages.` : undefined };
}

// ── search_chats: find the past chat(s) where something was discussed ──────
// Two signals, both scoped to the learner: (1) by MEANING over each chat's
// running summary (the same hybrid vector + keyword search as memory,
// match_learner_agent_memory); (2) by WORDS over the raw messages, for exact
// terms ("osmosis", "2019 Q14") a summary may have left out.
const STOP = new Set("about after again also because been before being between could does doing during each from have having into just more most much only other over said same should some such than that their them then there these they this those through very want what when where which while with would your what's didn't don't the and for you our".split(" "));

/** PURE: the distinctive words of a query (longest first, max 4), safe for ilike. */
export function searchTerms(query) {
  const words = String(query || "").toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, "")).filter((w) => w.length >= 4 && !STOP.has(w));
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 4);
}

/** PURE: ~`max` chars of `text` centred on the first term found. */
export function snippetAround(text, terms = [], max = 220) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const lower = t.toLowerCase();
  const hit = terms.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (hit == null) return `${t.slice(0, max - 1)}…`;
  const start = Math.max(0, hit - Math.floor(max / 3));
  const end = Math.min(t.length, start + max);
  return `${start > 0 ? "…" : ""}${t.slice(start, end)}${end < t.length ? "…" : ""}`;
}

/**
 * PURE: merge summary hits (by meaning, ranked) and message hits (by words)
 * into one list of chats, best first. A chat found both ways ranks highest.
 */
export function mergeChatHits({ summaries = [], messages = [], terms = [], limit = 6 }) {
  const byChat = new Map();
  const get = (id) => {
    if (!byChat.has(id)) byChat.set(id, { chatId: id, score: 0, matchedBy: new Set(), snippet: null, matchedAt: null, hits: 0 });
    return byChat.get(id);
  };
  summaries.forEach((row, i) => {
    if (!row?.chatId) return;
    const c = get(row.chatId);
    c.score += 1 / (1 + i);
    c.matchedBy.add("meaning");
    c.summary = snippetAround(row.content, terms);
  });
  for (const m of messages) {
    if (!m?.chatId) continue;
    const c = get(m.chatId);
    c.hits += 1;
    c.matchedBy.add("words");
    if (!c.snippet) { c.snippet = snippetAround(m.text, terms); c.matchedAt = m.at || null; }
  }
  // Found by meaning AND by the exact words is the strongest signal of all.
  for (const c of byChat.values()) c.score += Math.min(c.hits, 5) * 0.2 + (c.matchedBy.size === 2 ? 1 : 0);
  return [...byChat.values()].sort((a, b) => b.score - a.score).slice(0, limit)
    .map(({ chatId, matchedBy, snippet, summary, matchedAt, hits }) => ({
      chatId, matchedBy: [...matchedBy], snippet: snippet || summary || null,
      ...(matchedAt ? { matchedAt } : {}), ...(hits ? { messageHits: hits } : {}),
    }));
}

export async function searchChats(userId, { query, limit = 6, currentChatId = null } = {}) {
  const q = String(query || "").trim().slice(0, 300);
  if (q.length < 2) return { error: "What should I look for in your past chats?" };
  const terms = searchTerms(q);
  const n = Math.min(Math.max(Number(limit) || 6, 1), 10);

  const bySummary = (async () => {
    try {
      const embedding = await embedForSearch(q, { userId, feature: "chat_search" });
      const { data, error } = await db.rpc("match_learner_agent_memory", {
        p_user_id: userId, p_query_embedding: embedding, p_match_count: 8, p_query_text: q, p_subject: null,
      });
      if (error) throw error;
      return (data || []).filter((r) => r.memory_type === "conversation_summary" && r.chat_session_id)
        // a vector-only neighbour must clear the same floor as memory recall
        .filter((r) => r.vector_rank == null || Number(r.similarity ?? 0) >= 0.30)
        .map((r) => ({ chatId: r.chat_session_id, content: r.content }));
    } catch (e) { console.warn("[search_chats] summary search unavailable:", e?.message || e); return []; }
  })();

  const byWords = (async () => {
    if (!terms.length) return [];
    const or = terms.map((t) => `text.ilike.%${t.replace(/[%_,()]/g, " ")}%`).join(",");
    const { data, error } = await db.from("chat_messages").select("session_id, text, created_at")
      .eq("user_id", userId).or(or).order("created_at", { ascending: false }).limit(60);
    if (error) { console.warn("[search_chats] message search failed:", error.message); return []; }
    return (data || []).map((m) => ({ chatId: m.session_id, text: m.text, at: m.created_at }));
  })();

  const [summaries, messages] = await Promise.all([bySummary, byWords]);
  const merged = mergeChatHits({ summaries, messages, terms, limit: n });
  if (!merged.length) return { query: q, chats: [], note: "Nothing in your past chats matched. Try other words, or list_chats to browse by title." };

  const { data: sessions } = await db.from("chat_sessions").select("id, title, last_message_at")
    .eq("user_id", userId).in("id", merged.map((c) => c.chatId));
  const meta = new Map((sessions || []).map((s) => [s.id, s]));
  const chats = merged.filter((c) => meta.has(c.chatId)).map((c) => ({
    ...c, title: meta.get(c.chatId).title || "Chat", lastMessageAt: meta.get(c.chatId).last_message_at,
    isThisChat: Boolean(currentChatId && c.chatId === currentChatId),
  }));
  return {
    query: q, chats,
    note: "Read one with read_chat (pass around=matchedAt to land on the matching part). Past chats are what was SAID — check current records/tools before stating the learner's progress.",
  };
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
      content: clip(text, 280), relatedId: id, link: appLink(`tab=agent&sessionId=${encodeURIComponent(id)}`),
    });
  } catch { /* the message itself is saved */ }
  try { global.io?.to(`user:${userId}`).emit("chat_follow_up_ready", { sessionId: id, title: session?.title }); } catch { /* best effort */ }
  return { posted: true, chatId: id, messageId: row.id, title: session?.title ?? "Chat" };
}
