/**
 * modules/records/askLib.js — "Ask" over ONE document, with citations.
 *
 * The reader's Ask tab (and, later, the teaching session) asks a question
 * about a record. This lib turns that into an answer grounded in passages
 * from ANYWHERE in the document — not just the first 12,000 characters the
 * teaching session sees — and maps every [n] the model writes back to
 * where it came from:
 *
 *   document page  → page number + the extraction block's bbox (0-1000),
 *                    so the reader jumps to the page and flashes the box
 *   recording      → start/end ms, so the player seeks to the moment
 *   pasted text    → the passage itself
 *
 * Retrieval: the library's hybrid search (record_chunks: one chunk per
 * extracted page, per transcript window, per paste slice) finds the best
 * pages; within those pages the extraction's layout blocks are ranked
 * against the question, and the best blocks become numbered passages.
 *
 * The pure pieces (passage selection, the prompt, citation extraction) are
 * exported for the contract test; the db/model pieces load lazily.
 */

import { pastedTextPages } from "./readerPages.js";

export const ASK_LIMITS = Object.freeze({
  MAX_QUESTION_CHARS: 2000,
  MAX_SELECTION_CHARS: 1500,
  TOP_PAGES: 4,            // pages whose blocks compete for passage slots
  MAX_PASSAGES: 14,
  MAX_CONTEXT_CHARS: 9000, // all passages together
  MAX_PASSAGE_CHARS: 1200,
  HISTORY_TURNS: 6,        // earlier Q/A pairs the model sees
  HISTORY_LIMIT: 50,       // messages the tab loads
});

const STOP = new Set(("the a an and or of to in on for with is are was were be been this that these those it its as at by from " +
  "what which who whom how why when where does do did can could should would will shall may might about into than then there " +
  "their they them you your our we us i me my not no yes but if so such any all some more most other also just only very").split(" "));

/** Content words of a text, lower-cased (≥3 chars, no stop words). */
export function contentWords(text) {
  return new Set(String(text || "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter((w) => !STOP.has(w)) || []);
}

const clip = (text, max) => {
  const value = String(text ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const blockText = (b) => String(b?.text_content ?? "").replace(/<\/?hw>/g, "").trim();
const isFigure = (text) => text === "<image>";

/**
 * Pick the numbered passages the model may use.
 *
 * hits       — search results for this record, best first:
 *              [{ chunkKind, pageNumber, startMs, endMs, text }]
 * pages      — Map(pageNumber → { markdown, blocks }) for the hit pages
 * question   — the learner's question
 * selection  — { pageNumber?, text } pinned with "Ask about this", or null
 *
 * Returns [{ n, kind, pageNumber, bbox, startMs, endMs, text, pinned }]
 * numbered 1.. in reading order (page, then top-to-bottom), pinned first.
 */
export function selectPassages({ hits = [], pages = new Map(), question = "", selection = null }) {
  const L = ASK_LIMITS;
  const words = contentWords(`${question} ${selection?.text || ""}`);
  const out = [];
  let chars = 0;
  const room = (text) => chars + text.length <= L.MAX_CONTEXT_CHARS && out.length < L.MAX_PASSAGES;
  const push = (p) => { out.push(p); chars += p.text.length; };

  // 1. The pinned selection — matched to its block when the page has one.
  const pinnedKeys = new Set();
  if (selection?.text) {
    const sel = clip(selection.text, L.MAX_SELECTION_CHARS);
    const page = Number.isInteger(selection.pageNumber) ? pages.get(selection.pageNumber) : null;
    const needle = sel.toLowerCase().replace(/\s+/g, " ").slice(0, 60);
    const block = page?.blocks?.find((b) => blockText(b).toLowerCase().replace(/\s+/g, " ").includes(needle));
    push({
      kind: "selection", pinned: true,
      pageNumber: Number.isInteger(selection.pageNumber) ? selection.pageNumber : null,
      bbox: block ? block.bbox_2d : null, startMs: null, endMs: null, text: sel,
    });
    if (block) pinnedKeys.add(`${selection.pageNumber}:${block.bbox_2d.join(",")}`);
  }

  // 2. Page hits → their best blocks (or the page text when it has none).
  const pageOrder = [];
  for (const h of hits) {
    if (h.chunkKind === "page" && Number.isInteger(h.pageNumber) && !pageOrder.includes(h.pageNumber)) pageOrder.push(h.pageNumber);
    if (pageOrder.length >= L.TOP_PAGES) break;
  }
  const candidates = [];
  pageOrder.forEach((pageNumber, rank) => {
    const page = pages.get(pageNumber);
    const blocks = (page?.blocks || []).filter((b) => {
      const t = blockText(b);
      return t && !isFigure(t) && Array.isArray(b.bbox_2d) && b.bbox_2d.length === 4;
    });
    if (!blocks.length) {
      const text = clip(page?.markdown || hits.find((h) => h.pageNumber === pageNumber)?.text || "", L.MAX_PASSAGE_CHARS);
      if (text) candidates.push({ kind: "page", pageNumber, bbox: null, text, score: 1 - rank * 0.1, first: true });
      return;
    }
    blocks.forEach((b, i) => {
      const text = clip(blockText(b), L.MAX_PASSAGE_CHARS);
      const bw = contentWords(text);
      let overlap = 0;
      for (const w of words) if (bw.has(w)) overlap += 1;
      // Overlap dominates; the page's search rank breaks ties; a block's
      // first appearance on the best page keeps every page represented.
      candidates.push({ kind: "block", pageNumber, bbox: b.bbox_2d.map(Number), text, score: overlap * 2 - rank * 0.25 - i * 0.001, first: i === 0 });
    });
  });
  // Every hit page gets its best block before any page gets a second.
  const byPage = new Map();
  for (const c of candidates) {
    const best = byPage.get(c.pageNumber);
    if (!best || c.score > best.score) byPage.set(c.pageNumber, c);
  }
  const ordered = [...byPage.values(), ...candidates.filter((c) => byPage.get(c.pageNumber) !== c).sort((a, b) => b.score - a.score)];
  for (const c of ordered) {
    if (pinnedKeys.has(`${c.pageNumber}:${(c.bbox || []).join(",")}`)) continue;
    if (!room(c.text)) continue;
    push({ kind: c.kind, pinned: false, pageNumber: c.pageNumber, bbox: c.bbox, startMs: null, endMs: null, text: c.text });
  }

  // 3. Recordings and pasted text — the chunk is the passage.
  for (const h of hits) {
    if (h.chunkKind !== "transcript" && h.chunkKind !== "paste") continue;
    const text = clip(h.text, L.MAX_PASSAGE_CHARS);
    if (!text || !room(text)) continue;
    push({
      kind: h.chunkKind, pinned: false, pageNumber: null, bbox: null,
      startMs: h.chunkKind === "transcript" && Number.isFinite(h.startMs) ? h.startMs : null,
      endMs: h.chunkKind === "transcript" && Number.isFinite(h.endMs) ? h.endMs : null,
      text,
    });
  }

  // Reading order (pinned first), then number them.
  const sortKey = (p) => [p.pinned ? 0 : 1, p.pageNumber ?? 1e9, p.bbox ? p.bbox[1] : 0, p.startMs ?? 0];
  out.sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  });
  return out.map((p, i) => ({ n: i + 1, ...p }));
}

const fmtTime = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Where a passage is, in words the model can repeat ("page 4", "at 12:05"). */
export function passageWhere(p) {
  if (Number.isInteger(p.pageNumber)) return `page ${p.pageNumber}`;
  if (Number.isFinite(p.startMs)) return `at ${fmtTime(p.startMs)}`;
  return "pasted text";
}

/** The chat messages for one Ask turn. */
export function buildAskMessages({ docName = "this document", passages = [], question = "", history = [] }) {
  const sources = passages.length
    ? passages.map((p) => `[${p.n}] (${passageWhere(p)}${p.pinned ? ", selected by the learner" : ""})\n${p.text}`).join("\n\n")
    : "(no passages were found for this question)";
  const system = [
    `You answer a learner's questions about the document "${String(docName).slice(0, 160)}".`,
    "Use ONLY the numbered passages below — they are the parts of the document that matched the question.",
    "Cite every claim with its passage number in square brackets, e.g. [2] or [2][5], right after the sentence it supports.",
    "If the passages do not contain the answer, say you could not find it in this document and suggest what to search for instead. Never invent facts, page numbers or quotes.",
    "If the learner selected a passage, explain THAT passage first.",
    "When the learner asks you to EXPLAIN something (e.g. 'Explain …', or pastes a section and asks for an explanation), write a WELL-STRUCTURED Markdown explanation, like a short textbook note: a one-sentence overview, then 2–4 short sections, each starting with a '### ' heading, a plain-language paragraph, and — where it helps — a bullet or numbered list whose items begin with a **bold** key term; finish with a single '**Bottom line:**' sentence. Cite the passage [n] after each claim that uses it. Cover the essential points only: do not restate or summarise the whole passage, do not list every minor detail, and do not echo the source wording.",
    "Answer other questions directly and concisely; use short paragraphs or bullet points; use the learner's language.",
    "Return only the final answer in Markdown: no <final> tags or any XML/HTML wrappers, no reasoning/thinking text, and never repeat the answer or the passage text.",
    "",
    "Passages:",
    sources,
  ].join("\n");
  const turns = history.slice(-ASK_LIMITS.HISTORY_TURNS * 2).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.text || "").slice(0, 2000),
  }));
  return [{ role: "system", content: system }, ...turns, { role: "user", content: String(question).slice(0, ASK_LIMITS.MAX_QUESTION_CHARS) }];
}

/**
 * The citations an answer actually used, in order of first use. Markers
 * that point at no passage are ignored (and reported, so the caller can
 * tell). Each citation carries where to jump and a short quote.
 */
export function extractCitations(answer, passages = []) {
  const byN = new Map(passages.map((p) => [p.n, p]));
  const seen = new Set();
  const citations = [];
  const unknown = [];
  for (const m of String(answer || "").matchAll(/\[(\d{1,3})\]/g)) {
    const n = Number(m[1]);
    if (seen.has(n)) continue;
    seen.add(n);
    const p = byN.get(n);
    if (!p) { unknown.push(n); continue; }
    citations.push({
      n,
      pageNumber: p.pageNumber ?? null,
      bbox: p.bbox ?? null,
      startMs: p.startMs ?? null,
      endMs: p.endMs ?? null,
      quote: clip(p.text, 240),
    });
  }
  return { citations, unknown };
}

/* ── Data access (lazy db, so the pure pieces import without env) ───────── */

const dbLazy = async () => (await import("../../db.js")).default;

/**
 * A pasted record's pages, cut the way the reader cuts them
 * (readerPages.js): Map(pageNumber → { markdown, blocks: [] }). Page 1 is
 * the reader's cover, so content starts at 2. Empty for any other record.
 */
export async function pastedPagesFor(target) {
  if (!target || target.contentKey || target.kind !== "paste") return new Map();
  const db = await dbLazy();
  const { data } = await db.schema("edu").from("records").select("content").eq("id", target.recordId).maybeSingle();
  return pagesFromPaste(data?.content || "");
}

/** Pure: pasted text → Map(pageNumber → { markdown, blocks: [] }). */
export function pagesFromPaste(text) {
  return new Map(pastedTextPages(text).map((p) => [p.pageNumber, { markdown: p.text, blocks: [] }]));
}

/** Search hits on a paste (no page) → hits on the reader page that holds their words. */
export function pasteHitsToPages(hits, pages) {
  if (!pages.size) return hits;
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const texts = [...pages.entries()].map(([n, p]) => [n, norm(p.markdown)]);
  return hits.map((h) => {
    if (h.chunkKind !== "paste") return h;
    const needle = norm(h.text).slice(0, 80);
    const found = needle && texts.find(([, t]) => t.includes(needle));
    return found ? { ...h, chunkKind: "page", pageNumber: found[0] } : h;
  });
}

/**
 * The record whose chunks answer for a file: a learner's own paste/upload,
 * or — for a shared file — the OWNER's record (the chunks live there).
 * Access is the caller's job (routes reuse the extraction rule).
 */
export async function askTargetForRecord(rec) {
  if (!rec) return null;
  if (!rec.file_key) return { recordId: rec.id, ownerId: rec.user_id, contentKey: null, name: rec.name, kind: rec.kind };
  const db = await dbLazy();
  const { data: owner } = await db.schema("edu").from("records")
    .select("id, user_id, name, kind").eq("file_key", rec.file_key)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  const base = owner || rec;
  return { recordId: base.id, ownerId: base.user_id, contentKey: rec.file_key, name: rec.name || base.name, kind: base.kind };
}

/**
 * Gather passages for a question: search the record's chunks, load the
 * hit pages' extraction blocks, select. Falls back to the document's first
 * pages when search finds nothing (a small document, or no embeddings).
 */
export async function gatherPassages({ target, question, selection = null, search }) {
  const { recordId, ownerId, contentKey } = target;
  let hits = [];
  try {
    hits = await search({ userId: ownerId, q: `${question} ${selection?.text || ""}`.slice(0, 1000), limit: 10, recordId, full: true });
  } catch (e) {
    console.warn("[records-ask] search failed:", String(e?.message || e).slice(0, 160));
  }
  hits = hits.map((h) => ({ ...h, text: h.text ?? h.snippet ?? "" }));

  // A paste has no extraction: its pages are the reader's own cut, so the
  // answer cites pages that exist — even before search has indexed it.
  const pages = await pastedPagesFor(target);
  if (pages.size) {
    hits = pasteHitsToPages(hits, pages);
    if (!hits.some((h) => h.chunkKind === "page")) {
      hits = [...[...pages.keys()].slice(0, ASK_LIMITS.TOP_PAGES).map((pageNumber) => ({ chunkKind: "page", pageNumber, text: "" })), ...hits];
    }
  }
  if (contentKey) {
    const db = await dbLazy();
    const wanted = [...new Set([
      ...hits.filter((h) => h.chunkKind === "page" && Number.isInteger(h.pageNumber)).map((h) => h.pageNumber),
      ...(Number.isInteger(selection?.pageNumber) ? [selection.pageNumber] : []),
    ])];
    let q = db.schema("edu").from("content_parses").select("page_number, markdown, blocks").eq("content_key", contentKey);
    q = wanted.length ? q.in("page_number", wanted) : q.order("page_number").limit(ASK_LIMITS.TOP_PAGES);
    const { data } = await q;
    for (const row of data || []) {
      const blocks = typeof row.blocks === "string" ? JSON.parse(row.blocks || "[]") : (row.blocks || []);
      pages.set(row.page_number, { markdown: row.markdown || "", blocks });
    }
    // Nothing matched: answer from the opening pages instead of nothing.
    if (!hits.some((h) => h.chunkKind === "page") && pages.size) {
      hits = [...[...pages.keys()].sort((a, b) => a - b).map((pageNumber) => ({ chunkKind: "page", pageNumber, text: "" })), ...hits];
    }
  }
  return {
    passages: selectPassages({ hits, pages, question, selection }),
    indexed: hits.length > 0 || pages.size > 0,
  };
}

/* Before migrations/2026-record-chat-guide.sql is seen (or while the API's
   schema cache lags it) there is no channel column: Ask works as it always
   did; only the guide's thread needs it. */
const noChannel = (error) => error?.code === "42703" || error?.code === "PGRST204" ||
  (/channel/i.test(String(error?.message || "")) && /column|schema cache|could not find/i.test(String(error?.message || "")));

/** One thread per learner per document per channel: "ask" (the Ask tab) or "guide" (Learning with Guide). */
export async function loadAskHistory({ userId, recordId, limit = ASK_LIMITS.HISTORY_LIMIT, channel = "ask" }) {
  const db = await dbLazy();
  const query = (withChannel) => {
    let q = db.schema("edu").from("record_chat_messages")
      .select("id, role, text, citations, selection, created_at")
      .eq("user_id", userId).eq("record_id", recordId);
    if (withChannel) q = q.eq("channel", channel);
    return q.order("created_at", { ascending: false }).limit(limit);
  };
  let { data, error } = await query(true);
  if (error && noChannel(error)) {
    if (channel !== "ask") throw error;   // the guide's thread can't be told apart yet
    ({ data, error } = await query(false));
  }
  if (error) throw error;
  return (data || []).reverse().map((m) => ({
    id: m.id, role: m.role, text: m.text, citations: m.citations || [], selection: m.selection || null, createdAt: m.created_at,
  }));
}

/** The two rows of one turn — the same columns in both (see saveAskTurn). */
export function turnRows({ userId, recordId, question, selection = null, answer, citations = [], channel = null, now = Date.now() }) {
  const base = { user_id: userId, record_id: recordId, ...(channel ? { channel } : {}) };
  return [
    { ...base, role: "user", text: question, citations: [], selection: selection || null, created_at: new Date(now).toISOString() },
    { ...base, role: "assistant", text: answer, citations: Array.isArray(citations) ? citations : [], selection: null, created_at: new Date(now + 1).toISOString() },
  ];
}

export async function saveAskTurn({ userId, recordId, question, selection, answer, citations, channel = "ask" }) {
  const db = await dbLazy();
  const now = Date.now();
  // Both rows carry every column: a batch insert fills a column one row
  // leaves out with NULL (not its default), and citations is NOT NULL — the
  // learner's row without citations made every turn fail to save.
  const rows = (withChannel) => turnRows({ userId, recordId, question, selection, answer, citations, channel: withChannel ? channel : null, now });
  let { data, error } = await db.schema("edu").from("record_chat_messages").insert(rows(true)).select("id, role");
  // Without the column an Ask turn saves as before; a guide turn must not land in Ask's thread.
  if (error && noChannel(error) && channel === "ask") ({ data, error } = await db.schema("edu").from("record_chat_messages").insert(rows(false)).select("id, role"));
  if (error) throw error;
  return { assistantMessageId: (data || []).find((r) => r.role === "assistant")?.id || null };
}

/**
 * Clean a model reply for display/saving. Some models stream a reasoning pass
 * and then wrap the real answer in a <final>…</final> block (and can emit stray
 * control glyphs). Left raw, the reader showed the answer twice with a literal
 * "</final>" and junk like "ваҡ" between the copies. This keeps only the last
 * final block (or the text after the last closing sentinel), strips the tags,
 * and collapses an exact duplicated answer. Plain Markdown is untouched.
 */
export function cleanModelOutput(raw) {
  let s = String(raw || "").replace(/\r/g, "");
  const finals = [...s.matchAll(/<final>([\s\S]*?)<\/final>/gi)].filter((m) => m[1].trim());
  if (finals.length) {
    s = finals[finals.length - 1][1];
  } else {
    const i = s.lastIndexOf("</final>");
    if (i !== -1) {
      const after = s.slice(i + "</final>".length);
      s = after.trim() ? after : s.slice(0, i);
    }
  }
  s = s.replace(/<\/?final>/gi, "");
  // The model repeating its whole answer: collapse an exact duplicate.
  const t = s.trim();
  if (t.length >= 30 && t.length % 2 === 0) {
    const half = t.length / 2;
    const a = t.slice(0, half).trim();
    const b = t.slice(half).trim();
    if (a && a === b) s = a;
  } else if (t.length >= 30) {
    const mid = Math.floor(t.length / 2);
    const a = t.slice(0, mid).trim();
    const b = t.slice(mid).trim();
    if (a && a === b) s = a;
  }
  // Strip control / zero-width noise that can slip through a stream.
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\uFEFF]/g, "");
  return s.trim();
}
