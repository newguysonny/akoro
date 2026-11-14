/**
 * modules/agent-proposals/suggestHelp.js — suggest_help delivery.
 *
 * A suggest_help filing is a SPECIAL suggestion (Matt's rule, 2026-11-14): it
 * does not go to the Suggestions list. It lands as a NEW CHAT at the top of
 * the learner's chats — the agent opens a separate conversation whose first
 * message is the idea, so it gets priority over list items. Ordinary
 * suggestions (the planner, the repeated-computation sweep) still land in the
 * Suggestions list; only suggest_help takes this channel.
 *
 * The opening message is written by code from the filing's facts (title +
 * rationale), in the same shape as the planner's proactive chat posts
 * (autonomy/deliver.js). Nothing is executed — the learner replies in the new
 * chat if they want it.
 */
import db from "../../db.js";
import { notifyUser } from "../notify.js";
import { appLink } from "../../lib/urls.js";
import { quietOf, inQuiet } from "../autonomy/quietHours.js";
// inbox.js is imported lazily inside the delivery: it pulls the planner's
// delivery graph, and this module is also loaded by the chat handler.

export const SUGGEST_HELP_KINDS = ["task", "goal", "conversation"];

/** The opening agent message of a suggest-help chat. Pure — unit-tested. */
export function suggestHelpMessage({ kind, title, rationale }) {
  const why = String(rationale || "").trim().replace(/\s+/g, " ");
  const t = String(title || "").trim();
  const head = why ? `One thing I noticed: ${why}\n\n` : "";
  if (kind === "goal") return `${head}**${t}** — want me to make this a goal and keep track of what gets you there? Just reply here and we'll set it up.`;
  if (kind === "task") return `${head}I've got this ready — **${t}**. Want me to set it up? Reply here and I'll do it.`;
  return `${head}**${t}** — want to talk it through here? Just reply and we'll start.`;
}

/** Titles this channel has already opened chats for recently (7 days). */
async function recentChatTitles(userId) {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data } = await db.from("chat_sessions").select("title, created_at")
    .eq("user_id", userId).gte("created_at", since).limit(100);
  return data ?? [];
}

/**
 * Open the new chat for one suggest_help filing.
 * → { delivered: true, chatId, messageId } | { delivered: false, duplicate: true }
 * Dedupe: an idea already open in the Suggestions inbox, or a chat with the
 * same title opened in the last 7 days, is not filed twice.
 */
export async function openSuggestHelpChat(userId, { kind, title, rationale } = {}) {
  const k = SUGGEST_HELP_KINDS.includes(kind) ? kind : "conversation";
  const t = String(title || "").trim().slice(0, 140);
  const why = String(rationale || "").trim().slice(0, 400);
  if (!t) return { delivered: false, error: "title_required" };

  const { openTitles, normalizeTitle } = await import("./inbox.js");
  const key = normalizeTitle(t);
  if ((await openTitles(userId)).has(key)) return { delivered: false, duplicate: true };
  const recent = await recentChatTitles(userId);
  if (recent.some((s) => normalizeTitle(s.title || "") === key)) return { delivered: false, duplicate: true };

  const now = new Date();
  const { data: session, error: sErr } = await db.from("chat_sessions")
    .insert({ user_id: userId, title: t.slice(0, 80) }).select("id").single();
  if (sErr || !session) return { delivered: false, error: sErr?.message || "session_failed" };

  const text = suggestHelpMessage({ kind: k, title: t, rationale: why });
  const meta = { suggestHelp: { kind: k, title: t } };
  const { data: msg, error: mErr } = await db.from("chat_messages")
    .insert({ session_id: session.id, user_id: userId, role: "agent", text, meta })
    .select("id").single();
  if (mErr || !msg) return { delivered: false, error: mErr?.message || "message_failed" };
  await db.from("chat_sessions").update({ last_message_at: now.toISOString() }).eq("id", session.id).eq("user_id", userId);

  // Live surfaces: the chat list hears about the new chat immediately.
  try {
    global.io?.to(`user:${userId}`).emit("chat_follow_up_ready", {
      sessionId: session.id, title: t,
      message: { id: msg.id, role: "agent", text, meta, created_at: now.toISOString() },
    });
  } catch { /* the chat is in the list regardless */ }

  // The push respects the learner's quiet hours; the chat itself is already
  // the latest in their list either way.
  try {
    const { data: auto } = await db.schema("edu").from("learner_agent_autonomy")
      .select("quiet_start, quiet_end, time_zone").eq("user_id", userId).maybeSingle();
    if (!inQuiet(now, quietOf(auto || {}))) {
      await notifyUser({
        userId, type: "agent_suggestion_chat", relatedId: session.id,
        link: appLink(`tab=agent&sessionId=${encodeURIComponent(session.id)}`),
        title: "Your agent opened a chat",
        content: t.slice(0, 200),
      });
    }
  } catch { /* notifications are best-effort */ }

  return { delivered: true, chatId: session.id, messageId: msg.id };
}

/** Has this channel opened any chat for the learner since `since`? (sweep pacing) */
export async function suggestHelpChatSince(userId, since) {
  const { data } = await db.from("chat_sessions").select("id, created_at")
    .eq("user_id", userId).gte("created_at", since).limit(50);
  if (!data?.length) return false;
  const ids = new Set(data.map((s) => s.id));
  const { data: msgs } = await db.from("chat_messages").select("session_id, meta")
    .eq("user_id", userId).in("session_id", [...ids]).limit(50);
  return (msgs ?? []).some((m) => m.meta?.suggestHelp);
}
