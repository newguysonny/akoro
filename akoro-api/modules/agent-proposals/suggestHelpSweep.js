/**
 * modules/agent-proposals/suggestHelpSweep.js — the nightly suggest_help sweep.
 *
 * suggest_help as an in-turn tool never fires (measured 2026-11-14: zero
 * organic filings; the model always prefers doing the work in the turn). So
 * filing becomes a dedicated pass, like the other producers that actually
 * fill the inbox: once a night, in the same window as the planner cycle and
 * the ideas (21:00–22:00 Africa/Lagos), this sweep reviews each consenting
 * learner's chats from the last 24 hours and asks the model one question —
 * is there ONE thing here worth opening a new chat about?
 *
 * A hit lands as a NEW CHAT (suggestHelp.js), never in the Suggestions list:
 * suggest_help is the priority channel. Gates mirror the planner's consent:
 * autonomy enabled + proactive on; at most one filing per learner per night;
 * learners who already got a suggest-help chat in the last 20 hours are
 * skipped; duplicates are refused by the delivery itself.
 */
import db from "../../db.js";
import { llmComplete } from "../../lib/aiModel.js";
import { untrusted, UNTRUSTED_SYSTEM_RULE } from "../../lib/untrusted.js";
import { openSuggestHelpChat, suggestHelpChatSince, SUGGEST_HELP_KINDS } from "./suggestHelp.js";

const DAY_MS = 24 * 3600 * 1000;
const MAX_LEARNERS = 25;
const MAX_SESSIONS = 3;
const MAX_MESSAGES = 16;

export const SUGGEST_HELP_SWEEP_SYSTEM = [
  "You review a learner's recent chats with their study agent and decide whether ONE thing is worth opening a brand-new chat about — a special, priority suggestion that will appear as its own conversation at the top of their chats.",
  "File ONLY when you spot one of these in what actually came up:",
  "1. Something noticed in passing during another job — a weak topic, a misconception, or a pattern in their work.",
  "2. Something valuable but not for now — a future exam, a next-term topic, a follow-up that belongs later.",
  "3. Something the learner put off, declined for now, or keeps coming back to — a need that persists.",
  "4. A goal worth aiming at, suggested by their progress or plans.",
  "Do NOT file for: anything the learner already asked the agent to do (it was handled in the chat), small talk, anything the conversation itself already resolved, or anything vague.",
  "Most nights there is nothing — returning {\"file\": false} is the normal, correct answer. Never invent a need the chat does not show.",
  "When you file, the title is concise and action-led (max 120 characters) and the rationale is one or two sentences grounded in what the learner actually said or did (max 280 characters), written as the agent speaking directly to the learner — 'you said…', 'your exams…' — never about them in the third person.",
  UNTRUSTED_SYSTEM_RULE,
  "Reply with ONLY this JSON: {\"file\": true, \"kind\": \"task\" | \"goal\" | \"conversation\", \"title\": \"...\", \"rationale\": \"...\"} or {\"file\": false}.",
].join("\n");

/** Parse the model's reply. Pure — unit-tested. → { kind, title, rationale } | null */
export function parseSweepVerdict(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  let v;
  try { v = JSON.parse(m[0]); } catch { return null; }
  if (!v || v.file !== true) return null;
  const title = String(v.title || "").trim().slice(0, 140);
  const rationale = String(v.rationale || "").trim().slice(0, 400);
  if (title.length < 8 || rationale.length < 12) return null;
  return { kind: SUGGEST_HELP_KINDS.includes(v.kind) ? v.kind : "conversation", title, rationale };
}

/** Today's conversations as one transcript, or null when there is too little learner signal. */
async function transcriptFor(userId, sinceIso) {
  const { data: sessions } = await db.from("chat_sessions").select("id, title")
    .eq("user_id", userId).gte("last_message_at", sinceIso)
    .order("last_message_at", { ascending: false }).limit(MAX_SESSIONS);
  if (!sessions?.length) return null;
  const blocks = [];
  let learnerChars = 0;
  for (const s of sessions) {
    const { data: msgs } = await db.from("chat_messages").select("role, text")
      .eq("session_id", s.id).eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(MAX_MESSAGES);
    const lines = (msgs ?? []).reverse().map((m) => {
      const text = String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 280);
      if (m.role === "user") learnerChars += text.length;
      return `${m.role === "user" ? "Learner" : "Agent"}: ${text}`;
    }).filter((l) => l.length > 10);
    if (lines.length) blocks.push(`— Chat: ${String(s.title || "Untitled").slice(0, 60)} —\n${lines.join("\n")}`);
  }
  if (!blocks.length || learnerChars < 60) return null;
  return blocks.join("\n\n");
}

/** One learner's pass. → "filed" | "none" | "duplicate" | "paced" | "quiet-day" */
export async function reviewLearnerChats(userId, { now = new Date() } = {}) {
  if (await suggestHelpChatSince(userId, new Date(now.getTime() - 20 * 3600 * 1000).toISOString())) return "paced";
  const transcript = await transcriptFor(userId, new Date(now.getTime() - DAY_MS).toISOString());
  if (!transcript) return "quiet-day";
  const reply = await llmComplete(
    `The learner's chats from the last 24 hours:\n\n${untrusted(transcript, { source: "learner chat transcript", limit: 9000 })}`,
    { system: SUGGEST_HELP_SWEEP_SYSTEM, maxTokens: 400, temperature: 0.3, userId, feature: "suggest_help_sweep" },
  );
  const verdict = parseSweepVerdict(reply);
  if (!verdict) return "none";
  const out = await openSuggestHelpChat(userId, verdict);
  if (out.delivered) return "filed";
  return out.duplicate ? "duplicate" : "none";
}

/**
 * The nightly pass. Candidates: autonomy on + proactive on (the planner's
 * consent), with chat activity in the last 24 hours. → counts per outcome.
 */
export async function sweepSuggestHelpChats({ limit = MAX_LEARNERS, now = new Date() } = {}) {
  const edu = db.schema("edu");
  const { data: rows } = await edu.from("learner_agent_autonomy")
    .select("user_id, proactive").eq("enabled", true).limit(200);
  const consenting = (rows ?? []).filter((r) => r.proactive !== false).map((r) => r.user_id);
  if (!consenting.length) return { filed: 0, reviewed: 0 };

  const sinceIso = new Date(now.getTime() - DAY_MS).toISOString();
  const { data: active } = await db.from("chat_sessions").select("user_id")
    .in("user_id", consenting).gte("last_message_at", sinceIso).limit(500);
  const due = [...new Set((active ?? []).map((a) => a.user_id))].slice(0, limit);

  const counts = { filed: 0, reviewed: 0 };
  for (const userId of due) {
    try {
      const r = await reviewLearnerChats(userId, { now });
      counts.reviewed += 1;
      if (r === "filed") counts.filed += 1;
    } catch (e) {
      console.warn("[suggest-help-sweep] learner pass failed:", userId, e.message);
    }
  }
  return counts;
}
