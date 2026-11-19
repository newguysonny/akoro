// The stored form of an Agent Chat turn: session titles, attachments, the
// compact history/summary helpers, the fast and basic transcript writers, the
// reply meta/trace merge, and the follow-up ideas saved on the reply.
//
// chat.js re-exports this module's public names, so every existing importer
// keeps using chat.js as the entry point.

import db from "../../../db.js";
import { openai } from "../../../lib/aiModel.js";
import { collectMaterials } from "./chat-materials.js";
import { loadDoctrine } from "../../agent-context/index.js";
export { loadDoctrine };
import { renderPdfToImages } from "../../../lib/pdfRender.js";
import {
  buildSuggestionMessages, notTaughtFrom, guideChip, uploadsFrom, uploadChip, shapeSuggestions,
} from "./chatSuggestions.js";
import { executeChatTool, learnerToolDefs } from "./tool-runtime.js";

export const sessionTitleFrom = (text) => {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 48 ? clean.slice(0, 48).trimEnd() + "…" : clean;
};

const MAX_FILES       = 4;
const MAX_FILE_BYTES  = 5 * 1024 * 1024;    // 5 MB per file
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;   // 12 MB per message
const DOC_TEXT_CAP    = 12_000;             // chars of extracted doc text in the prompt
const SCAN_PDF_PAGES  = 4;                  // pages rasterised when a PDF has no text layer

export { MAX_FILES };

export const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const TEXT_TYPES  = new Set(["text/plain", "text/markdown", "text/csv"]);

export function dataUrlToBuffer(dataUrl) {
  const m = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!m) return null;
  try { return m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8"); }
  catch { return null; }
}

// pdf-parse's index.js runs a self-test file read when nothing requires it,
// which crashes under ESM import — import the internals directly.
export async function extractPdfText(buffer) {
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = mod.default || mod;
  const out = await pdfParse(buffer);
  return String(out?.text || "");
}

/* Turn the client's attachment list into { visionParts, docContext, notes }.
   visionParts are chat.completions image parts; docContext is prompt text;
   notes are human-facing "what happened to your file" lines (also appended to
   the message so the model knows what it is looking at). */
export async function processAttachments(attachments = []) {
  const visionParts = [];
  const docChunks   = [];
  const notes       = [];
  let total = 0;

  for (const [i, a] of attachments.entries()) {
    const name = String(a?.name || `file-${i + 1}`);
    try {
      if (i >= MAX_FILES) { notes.push(`Only the first ${MAX_FILES} attachments were read.`); break; }
      const type = String(a?.type || "").toLowerCase();
      const buf  = dataUrlToBuffer(a?.dataUrl);
      if (!buf) { notes.push(`Couldn't read ${name}.`); continue; }
      total += buf.length;
      if (buf.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) { notes.push(`${name} was too large and was skipped.`); continue; }

      if (IMAGE_TYPES.has(type)) {
        visionParts.push({ type: "image_url", image_url: { url: a.dataUrl } });
        notes.push(`🖼 ${name} attached.`);
        continue;
      }
      if (type === "application/pdf" || /\.pdf$/i.test(name)) {
        const text = await extractPdfText(buf).catch(() => "");
        if (text && text.replace(/\s+/g, "").length >= 200) {
          docChunks.push(`### Attached file: ${name}\n${text.slice(0, DOC_TEXT_CAP)}`);
          notes.push(`📄 ${name} read.`);
        } else {
          // No usable text layer → scanned pages. Render for vision OCR.
          const pages = await renderPdfToImages(buf, { maxPages: SCAN_PDF_PAGES, scale: 1.6 }).catch(() => []);
          pages.forEach((url) => visionParts.push({ type: "image_url", image_url: { url, detail: "auto" } }));
          notes.push(pages.length
            ? `🔍 ${name} has no text layer — ${pages.length} page(s) read as images.`
            : `Couldn't read ${name}.`);
        }
        continue;
      }
      if (TEXT_TYPES.has(type) || /\.(txt|md|csv)$/i.test(name)) {
        docChunks.push(`### Attached file: ${name}\n${buf.toString("utf8").slice(0, DOC_TEXT_CAP)}`);
        notes.push(`📄 ${name} read.`);
        continue;
      }
      notes.push(`${name} isn't a supported file type and was skipped.`);
    } catch {
      notes.push(`Couldn't read ${name}.`);
    }
  }
  return { visionParts, docContext: docChunks.join("\n\n"), notes };
}

export function safeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 12_000) }))
    .filter((item) => item.content)
    .slice(-24);
}

// The agent receives its memory as context but historically DENIED having it
// ("I can't remember past chats") because nothing in the prompt owned the
// ability — the guide in memory/DURABLE_MEMORY.md is appended (via
// assembleChatDoctrine) only when durable memory actually loaded.

export function compactAgentSummary(previous, userMessage, assistantMessage) {
  const clean = (value, maximum) => String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
  const latest = `Latest learner request: ${clean(userMessage, 900)}\nLatest Akoro response: ${clean(assistantMessage, 1_600)}`;
  const prior = clean(previous, 2_200);
  return `${prior ? `${prior}\n` : ""}${latest}`.slice(-4_000);
}

export function safeMemoryUpdates(message) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  // Durable memory is opt-in by wording, study-only, and never stores raw tool
  // output. General chat and potentially sensitive requests remain in the exact
  // transcript and compact session summary only.
  const preference = text.match(/\b(?:i (?:prefer|learn best with|like)|please use)\s+(.{3,220})/i);
  if (preference && /\b(?:study|learn|revision|quiz|question|example|explain|lesson)\b/i.test(preference[1])) {
    return [{ kind: "study_preference", content: preference[1].trim(), topic: null, subject: null }];
  }
  const goal = text.match(/\b(?:my goal is|i want to (?:learn|revise|practise|practice|improve))\s+(.{3,220})/i);
  if (goal && /\b(?:math|mathematics|english|biology|chemistry|physics|science|history|geography|economics|literature|exam|waec|neco|jamb|revision|study)\b/i.test(goal[1])) {
    return [{ kind: "learner_goal", content: goal[1].trim(), topic: null, subject: null }];
  }
  return [];
}

/**
 * Write the user + reply rows immediately, before the slow durable context
 * work. Rows carry agent_session_id/agent_turn_id, so persistLearnerAgent…
 * finds them by (session, turn, role) and enriches instead of duplicating.
 * Returns the assistant message id, or null when the write failed.
 */
export async function appendFastChatTurn({ conversationId, userId, sessionId, turnId, userMessage, assistantMessage, agentOnly = false }) {
  const { data: session, error: sessionError } = await db.from("chat_sessions")
    .select("id, title").eq("id", conversationId).eq("user_id", userId).maybeSingle();
  if (sessionError || !session) return null;
  const ensure = async (role, text, createdAt) => {
    const find = () => db.from("chat_messages").select("id, text")
      .eq("session_id", conversationId).eq("user_id", userId)
      .eq("agent_session_id", sessionId).eq("agent_turn_id", turnId).eq("role", role).maybeSingle();
    const existing = await find();
    if (existing.data) return existing.data.id;
    const inserted = await db.from("chat_messages").insert({
      session_id: conversationId, user_id: userId, role, text,
      agent_session_id: sessionId, agent_turn_id: turnId, created_at: createdAt,
    }).select("id").single();
    if (!inserted.error) return inserted.data?.id || null;
    if (inserted.error.code === "23505") { const again = await find(); return again.data?.id || null; }
    return null;
  };
  const now = Date.now();
  const userIdRow = agentOnly ? null : await ensure("user", userMessage, new Date(now).toISOString());
  const assistantId = await ensure("agent", assistantMessage, new Date(now + 1).toISOString());
  const patch = { last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (!agentOnly && (!session.title || session.title === "New chat")) patch.title = sessionTitleFrom(userMessage);
  try { await db.from("chat_sessions").update(patch).eq("id", conversationId).eq("user_id", userId); } catch { /* best effort */ }
  return agentOnly ? assistantId : (userIdRow && assistantId ? assistantId : null);
}

export async function appendBasicChatTurn({ conversationId, userId, userMessage, assistantMessage, agentOnly = false }) {
  const { data: session, error: sessionError } = await db.from("chat_sessions")
    .select("id, title").eq("id", conversationId).eq("user_id", userId).maybeSingle();
  if (sessionError || !session) throw new Error("Agent Chat session was not found");
  const now = new Date().toISOString();
  const { data: inserted, error } = await db.from("chat_messages").insert([
    ...(agentOnly ? [] : [{ session_id: conversationId, user_id: userId, role: "user", text: userMessage }]),
    { session_id: conversationId, user_id: userId, role: "agent", text: assistantMessage },
  ]).select("id, role");
  if (error) throw error;
  const patch = { last_message_at: now, updated_at: now };
  if (!agentOnly && (!session.title || session.title === "New chat")) patch.title = sessionTitleFrom(userMessage);
  const { error: updateError } = await db.from("chat_sessions").update(patch).eq("id", conversationId).eq("user_id", userId);
  if (updateError) throw updateError;
  return { assistantMessageId: (inserted || []).find((row) => row.role === "agent")?.id ?? null };
}

/** The running-work rules + what runs now, for the turn's context — empty when nothing runs. */
export async function runningWorkBrief(learnerId) {
  const { runningWork } = await import("../study-prep/wiring.js");
  const work = await runningWork(learnerId);
  const live = [
    ...work.agentChecks.map((c) => `- Agent Check on ${c.topic} running in Battles: ${c.answered} of ${c.total ?? "?"} answered. Link: ${c.markdown || c.link}`),
    ...work.teachingSessions.map((t) => `- Teaching session on ${t.topic} (${t.state === "scheduled" ? "waiting on their dashboard" : "under way"}${t.progress?.of ? `, ${t.progress.done || 0} of ${t.progress.of} parts taught` : ""}). Link: ${t.markdown || t.link}`),
  ];
  if (!live.length) return "";
  const doctrine = await loadDoctrine("reasoning/RUNNING_WORK.md").catch(() => "");
  return `\n\n${doctrine.trim()}\n\n## Running now\n${live.join("\n")}`;
}

/**
 * The preview affordances a reload must rebuild: drafts the tools created
 * during this reply (topic previews, assignment/quiz draft cards) plus which
 * tools ran. Null when the reply executed nothing preview-worthy — the same
 * shape the live reply attaches client-side.
 */
export function previewMetaFrom(toolExecutions) {
  const execs = Array.isArray(toolExecutions) ? toolExecutions : [];
  const previews = execs
    .filter((x) => (x.tool === "prepare_activity" || x.tool === "run_teaching_tool" || x.tool === "revise_activity_draft") && x.success && x.draft)
    .map((x) => x.draft);
  // The reply's material links come back on reload too.
  const materials = collectMaterials(execs.map((x) => x.materials || []));
  // The Study Prep card the reply carries (the live chat reads it from the tool's session): a
  // reload — or the server after a restart, looking for the plan's chat — finds it here.
  const studyPrepSessionId = execs.find((x) => x.success && x.session?.id && ["start_study_prep_session", "get_study_prep_session"].includes(x.tool))?.session?.id || null;
  if (!previews.length && !materials.length && !studyPrepSessionId) return null;
  return { ...(previews.length ? { previews } : {}), ...(materials.length ? { materials } : {}), ...(studyPrepSessionId ? { studyPrepSessionId } : {}), tools: execs.map((x) => x.tool) };
}

/**
 * Store a reply's bounded trace (thinking / tool / activity blocks) and its
 * preview meta (draft cards) so a reloaded chat shows the same steps AND the
 * same cards. Best effort: a missing column during a rolling deploy or a
 * write hiccup never touches the saved reply itself.
 */
/**
 * Merge a reply-meta patch atomically. Materials (the turn) and ideas (the
 * parallel suggestions call) used to read-modify-write the same jsonb, so one
 * could overwrite the other — the card vanished on refresh. The SQL function
 * merges in one UPDATE; a read-merge-write fallback keeps old deploys working.
 */
export async function mergeChatMeta(messageId, patch) {
  if (!messageId || !patch || !Object.keys(patch).length) return;
  try {
    const { error } = await db.rpc("merge_chat_message_meta", { p_id: messageId, p_patch: patch });
    if (!error) return;
  } catch { /* fall through to the portable merge */ }
  try {
    const { data } = await db.from("chat_messages").select("meta").eq("id", messageId).maybeSingle();
    await db.from("chat_messages").update({ meta: { ...(data?.meta || {}), ...patch } }).eq("id", messageId);
  } catch (e) { console.warn("[agent-chat] meta merge failed:", e?.message || e); }
}

let warnedTraceColumn = false;
export async function saveMessageTrace({ messageId, userId, trace, meta = null }) {
  const hasTrace = Array.isArray(trace) && trace.length > 0;
  if (!messageId || (!hasTrace && !meta)) return;
  try {
    if (hasTrace) {
      const { error } = await db.from("chat_messages").update({ trace })
        .eq("id", messageId).eq("user_id", userId).eq("role", "agent");
      if (error) throw error;
    }
    if (meta) await mergeChatMeta(messageId, meta);
  } catch (error) {
    if (!warnedTraceColumn) {
      warnedTraceColumn = true;
      console.warn("[agent-chat] reply trace not saved (migration 2026-chat-message-trace pending?):", error?.message || error);
    }
  }
}

/**
 * The chips under a reply survive a refresh: saved on the reply's meta (meta.ideas,
 * which a reopened chat reads). Only the learner's own latest agent message in
 * that chat, and only when it is the reply the chips were made for. Never throws.
 */
export async function saveReplyIdeas({ userId, conversationId, reply, ideas }) {
  try {
    if (!userId || !/^[0-9a-f-]{36}$/i.test(String(conversationId || "")) || !Array.isArray(ideas) || !ideas.length) return false;
    const { data: last } = await db.from("chat_messages").select("id, text").eq("session_id", conversationId).eq("user_id", userId)
      .eq("role", "agent").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
    if (!last || norm(last.text) !== norm(reply)) return false;
    await mergeChatMeta(last.id, { ideas: ideas.slice(0, 3) });
    return true;
  } catch { return false; }
}

/**
 * The three follow-up chips for a reply. Shared by POST /suggestions and the
 * Agent Chat stream, which now sends them as a "suggestions" event right after
 * "done" — no second round trip from the app (2026-11-06). Never throws.
 */
export async function suggestionsFor({ user, body }) {
  const reply = String(body?.reply || "").trim();
  if (!reply) return [];
  // The teacher's ideas only for a non-learner account that asks for them.
  const role = body?.role === "instructor" && user?.role !== "student" ? "instructor" : "student";
  const tools = Array.isArray(body?.tools) ? body.tools.slice(0, 12) : [];
  const notTaught = role === "student" ? notTaughtFrom({ reply, tools }) : null;
  const uploads = role === "student" ? uploadsFrom(body?.attachments) : [];
  // Fixed chips first: the guide when it wasn't taught, the study step after an upload.
  const fixed = [guideChip(notTaught), uploadChip(uploads)].filter(Boolean);
  const isFixed = (x) => /teaching guide/i.test(x) || fixed.some((f) => f.toLowerCase() === String(x).toLowerCase());
  try {
    const capabilities = [];
    if (role === "student") {
      // Both lookups at once (they used to run one after the other before the model call).
      const [card, own] = await Promise.all([
        executeChatTool("get_agent_capabilities", {}, user.id, { role: "student" }).catch(() => null),
        learnerToolDefs(user.id).catch(() => []),
      ]);
      for (const sec of card?.sections || []) if (sec.title !== "Limits") capabilities.push(...(sec.items || []));
      for (const t of own) {
        const d = t?.function?.description || t?.function?.name;
        if (d) capabilities.push(`Your own tool: ${String(d).slice(0, 120)}`);
      }
    }
    const completion = await openai.chat.completions.create({
      __role: "suggestions", temperature: 0.5, max_tokens: 160,
      __timeoutMs: 12_000, __maxRetries: 0,
      response_format: { type: "json_object" },
      messages: buildSuggestionMessages({ role, ask: body?.ask, reply, context: body?.context, capabilities, notTaught, uploads }),
      __userId: user?.id, __feature: "chat_suggestions",
    });
    const ideas = shapeSuggestions(completion.choices?.[0]?.message?.content);
    const suggestions = fixed.length ? [...fixed, ...ideas.filter((x) => !isFixed(x))].slice(0, 3) : ideas;
    void saveReplyIdeas({ userId: user?.id, conversationId: body?.conversationId, reply, ideas: suggestions });
    return suggestions;
  } catch (e) {
    console.warn("[chat/suggestions] none this time:", String(e?.message || e).slice(0, 120));
    if (fixed.length) void saveReplyIdeas({ userId: user?.id, conversationId: body?.conversationId, reply, ideas: fixed });
    return fixed;
  }
}
