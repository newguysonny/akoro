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
  MAX_PASSAGES: 24,
  MAX_CONTEXT_CHARS: 24000,
  MAX_PASSAGE_CHARS: 1200,
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

/* ── Passage hygiene ──────────────────────────────────────────────────────
 * Front matter and bare headings are not study material. A title block
 * ("BIO 111 | GENERAL BIOLOGY | … lecture note • Designed for first-year…")
 * fed to the model comes back as a fake flashcard, and headings come back
 * as document-trivia questions ("Section 1 covers which topic?") — the
 * quality gap Matt flagged against YouLearn, 2026-11-17. Content blocks
 * are preferred wherever a page has any; a page of nothing else (a title
 * page, a slide) keeps its blocks so it never goes empty. */
const FRONT_MATTER_MARKERS = [
  /\|/, /•/, /lecture notes?\b/i, /designed for/i, /textbook/i,
  /©|copyright|isbn/i, /faculty of|department of|school of/i, /all rights reserved/i,
];
export function isFrontMatter(text) {
  const t = String(text || "");
  let hits = 0;
  for (const re of FRONT_MATTER_MARKERS) if (re.test(t)) hits += 1;
  if ((t.match(/\b[A-Z]{2,4}\s?\d{3}\b/g) || []).length >= 2) hits += 1; // course code twice = title block
  return hits >= 2;
}
export function isBareHeading(text) {
  const t = String(text || "").trim().replace(/^\d+(\.\d+)*[.)]?\s*/, "");
  if (!t || t.length > 120 || /[.!?…]/.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 12) return false;
  const letters = t.replace(/[^A-Za-z]/g, "");
  const upperRatio = letters ? letters.replace(/[^A-Z]/g, "").length / letters.length : 0;
  const capWords = words.filter((w) => /^[A-Z]/.test(w)).length / words.length;
  return capWords >= 0.6 || upperRatio >= 0.55;
}
const isContentText = (t) => !isFrontMatter(t) && !isBareHeading(t);

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
  if (blocks.length) {
    const content = blocks.filter((b) => isContentText(b.text));
    return finalize(content.length ? content : blocks);
  }
  return page?.markdown ? textPassages(pageNumber, page.markdown) : [];
}

/** Plain page text (never extracted) as paragraph passages — page-level cites. */
export function textPassages(pageNumber, text) {
  const allParas = String(text || "").slice(0, TOOL_LIMITS.MAX_PAGE_TEXT_CHARS)
    .split(/\n\s*\n|(?<=[.!?])\s{2,}/).map((s) => s.trim()).filter((s) => s.length >= 20);
  const bodyParas = allParas.filter((s) => !isFrontMatter(s));
  const paras = bodyParas.length ? bodyParas : allParas;
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
    const allBlocks = (page?.blocks || []).filter(usableBlock);
    const contentBlocks = allBlocks.filter((b) => isContentText(blockText(b)));
    const blocks = contentBlocks.length ? contentBlocks : allBlocks;
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
    summary: `Write ${count} summary points: each one a clear, self-contained sentence or two capturing a key idea, in the order the ideas appear. State the ideas themselves — do not quote the document's headings or title as points.`,
    quiz: `Write ${count} multiple-choice questions at ${difficulty} difficulty, in the voice of a real exam testing understanding of the material. Each has exactly 4 options, one correct (correctIndex 0-3), and a one-sentence explanation that states the fact behind the answer in your own words. Every wrong option must be a plausible mistake: a confusion between two ideas in the material, a reversed cause and effect, a wrong value, or a common misconception — never unrelated facts, and never "all/none of the above". Example of the standard: for material on photosynthesis, "Which gas do plants absorb for photosynthesis?" with correct "Carbon dioxide" and wrong options "Oxygen" (what plants release), "Nitrogen" (abundant in air but not used) and "Hydrogen" — each wrong option is a real confusion, not filler.`,
    flashcards: `Write ${count} flashcards. front = ONE key term from the material, or ONE short question about it — never a sentence, heading or title copied from the material. back = the explanation in your own words, grounded in the passage (1-3 sentences). Example of the standard: front "Osmosis", back "The movement of water across a partially permeable membrane, from a dilute solution to a more concentrated one."`,
  }[tool];
  const system = [
    `You are an experienced teacher creating study material from the document "${String(docName).slice(0, 160)}" to prepare a learner for an exam on this material.`,
    "Use ONLY the numbered passages below; every item must name the passage it comes from as `source`.",
    "Never invent facts that are not in the passages. Use the learner's language (the passages' language).",
    "Test the MATERIAL ITSELF — the facts, ideas and processes it teaches. Never ask about the document as an object: no questions about its sections, headings, pages, title or structure, and never write \"in the passage\", \"according to the text\" or \"the document says\" — write as if the material is simply what the learner is studying. Never copy a passage's wording as a question or card front; phrase everything in your own words.",
    focus ? `Concentrate on: ${focus}.` : "",
    task,
    "",
    "Passages:",
    passages.map((p) => `[${p.n}] (${passageWhere(p)})\n${p.text}`).join("\n\n"),
  ].filter(Boolean).join("\n");
  return [{ role: "system", content: system }, { role: "user", content: `Create the ${tool} now.` }];
}

/** Where a passage points, as a citation the app's jump understands.
 *  A folder passage also names its source document (the jump stays
 *  inside that document; the reader shows the name instead). */
export function citeOf(p) {
  return { n: p.n, pageNumber: p.pageNumber ?? null, bbox: p.bbox ?? null, startMs: p.startMs ?? null, endMs: p.endMs ?? null, quote: clip(p.text, 200),
    ...(p.sourceName ? { sourceName: p.sourceName, sourceRecordId: p.sourceRecordId ?? null } : {}) };
}

/* ── Quality gate ─────────────────────────────────────────────────────────
 * The validator used to check shape only (4 options, non-empty text), so a
 * flashcard whose front was the document's title block copied word-for-word,
 * or a question about the document itself ("Section 1 covers which topic?"),
 * shipped as-is. These pure checks drop both failure modes; the caller
 * (generateToolResult) asks once for replacements when the gate fires. */
const normForCopy = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/** True when `item` lifts `passage` word-for-word (a long verbatim run). */
export function isVerbatimCopy(item, passage) {
  const a = normForCopy(item);
  const b = normForCopy(passage);
  if (a.length < 35 || !b) return false;
  return b.includes(a.slice(0, 70));
}

const META_QUESTION = [
  /\b(section|chapter|unit|part|page|passage)\s+\d+\b/i,
  /\baccording to the (passage|text|document|author)\b/i,
  /\bin the (passage|above passage)\b/i,
  /\bthe (passage|document|text|author) (says|states|describes|mentions|covers|is titled)\b/i,
  /\b(described as covering|is titled|covers? which topic)\b/i,
  /\bwhat is the title of\b/i,
];
/** True when the text asks about the document itself instead of the material. */
export function isMetaQuestion(text) {
  return META_QUESTION.some((re) => re.test(String(text || "")));
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
      const qPassage = src(q.source);
      if (isMetaQuestion(q.prompt) || (qPassage && isVerbatimCopy(q.prompt, qPassage.text))) continue;
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
  const cards = [];
  for (const c of json?.cards || []) {
    if (!String(c?.front || "").trim() || !String(c?.back || "").trim()) continue;
    const cPassage = src(c.source);
    if (isMetaQuestion(c.front) || String(c.front).includes("|")) continue;
    if (cPassage && isVerbatimCopy(c.front, cPassage.text)) continue;
    if (cPassage && normForCopy(c.back).length >= 80 && isVerbatimCopy(c.back, cPassage.text)) continue;
    cards.push({ front: clip(c.front, 160), back: clip(c.back, 500), cite: cPassage ? citeOf(cPassage) : null });
    if (cards.length >= max) break;
  }
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
/**
 * Pool several documents' tool passages into one numbered set (folder
 * tools): round-robin across documents under the same caps a single
 * document gets, renumbered. Passages arrive pre-tagged with their
 * source document.
 */
export function mergeToolFolderPassages(perDoc = []) {
  const queues = perDoc.map((list) => [...list]);
  const out = [];
  let chars = 0;
  for (;;) {
    let took = false;
    for (const q of queues) {
      if (out.length >= TOOL_LIMITS.MAX_PASSAGES) break;
      const p = q.shift();
      if (!p) continue;
      const text = clip(p.text, TOOL_LIMITS.MAX_PASSAGE_CHARS);
      if (chars + text.length > TOOL_LIMITS.MAX_CONTEXT_CHARS && out.length) continue;
      out.push({ ...p, text }); chars += text.length; took = true;
    }
    if (!took || out.length >= TOOL_LIMITS.MAX_PASSAGES) break;
  }
  return out.map((p, i) => ({ ...p, n: i + 1 }));
}

export async function gatherToolPassages({ target, scope, pageNumber = null, pageText = "", focus = "", search }) {
  // A folder target: passages from every document in the folder, pooled.
  // Page scope has no meaning over a folder — always the whole documents.
  if (Array.isArray(target?.folderTargets)) {
    const perDoc = [];
    for (const docTarget of target.folderTargets.slice(0, 8)) {
      const passages = await gatherToolPassages({ target: docTarget, scope: "document", focus, search });
      if (passages.length) {
        perDoc.push(passages.map((p) => ({ ...p, sourceName: docTarget.name, sourceRecordId: docTarget.recordId })));
      }
    }
    return mergeToolFolderPassages(perDoc);
  }
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

