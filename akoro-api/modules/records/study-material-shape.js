/**
 * modules/records/study-material-shape.js — the pure shapes behind the
 * reader's study tools: form-value normalisation, salvaging a model's JSON
 * answer, and the citation/tab shapes the reader and Agent Chat share.
 *
 * No db, no model calls — everything here is testable on its own.
 */
import { TOOL_LIMITS } from "./toolsLib.js";

export const CHAT_STUDY_TOOLS = Object.freeze(["quiz", "flashcards", "summary", "podcast"]);
export const LABEL = { quiz: "Quiz", flashcards: "Flashcards", summary: "Summary", podcast: "Podcast" };
export const UUID = /^[0-9a-f-]{36}$/i;
export const clean = (s, n) => (typeof s === "string" || typeof s === "number" ? String(s).slice(0, n) : "");

export function toolValues(raw = {}) {
  return {
    focus: clean(raw.focus, TOOL_LIMITS.MAX_FOCUS_CHARS),
    depth: clean(raw.depth, 20),
    count: clean(raw.count, 3),
    difficulty: clean(raw.difficulty, 10),
  };
}

const stripFence = (t) => String(t || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

/** Providers answer in prose, with a fenced block, or JSON plus a sentence. */
export function parseModelJson(t) {
  const text = String(t || "").trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  for (const candidate of [stripFence(text), fenced?.[1]]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* try the object inside */ }
    const a = candidate.indexOf("{");
    const b = candidate.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return JSON.parse(candidate.slice(a, b + 1)); } catch { /* give up */ } }
  }
  return null;
}

export function itemsOf(tool, json) {
  return (tool === "summary" ? json?.points : tool === "quiz" ? json?.questions : json?.cards) || [];
}

/** A server citation → the reader's jump shape (0-based page + box, or a moment), quote kept. */
export function toReaderCite(c) {
  if (!c) return null;
  const at = Number.isInteger(c.pageNumber) ? { page: c.pageNumber - 1, ...(Array.isArray(c.bbox) && c.bbox.length === 4 ? { bbox: c.bbox } : {}) }
    : Number.isFinite(c.startMs) ? { startMs: c.startMs } : null;
  return at ? { ...at, ...(c.quote ? { quote: c.quote } : {}) } : null;
}

/** The tab content the reader shows — the same shape its own form saves. PURE. */
export function toReaderContent(tool, r = {}) {
  if (tool === "summary") return { summaryPoints: (r.summaryPoints || []).map((p) => ({ text: p.text, cite: toReaderCite(p.cite) })) };
  if (tool === "quiz") {
    const quizQuestions = (r.quizQuestions || []).map((q) => ({ ...q, cite: toReaderCite(q.cite) }));
    return { quizQuestions, ui: { quizAnswers: quizQuestions.map(() => ({ selected: null, checked: false, dontKnow: false })) } };
  }
  return { cardSet: (r.cardSet || []).map((c) => ({ ...c, cite: toReaderCite(c.cite) })) };
}
