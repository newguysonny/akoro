/**
 * modules/records/toolsLib.js — the reader's study tools, generated for real.
 *
 * Summary, Quiz and Flashcards used to be built in the browser from
 * sentence splitting and word counts (behind a fake 600 ms delay). Now each
 * is one structured model call over numbered passages from the document —
 * the same passages Ask uses — and every point, question and card names the
 * passage it came from, so its citation jumps to the page + box (or the
 * recording moment) exactly like an Ask citation.
 *
 * Scope:
 *   page      — that page's extraction boxes; a page never extracted falls
 *               back to the text the reader already shows (pageText)
 *   document  — an even sample across the document, or a search for the
 *               learner's focus when one is given
 *
 * The pure pieces (passages, schemas, prompts, shaping) are exported for the
 * contract test; db access loads lazily.
 */
import { contentWords, gatherPassages, passageWhere, pastedPagesFor } from "./askLib.js";

export const TOOL_IDS = Object.freeze(["summary", "quiz", "flashcards"]);
export const TOOL_LIMITS = Object.freeze({
  MAX_PAGE_TEXT_CHARS: 8000,
  MAX_PASSAGES: 16,
  MAX_CONTEXT_CHARS: 9500,
  MAX_PASSAGE_CHARS: 900,
  MAX_FOCUS_CHARS: 200,
});

const clip = (text, max) => {
  const value = String(text ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
const blockText = (b) => String(b?.text_content ?? "").replace(/<\/?hw>/g, "").trim();
const usableBlock = (b) => {
  const t = blockText(b);
  return t && t !== "<image>" && Array.isArray(b?.bbox_2d) && b.bbox_2d.length === 4;
};

/** How many items each tool makes, from the form's values. */
export function toolCount(tool, values = {}) {
  const n = parseInt(values.count, 10);
  if (tool === "summary") return /detailed/i.test(String(values.depth || "")) ? 8 : 4;
  if (tool === "quiz") return Number.isInteger(n) && n > 0 ? Math.min(n, 50) : 5;   // any count the learner types (1–50)
  if (tool === "flashcards") return [3, 6, 10].includes(n) ? n : 6;
  return 0;
}

/** Number passages 1..n and enforce the size budget. */
function finalize(raw) {
  const out = [];
  let chars = 0;
  for (const p of raw) {
    const text = clip(p.text, TOOL_LIMITS.MAX_PASSAGE_CHARS);
    if (!text) continue;
    if (out.length >= TOOL_LIMITS.MAX_PASSAGES || chars + text.length > TOOL_LIMITS.MAX_CONTEXT_CHARS) break;
    out.push({ ...p, text });
    chars += text.length;
  }
  return out.map((p, i) => ({ n: i + 1, ...p }));
}

/** One page's boxes as passages (reading order). */
export function pagePassages(pageNumber, page) {
  const blocks = (page?.blocks || []).filter(usableBlock)
    .map((b) => ({ kind: "block", pageNumber, bbox: b.bbox_2d.map(Number), startMs: null, endMs: null, text: blockText(b) }))
    .sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  if (blocks.length) return finalize(blocks);
  return page?.markdown ? textPassages(pageNumber, page.markdown) : [];
}

/** Plain page text (never extracted) as paragraph passages — page-level cites. */
export function textPassages(pageNumber, text) {
  const paras = String(text || "").slice(0, TOOL_LIMITS.MAX_PAGE_TEXT_CHARS)
    .split(/\n\s*\n|(?<=[.!?])\s{2,}/).map((s) => s.trim()).filter((s) => s.length >= 20);
  // Long runs without breaks → ~600-char slices on sentence ends.
  const pieces = [];
  for (const p of paras.length ? paras : [String(text || "").trim()]) {
    if (p.length <= 700) { if (p) pieces.push(p); continue; }
    let rest = p;
    while (rest.length > 700) {
      const cut = rest.lastIndexOf(". ", 650);
      const at = cut > 200 ? cut + 1 : 650;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }
  return finalize(pieces.map((t) => ({ kind: "page", pageNumber: Number.isInteger(pageNumber) ? pageNumber : null, bbox: null, startMs: null, endMs: null, text: t })));
}

/**
 * An even sample across a document's pages: each chosen page contributes
 * its longest boxes, in reading order, until the budget is spent.
 */
export function samplePassages(pages /* Map(pageNumber → {markdown, blocks}) */) {
  const numbers = [...pages.keys()].sort((a, b) => a - b);
  if (!numbers.length) return [];
  const perPage = numbers.length <= 4 ? 4 : numbers.length <= 8 ? 2 : 1;
  const pick = numbers.length * perPage <= TOOL_LIMITS.MAX_PASSAGES
    ? numbers
    : Array.from({ length: Math.ceil(TOOL_LIMITS.MAX_PASSAGES / perPage) }, (_, i) =>
        numbers[Math.floor((i * numbers.length) / Math.ceil(TOOL_LIMITS.MAX_PASSAGES / perPage))]);
  const raw = [];
  for (const pageNumber of [...new Set(pick)]) {
    const page = pages.get(pageNumber);
    const blocks = (page?.blocks || []).filter(usableBlock);
    if (blocks.length) {
      const longest = [...blocks].sort((a, b) => blockText(b).length - blockText(a).length).slice(0, perPage)
        .sort((a, b) => a.bbox_2d[1] - b.bbox_2d[1]);
      for (const b of longest) raw.push({ kind: "block", pageNumber, bbox: b.bbox_2d.map(Number), startMs: null, endMs: null, text: blockText(b) });
    } else if (page?.markdown) {
      raw.push({ kind: "page", pageNumber, bbox: null, startMs: null, endMs: null, text: page.markdown });
    }
  }
  return finalize(raw);
}

/** Transcript windows / paste slices as passages, evenly sampled. */
export function chunkPassages(chunks) {
  const list = (chunks || []).filter((c) => String(c.text || "").trim());
  const step = Math.max(1, Math.ceil(list.length / TOOL_LIMITS.MAX_PASSAGES));
  return finalize(list.filter((_, i) => i % step === 0).map((c) => ({
    kind: c.kind, pageNumber: null, bbox: null,
    startMs: c.kind === "transcript" && Number.isFinite(c.startMs) ? c.startMs : null,
    endMs: c.kind === "transcript" && Number.isFinite(c.endMs) ? c.endMs : null,
    text: c.text,
  })));
}

/* ── The model call: strict JSON per tool ─────────────────────────────── */

const SOURCE = { type: "integer", description: "The number of the passage this comes from." };

export function toolSchema(tool) {
  if (tool === "summary") {
    return { type: "object", additionalProperties: false, required: ["points"], properties: {
      points: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "source"], properties: {
        text: { type: "string" }, source: SOURCE } } } } };
  }
  if (tool === "quiz") {
    return { type: "object", additionalProperties: false, required: ["questions"], properties: {
      questions: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["prompt", "options", "correctIndex", "explanation", "source"], properties: {
          prompt: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correctIndex: { type: "integer" },
          explanation: { type: "string" },
          source: SOURCE } } } } };
  }
  return { type: "object", additionalProperties: false, required: ["cards"], properties: {
    cards: { type: "array", items: { type: "object", additionalProperties: false, required: ["front", "back", "source"], properties: {
      front: { type: "string" }, back: { type: "string" }, source: SOURCE } } } } };
}

export function buildToolMessages({ tool, docName = "this document", passages = [], values = {} }) {
  const count = toolCount(tool, values);
  const focus = clip(values.focus || "", TOOL_LIMITS.MAX_FOCUS_CHARS);
  const difficulty = ["Easy", "Medium", "Hard"].includes(values.difficulty) ? values.difficulty : "Medium";
  const task = {
    summary: `Write ${count} summary points: each one a clear, self-contained sentence or two capturing a key idea, in the order the ideas appear.`,
    quiz: `Write ${count} multiple-choice questions at ${difficulty} difficulty. Each has exactly 4 options, one correct (correctIndex 0-3), plausible distractors drawn from the material's own ideas, and a one-sentence explanation of why the answer is right. Test understanding, not trivia; never "all/none of the above".`,
    flashcards: `Write ${count} flashcards: front = a key term, concept or question (short); back = its explanation from the material (1-3 sentences).`,
  }[tool];
  const system = [
    `You create study material from the document "${String(docName).slice(0, 160)}" for a learner.`,
    "Use ONLY the numbered passages below; every item must name the passage it comes from as `source`.",
    "Never invent facts that are not in the passages. Use the learner's language (the passages' language).",
    focus ? `Concentrate on: ${focus}.` : "",
    task,
    "",
    "Passages:",
    passages.map((p) => `[${p.n}] (${passageWhere(p)})\n${p.text}`).join("\n\n"),
  ].filter(Boolean).join("\n");
  return [{ role: "system", content: system }, { role: "user", content: `Create the ${tool} now.` }];
}

/** Where a passage points, as a citation the app's jump understands. */
export function citeOf(p) {
  return { n: p.n, pageNumber: p.pageNumber ?? null, bbox: p.bbox ?? null, startMs: p.startMs ?? null, endMs: p.endMs ?? null, quote: clip(p.text, 200) };
}

/**
 * The model's JSON → the reader's result-tab content. Items naming a passage
 * that doesn't exist, empty items and malformed questions are dropped.
 */
export function shapeToolResult(tool, json, passages, values = {}) {
  const byN = new Map(passages.map((p) => [p.n, p]));
  const max = toolCount(tool, values);
  const src = (n) => byN.get(Number(n));
  if (tool === "summary") {
    const points = (json?.points || [])
      .filter((p) => String(p?.text || "").trim())
      .slice(0, max)
      .map((p) => ({ text: clip(p.text, 600), cite: src(p.source) ? citeOf(src(p.source)) : null }));
    return { summaryPoints: points };
  }
  if (tool === "quiz") {
    const questions = [];
    for (const q of json?.questions || []) {
      const rawOptions = Array.isArray(q?.options) ? q.options : [];
      const options = rawOptions.map((o) => clip(typeof o === "string" ? o : (o?.text ?? o?.label ?? ""), 240)).filter(Boolean);
      let correctIndex = q?.correctIndex ?? q?.correct ?? q?.answer;
      if (typeof correctIndex === "string") {
        const s = correctIndex.trim();
        correctIndex = /^[A-D]$/i.test(s) ? s.toUpperCase().charCodeAt(0) - 65 : Number(s);
      }
      correctIndex = Number(correctIndex);
      if (!String(q?.prompt || "").trim() || options.length !== 4 || new Set(options.map((o) => o.toLowerCase())).size !== 4) continue;
      if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) continue;
      questions.push({
        prompt: clip(q.prompt, 400),
        options: options.map((text, i) => ({ key: "ABCD"[i], text, correct: i === correctIndex })),
        explanation: clip(q.explanation || "", 400),
        cite: src(q.source) ? citeOf(src(q.source)) : null,
      });
      if (questions.length >= max) break;
    }
    return { quizQuestions: questions };
  }
  const cards = (json?.cards || [])
    .filter((c) => String(c?.front || "").trim() && String(c?.back || "").trim())
    .slice(0, max)
    .map((c) => ({ front: clip(c.front, 160), back: clip(c.back, 500), cite: src(c.source) ? citeOf(src(c.source)) : null }));
  return { cardSet: cards };
}

/* ── Gathering passages for a scope (lazy db) ─────────────────────────── */

const dbLazy = async () => (await import("../../db.js")).default;

async function loadPages(contentKey, pageNumbers = null) {
  const db = await dbLazy();
  let q = db.schema("edu").from("content_parses").select("page_number, markdown, blocks").eq("content_key", contentKey);
  if (pageNumbers) q = q.in("page_number", pageNumbers);
  const { data } = await q.order("page_number");
  const pages = new Map();
  for (const row of data || []) {
    const blocks = typeof row.blocks === "string" ? JSON.parse(row.blocks || "[]") : (row.blocks || []);
    pages.set(row.page_number, { markdown: row.markdown || "", blocks });
  }
  return pages;
}

async function loadChunks(recordId) {
  const db = await dbLazy();
  const { data } = await db.schema("edu").from("record_chunks")
    .select("kind, start_ms, end_ms, chunk_text").eq("record_id", recordId).in("kind", ["transcript", "paste"])
    .order("start_ms", { ascending: true, nullsFirst: true }).limit(400);
  return (data || []).map((r) => ({ kind: r.kind, startMs: r.start_ms != null ? Number(r.start_ms) : null, endMs: r.end_ms != null ? Number(r.end_ms) : null, text: r.chunk_text }));
}

/**
 * Passages for a tool run. Returns [] when the document has nothing the
 * server can read for that scope (the route says so honestly).
 */
export async function gatherToolPassages({ target, scope, pageNumber = null, pageText = "", focus = "", search }) {
  if (scope === "page" && Number.isInteger(pageNumber)) {
    if (target.contentKey) {
      const pages = await loadPages(target.contentKey, [pageNumber]);
      const fromBoxes = pagePassages(pageNumber, pages.get(pageNumber));
      if (fromBoxes.length) return fromBoxes;
    }
    return pageText ? textPassages(pageNumber, pageText) : [];
  }
  // Whole document: the extracted PAGES are the grounding (RunPod markdown +
  // blocks when it exists, the free pdf-text pages otherwise). A focus narrows
  // to pages that contain its words; the prompt still carries the focus.
  if (target.contentKey) {
    const pages = await loadPages(target.contentKey);
    if (pages.size) {
      const words = contentWords(focus);
      if (words.size) {
        const hits = new Map([...pages].filter(([, p]) => {
          const text = String(p?.markdown || "").toLowerCase();
          return [...words].some((w) => text.includes(w));
        }));
        if (hits.size) return samplePassages(hits);
      }
      return samplePassages(pages);
    }
  }
  // No extracted pages (a transcript/paste): search the indexed text.
  if (String(focus || "").trim() && contentWords(focus).size) {
    const { passages, indexed } = await gatherPassages({ target, question: String(focus).slice(0, 300), search });
    if (indexed && passages.length) return passages;
  }
  // A paste: its pages as the reader cuts them, so every item cites a real page.
  const pasted = await pastedPagesFor(target);
  if (pasted.size) return samplePassages(pasted);
  const chunks = await loadChunks(target.recordId);
  if (chunks.length) return chunkPassages(chunks);
  return pageText ? textPassages(Number.isInteger(pageNumber) ? pageNumber : null, pageText) : [];
}

