/**
 * modules/records/studyMaterialCore.js — the pure decisions behind
 * make_study_material (records/studyMaterial.js), split out the way
 * materials/studySourceCore.js is: no db, no model, everything testable.
 *
 *   escapeLike(s)                       a name query made safe for ILIKE
 *                                       without deleting real characters
 *   rankContentHits(hits, { poolIds })  search hits → records ranked by
 *                                       relevance, not by hit count
 *   pickContentWinner(ranked)           one winner, or an honest choice
 *                                       when the top two are too close
 *   findDuplicateArtifact(list, want)   the saved tab an identical request
 *                                       already produced, if any
 *   passagesFromExtraction({...})       an extraction's pages as tool
 *                                       passages, when the index has none
 *   rankChatRecords(cands, query)       the read files of one chat, ranked
 *                                       against the learner's words
 *   pickChatRecord(cands, query)        the chat file to build from, or an
 *                                       honest choice when words can't tell
 */
import { pagePassages, samplePassages } from "./toolsLib.js";

export const STUDY_RESOLVE = Object.freeze({
  CLOSE_MARGIN: 0.10,        // top two within 10% of each other → ask, don't guess
  TOP_HITS_PER_RECORD: 3,    // a record's score sums only its best few hits
});

/**
 * Escape a string for a Postgres ILIKE pattern. The old code DELETED % and _
 * from the query — which also deleted the underscores in a real filename, so
 * "FB_IMG_1792564566090.jpg" could never match the record carrying that name.
 * Escaping keeps every character and makes the wildcards literal instead
 * (Postgres LIKE treats \ as its escape character).
 */
export function escapeLike(s) {
  return String(s || "").replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Rank the records behind content-search hits by RELEVANCE: a record's score
 * is the sum of its TOP_HITS_PER_RECORD best `fused` scores. The old ranking
 * counted hits, so a long document with a tail of weak mentions beat the
 * short document the learner meant, every time. Summing only the best few
 * keeps breadth worth something without letting volume win by itself.
 *
 * hits: [{ recordId, name, fused }] → [{ recordId, name, score, hits }]
 * best first; ties keep the order the search returned (its own ranking).
 */
export function rankContentHits(hits, { poolIds = null, names = null } = {}) {
  const by = new Map();
  for (const h of hits || []) {
    if (!h?.recordId) continue;
    if (poolIds && !poolIds.has(h.recordId)) continue;
    if (!by.has(h.recordId)) by.set(h.recordId, { recordId: h.recordId, name: (names?.get(h.recordId)) || h.name || "", fused: [] });
    by.get(h.recordId).fused.push(Number(h.fused) || 0);
  }
  return [...by.values()].map((e) => {
    const top = e.fused.sort((a, b) => b - a).slice(0, STUDY_RESOLVE.TOP_HITS_PER_RECORD);
    return { recordId: e.recordId, name: e.name, score: top.reduce((a, b) => a + b, 0), hits: e.fused.length };
  }).sort((a, b) => b.score - a.score);
}

/**
 * The record to build from, or a choice: when the runner-up scores within
 * CLOSE_MARGIN of the winner, picking silently is how the wrong document
 * gets a quiz — return both and let the learner say.
 * ranked → { recordId } | { needsChoice: [{ recordId, name }, …] } | null
 */
export function pickContentWinner(ranked, { margin = STUDY_RESOLVE.CLOSE_MARGIN } = {}) {
  const list = (ranked || []).filter((r) => r?.recordId);
  if (!list.length) return null;
  if (list.length === 1) return { recordId: list[0].recordId };
  const [top, second] = list;
  const close = top.score > 0 ? second.score >= top.score * (1 - margin) : second.score === 0;
  return close
    ? { needsChoice: list.slice(0, 2).map((r) => ({ recordId: r.recordId, name: r.name })) }
    : { recordId: top.recordId };
}

/* ── "This material": choosing among the read files of one chat ─────────────
   The candidates are what the chat's ingests read — each with the name the
   record carries and what its read found (title, subject, topic names).
   Matching is word overlap, weighted by where the word lives: the record's
   own name first, then the read's title and topics, then its subject. Words
   that only point ("this material", "the photo I uploaded") carry no topic,
   so they score nothing — and nothing scored means ask, don't guess. */

const CHAT_STOPWORDS = new Set([
  "the", "and", "for", "from", "with", "this", "that", "these", "those", "its",
  "file", "files", "material", "materials", "photo", "picture", "image", "pdf",
  "doc", "document", "documents", "uploaded", "upload", "sent", "send", "just",
  "please", "make", "create", "quiz", "flashcards", "summary", "podcast",
]);

const matchTokens = (text) => new Set(
  String(text || "").toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !CHAT_STOPWORDS.has(t)),
);
const normPhrase = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The chat's read files ranked against the learner's words.
 * candidates: [{ recordId, name, title, subject, topics: [names] }]
 * → [{ recordId, name, score }] best first; ties keep the input order
 * (the loader lists the newest upload first, so a tie favours it).
 */
export function rankChatRecords(candidates, query = "") {
  const qTokens = matchTokens(query);
  const phrase = normPhrase(query);
  return (candidates || []).filter((c) => c?.recordId).map((c) => {
    const fields = [
      { tokens: matchTokens(c.name), w: 3 },
      { tokens: matchTokens(c.title), w: 2 },
      { tokens: matchTokens((c.topics || []).join(" ")), w: 2 },
      { tokens: matchTokens(c.subject), w: 1 },
    ];
    let score = 0;
    for (const t of qTokens) for (const f of fields) if (f.tokens.has(t)) score += f.w;
    if (phrase.length >= 4) {
      if (normPhrase(c.name).includes(phrase)) score += 6;
      else if (normPhrase(c.title).includes(phrase)) score += 4;
    }
    return { recordId: c.recordId, name: c.name || "", score };
  }).sort((a, b) => b.score - a.score);
}

/**
 * The one chat file to build from: a single read file is the file, whatever
 * the words. Several: the best match wins, a close call (the same 10% margin
 * as pickContentWinner) comes back as a choice, and when the words carry no
 * topic at all every candidate is offered — pointing words can't pick.
 * → { recordId } | { needsChoice: [{ recordId, name }, …] } | null
 */
export function pickChatRecord(candidates, query = "") {
  const list = (candidates || []).filter((c) => c?.recordId);
  if (!list.length) return null;
  if (list.length === 1) return { recordId: list[0].recordId };
  const ranked = rankChatRecords(list, query);
  if (ranked[0].score <= 0) {
    return { needsChoice: list.slice(0, 6).map((c) => ({ recordId: c.recordId, name: c.name || "" })) };
  }
  return pickContentWinner(ranked);
}

const normParam = (v) => String(v ?? "").trim();

/**
 * The saved tab an identical request already produced: same kind, same page
 * (null = the whole document), same knobs the learner set — focus + count +
 * difficulty for the generated tools, focus + length for a podcast. Values
 * compare as trimmed strings (the reader may store a count as a number).
 * artifacts are the API shape (listArtifacts): { id, kind, pageNumber, params }.
 */
export function findDuplicateArtifact(artifacts, { kind, pageNumber = null, focus = "", count = "", difficulty = "", length = "" } = {}) {
  return (artifacts || []).find((a) => {
    if (!a || a.kind !== kind) return false;
    if ((a.pageNumber ?? null) !== (pageNumber ?? null)) return false;
    const p = a.params || {};
    if (normParam(p.focus) !== normParam(focus)) return false;
    if (kind === "podcast") return normParam(p.length) === normParam(length);
    return normParam(p.count) === normParam(count) && normParam(p.difficulty) === normParam(difficulty);
  }) || null;
}

/**
 * Passages from an extraction's pages — the getExtraction shape
 * [{ pageNumber, markdown, blocks }] that the ingest read consumes — using
 * the same passage builders as the chunk path, so every item still cites a
 * real page (and box, when the extraction has blocks). This is the fallback
 * that makes a record whose text exists only as an extraction buildable.
 */
/* ── Platform (Discover) tier ───────────────────────────────────────────────
   When the learner's own Library has nothing, the same resolution runs over
   the community's free notes — the records the Discover feed shows. The
   chunk search there is lexical only (the hybrid RPC is owner-scoped), so a
   hit's score is the share of the query's significant terms its text
   carries: a passage that covers every term the learner used outranks one
   that merely repeats a single word. rankContentHits then sums a record's
   best few, and pickContentWinner applies the same 10% close-call margin —
   the platform tier asks rather than guesses, exactly like the own tier. */

const PLATFORM_EXTRA_STOPWORDS = new Set(["note", "notes", "topic", "topics", "chapter", "unit"]);

/** The query's significant terms: matchTokens' rules, as a list (cap 6). */
export function platformTerms(query = "") {
  return [...matchTokens(query)].filter((t) => !PLATFORM_EXTRA_STOPWORDS.has(t)).slice(0, 6);
}

/** 0..1 — the share of the query terms this text carries (each term once). */
/**
 * The platform matches that would actually help (Matt, 2026-11-16): when
 * Discover holds several good materials for a topic, they are gathered into
 * a folder and built from together instead of asking the learner to pick.
 * ranked (best first, score > 0) → every record scoring at least `minShare`
 * of the winner, capped. → [{ recordId, name, score }] (possibly one).
 */
export function platformHelpfulSet(ranked, { cap = 5, minShare = 0.5 } = {}) {
  const list = (ranked || []).filter((r) => r?.recordId && Number(r.score) > 0);
  if (!list.length) return [];
  const top = Number(list[0].score) || 0;
  return list.filter((r) => Number(r.score) >= top * minShare).slice(0, Math.max(1, cap));
}

/** The title a multi-source Discover build is saved under: the topic, titled. */
export function platformTopicName(query = "") {
  const words = String(query || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!words) return "Discover notes";
  return words.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function platformChunkScore(text = "", terms = []) {
  const list = (terms || []).filter(Boolean);
  if (!list.length) return 0;
  const hay = String(text || "").toLowerCase();
  const hit = list.filter((t) => hay.includes(t)).length;
  return hit / list.length;
}

export function passagesFromExtraction({ pages = [], scope = "document", pageNumber = null } = {}) {
  const list = (pages || []).filter((p) => p && (String(p.markdown || "").trim() || (Array.isArray(p.blocks) && p.blocks.length)));
  if (!list.length) return [];
  if (scope === "page" && Number.isInteger(pageNumber)) {
    const page = list.find((p) => p.pageNumber === pageNumber);
    return page ? pagePassages(pageNumber, page) : [];
  }
  return samplePassages(new Map(list.map((p) => [p.pageNumber, { markdown: p.markdown || "", blocks: p.blocks || [] }])));
}

/* ── Source actions (Matt, 2026-11-16) ─────────────────────────────────────
   make_study_material behaves like a domain tool: ONE tool, and the source
   is its action — taught (the learner's taught notes) · library (their
   documents) · discover (free notes in Discover) · upload (a file sent in
   this chat). For a bare topic ask the model works through the chain in
   order; every miss names the next source to try, so the cascade the
   resolver used to run silently now happens as visible tool calls.
   Upload is explicit intent ("this material") — it is never chained into
   and never chained out of. */
export const SOURCE_ACTIONS = Object.freeze(["taught", "library", "discover", "upload"]);
export const SOURCE_CHAIN = Object.freeze(["taught", "library", "discover"]);

export function nextSource(source) {
  const i = SOURCE_CHAIN.indexOf(source);
  return i >= 0 && i < SOURCE_CHAIN.length - 1 ? SOURCE_CHAIN[i + 1] : null;
}

const MISS_TEXT = Object.freeze({
  taught: (q) => `Nothing the learner has taught their agent covers "${q}" yet.`,
  library: (q) => `No document in their Library matches "${q}".`,
  discover: (q) => `No free notes in Discover match "${q}" either.`,
  upload: () => "No file sent in this chat has been read yet.",
});

/** The result of a source action that found nothing: what missed, and the
 *  next source to try (or, at the end of the chain, the ways forward). */
export function sourceMiss({ source, query = "" } = {}) {
  const q = String(query || "").trim().slice(0, 120);
  const next = nextSource(source);
  const text = (MISS_TEXT[source] || MISS_TEXT.library)(q);
  return {
    error: text, code: "no_match", source,
    ...(next ? { next } : {}),
    note: next
      ? `Don't report failure yet — call make_study_material again with source "${next}" to try the next source.`
      : "Every source has been tried — tell the learner nothing was found, don't invent material, and offer the ways forward: teach you the topic, or upload the document.",
  };
}

/** The Library record a taught build materialises: one per topic. */
export function taughtRecordName(query = "") {
  return `Taught notes · ${platformTopicName(query)}`;
}

/** The taught record's text: the topic as the title, then each taught
 *  chunk under its own heading (topic — subject), in the order given. */
export function taughtNotesText({ topic = "", chunks = [] } = {}) {
  const parts = [`# ${topic}`];
  for (const c of chunks || []) {
    const body = String(c?.content || "").trim();
    if (!body) continue;
    const head = [c?.topic, c?.subject].map((s) => String(s || "").trim()).filter(Boolean).join(" — ");
    if (head) parts.push(`## ${head}`);
    parts.push(body);
  }
  return parts.join("\n\n");
}
