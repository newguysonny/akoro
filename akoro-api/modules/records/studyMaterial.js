/**
 * modules/records/studyMaterial.js — the reader's study tools, callable from
 * anywhere (the reader's routes and Agent Chat).
 *
 *   generateToolResult({ userId, target, tool, scope, pageNumber, pageText, values })
 *       summary | quiz | flashcards → { result } | { status, message }
 *   startPodcast({ userId, target, scope, pageNumber, pageText, values })
 *       → { artifact } (status "making"; the episode is finished in the background) | { status, message }
 *   toReaderContent(tool, result)   the tab content the reader shows (its citation shape)
 *   makeStudyMaterial({ userId, tool, query, folder, focus, count, difficulty, length,
 *                       conversationId, fromChatFile, source })
 *       Agent Chat: build the tool from the WHOLE document, save it as a
 *       reader tab. WHERE it comes from is the source action (like a domain
 *       tool's actions): "taught" (the learner's taught notes, materialised
 *       as a Library record), "library" (their documents — or the best one
 *       in a named folder), "discover" (Discover's free notes: one winner is
 *       first copied into their Library, several that would help become ONE
 *       gathered content), "upload" (a file they sent in this chat). An
 *       explicit action runs only its resolver; a miss returns
 *       { code: "no_match", next } naming the next source to try. No source
 *       runs the whole cascade in one call (taught → library → discover).
 *       The result carries the winning source →
 *       { made, tool, recordId, artifactId, name, href, count } | { needsChoice } | { error }
 *
 * Whatever chat makes is the same saved item the reader makes (edu.record_artifacts),
 * so the link `/library?record=<id>&artifact=<id>` opens the reader on that tab.
 */
import db from "../../db.js";
import { openai } from "../../lib/aiModel.js";
import { TOOL_IDS, TOOL_LIMITS, toolSchema, toolCount, buildToolMessages, shapeToolResult, gatherToolPassages, citeOf, pagePassages } from "./toolsLib.js";
import { searchRecordChunks, searchPlatformChunks, indexRecord } from "./searchLib.js";
import { getExtraction } from "./extractLib.js";
import { escapeLike, rankContentHits, pickContentWinner, findDuplicateArtifact, passagesFromExtraction, pickChatRecord, platformTerms, platformChunkScore, platformHelpfulSet, platformTopicName, SOURCE_ACTIONS, sourceMiss, taughtRecordName, taughtNotesText } from "./studyMaterialCore.js";
import { createArtifact, listArtifacts, updateArtifact } from "./artifactsLib.js";
import { PODCAST_LIMITS, lengthOf, podcastSchema, podcastInFlight, runPodcastJob } from "./podcastLib.js";
import { coinsAvailable, debitCoins } from "../../lib/coins.js";
import { coinsForTtsChars } from "../../lib/aiPricing.js";
import { getAiBillTo } from "../../lib/aiContext.js";

export const CHAT_STUDY_TOOLS = Object.freeze(["quiz", "flashcards", "summary", "podcast"]);
const LABEL = { quiz: "Quiz", flashcards: "Flashcards", summary: "Summary", podcast: "Podcast" };
const UUID = /^[0-9a-f-]{36}$/i;
const clean = (s, n) => (typeof s === "string" || typeof s === "number" ? String(s).slice(0, n) : "");

export function toolValues(raw = {}) {
  return {
    focus: clean(raw.focus, TOOL_LIMITS.MAX_FOCUS_CHARS),
    depth: clean(raw.depth, 20),
    count: clean(raw.count, 3),
    difficulty: clean(raw.difficulty, 10),
  };
}

/** One structured model call over numbered passages; every item cites its passage. */
/**
 * The extraction fallback: the gather reads the search index and the stored
 * pages under the target's content key; a target built without its key (or a
 * record the index has nothing for) reaches here empty-handed. The record's
 * own extraction — the same pages the ingest read consumed — becomes the
 * passages, so a document that was read is always buildable. Never throws.
 */
async function extractedPassages({ target, scope, pageNumber }) {
  try {
    let key = target?.contentKey || null;
    if (!key && target?.recordId && UUID.test(String(target.recordId))) {
      const { data } = await db.schema("edu").from("records").select("file_key").eq("id", target.recordId).maybeSingle();
      key = data?.file_key || null;
    }
    if (!key) return [];
    const ext = await getExtraction(key).catch(() => null);
    return passagesFromExtraction({ pages: ext?.pages || [], scope, pageNumber });
  } catch { return []; }
}

export async function generateToolResult({ userId = null, target, tool, scope = "document", pageNumber = null, pageText = "", values = {}, feature = null }) {
  if (!TOOL_IDS.includes(tool)) return { status: 400, message: `tool must be one of: ${TOOL_IDS.join(", ")}.` };
  let passages = await gatherToolPassages({ target, scope, pageNumber, pageText, focus: values.focus, search: searchRecordChunks });
  if (!passages.length) passages = await extractedPassages({ target, scope, pageNumber });
  if (!passages.length) {
    return { status: 409, message: scope === "page"
      ? "This page has no readable text yet — extract the document's text first."
      : "This document isn't readable yet — extract its text (or transcribe the recording) first." };
  }
  const stripFence = (t) => String(t || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  // Providers answer in prose, with a fenced block, or JSON plus a sentence.
  const parseJson = (t) => {
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
  };
  const itemsOf = (json) => (tool === "summary" ? json?.points : tool === "quiz" ? json?.questions : json?.cards) || [];
  try {
    const messages = buildToolMessages({ tool, docName: target.name, passages, values });
    const base = {
      __role: "background", temperature: 0.3, max_tokens: tool === "quiz" ? 2400 : 1600,
      ...(userId ? { __userId: userId } : {}), ...(feature ? { __feature: feature } : {}),
    };
    // 1) strict schema where the provider honours it (OpenAI-family models).
    let completion = null, json = null, firstError = null;
    try {
      completion = await openai.chat.completions.create({
        ...base, messages,
        response_format: { type: "json_schema", json_schema: { name: `reader_${tool}`, strict: true, schema: toolSchema(tool) } },
      });
      json = parseJson(completion.choices?.[0]?.message?.content);
    } catch (e) { firstError = e; }
    // 2) JSON mode + the schema in the prompt. DeepSeek/GLM via OpenCode often
    // ignore json_schema and answer in prose; this keeps generation working.
    if (!itemsOf(json || {}).length) {
      try {
        completion = await openai.chat.completions.create({
          ...base,
          messages: [...messages, { role: "system", content: `Return ONLY one JSON object matching this JSON Schema:\n${JSON.stringify(toolSchema(tool))}` }],
          response_format: { type: "json_object" },
        });
        json = parseJson(completion.choices?.[0]?.message?.content);
      } catch (e) { firstError = firstError || e; }
    }
    if (!json) {
      const raw = String(completion?.choices?.[0]?.message?.content || "");
      console.warn("[records-tools] unparseable", tool, raw.slice(0, 300));
      // Summary has a safe, extractive fallback: the passages ARE the material.
      if (tool === "summary") {
        const max = toolCount("summary", values);
        const points = passages.slice(0, Math.max(1, Math.min(8, max))).map((p) => ({
          text: String(p.text || "").split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 600),
          cite: citeOf(p),
        })).filter((p) => p.text.trim());
        if (points.length) return { result: { summaryPoints: points, passages: passages.length, extracted: true } };
      }
      throw firstError || new Error("the model returned no JSON");
    }
    const result = shapeToolResult(tool, json, passages, values);
    const items = result.summaryPoints || result.quizQuestions || result.cardSet || [];
    if (!items.length) {
      // Bounded diagnostics: enough to see why a batch was dropped.
      console.warn("[records-tools] empty result", tool, JSON.stringify(json).slice(0, 600));
      return { status: 422, message: "Couldn't build that from this material — try a different page or focus." };
    }
    return { result: { ...result, passages: passages.length } };
  } catch (err) {
    if (err?.name === "InsufficientCoins") return { status: 402, message: "You're out of AI credit — top up to keep generating." };
    console.warn("[records-tools] failed:", String(err?.message || err).slice(0, 200));
    return { status: 424, message: "Couldn't generate that right now — try again in a moment." };
  }
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

/** Start a two-voice episode: the item exists at once ("making"), the episode follows. */
export async function startPodcast({ userId, target, scope = "document", pageNumber = null, pageText = "", values = {}, deps }) {
  const billTo = getAiBillTo();
  const { ok } = await coinsAvailable({ userId, billTo, min: 1 });
  if (!ok) return { status: 402, message: "You're out of AI credit — top up to make episodes.", code: "INSUFFICIENT_COINS" };
  const anchor = target.folderId ? { folderId: target.folderId } : { recordId: target.recordId };
  const existing = await listArtifacts({ userId, ...anchor });
  if (existing.some((a) => a.kind === "podcast" && podcastInFlight(a.content))) {
    return { status: 409, message: "An episode for this document is already being made — it'll be ready in a minute or two." };
  }
  const focus = clean(values.focus, TOOL_LIMITS.MAX_FOCUS_CHARS);
  const length = lengthOf(values.length);
  const startedAt = new Date().toISOString();
  const created = await createArtifact({
    userId, ...anchor,
    row: {
      kind: "podcast", page_number: pageNumber, open: true,
      params: { focus, length: typeof values.length === "string" ? values.length.slice(0, 40) : length.id, scope: scope === "document" ? "Whole document" : "This page" },
      content: { podcast: { status: "making", length: length.id, startedAt } },
    },
  });
  if (created.error) return { status: 409, message: created.error };
  const artifactId = created.artifact.id;
  let spokeWith = PODCAST_LIMITS.TTS_MODEL;
  void runPodcastJob({ artifactId, target, scope, pageNumber, pageText, focus, length, startedAt }, {
    gather: (args) => gatherToolPassages({ ...args, search: searchRecordChunks }),
    chat: async (messages, len) => {
      const completion = await openai.chat.completions.create({
        __role: "background", temperature: 0.7, max_tokens: len.maxTokens, messages,
        response_format: { type: "json_schema", json_schema: { name: "reader_podcast", strict: true, schema: podcastSchema() } },
        __userId: userId, __billTo: billTo, __feature: "reader_podcast",
      });
      return completion.choices?.[0]?.message?.content || "{}";
    },
    speak: async (input, voice) => {
      const { model, buffer } = await deps.speakBuffer({ text: input, voice, openai });
      spokeWith = model;
      return buffer;
    },
    charge: (chars) => debitCoins({ userId, billTo, coins: coinsForTtsChars(spokeWith, chars), feature: "reader_podcast_tts", model: spokeWith, ref: artifactId }),
    store: (audio) => deps.putRecordObject({ userId, name: `podcasts/${artifactId}.mp3`, body: audio, contentType: "audio/mpeg" }),
    update: (id, content) => updateArtifact({ userId, id, patch: { content, updated_at: new Date().toISOString() } }),
  });
  return { artifact: created.artifact };
}

async function podcastDeps() {
  const [{ speakBuffer }, { putRecordObject }] = await Promise.all([import("../voice/tts.js"), import("./storage.js")]);
  return { speakBuffer, putRecordObject };
}

/**
 * The read files of one chat, newest upload first — the candidates behind
 * "this material". The mechanism is the ingest pipeline's own: an ingest row
 * names its records (record_ids) and, once its read has run, carries what the
 * read found per file (structure.items, keyed by recordId) — the same rows
 * chatFilesBrief narrates from. Only files a read actually covered count
 * (an ingest can hold more files than one read covers), and only records
 * still live in the learner's Library. → [{ recordId, name, title, subject, topics }]
 */
async function chatReadRecords({ userId, conversationId }) {
  const E = db.schema("edu");
  const { data: rows } = await E.from("material_ingests")
    .select("record_ids, structure")
    .eq("user_id", userId).eq("chat_session_id", conversationId)
    .neq("state", "undone").not("structure", "is", null)
    .order("created_at", { ascending: false }).limit(10);
  const byRecord = new Map();
  for (const row of rows || []) {
    const items = Array.isArray(row.structure?.items) ? row.structure.items : [];
    for (const id of row.record_ids || []) {
      if (!UUID.test(String(id)) || byRecord.has(id)) continue;
      const it = items.find((x) => String(x?.recordId) === String(id)) || null;
      if (!it) continue; // saved in this chat, but no read covered it
      byRecord.set(id, {
        recordId: id, itemName: it.name || "", title: it.title || "", subject: it.subject || "",
        topics: (it.topics || []).map((t) => t?.name).filter(Boolean),
      });
    }
  }
  if (!byRecord.size) return [];
  const { data: recs } = await E.from("records").select("id, name")
    .eq("user_id", userId).is("deleted_at", null).in("id", [...byRecord.keys()]);
  const liveById = new Map((recs || []).map((r) => [r.id, r]));
  return [...byRecord.values()].filter((c) => liveById.has(c.recordId))
    .map((c) => ({ recordId: c.recordId, name: liveById.get(c.recordId).name || c.itemName || "Untitled",
      title: c.title, subject: c.subject, topics: c.topics }));
}

/* ── The platform tier (Discover) ───────────────────────────────────────────
   Reached only when the learner's own Library has nothing: the community's
   free notes — the records the Discover feed shows (uploads and pastes, not
   private, not deleted, never a Premium subscriber's, never the learner's
   own). Name first (the feed's own signal), then content. A winner is NOT
   built from directly: makeStudyMaterial first saves the learner their own
   copy (copyPlatformRecord), because reader access is owner-only — the
   artifact, its card and its dedupe all hang off a record the learner owns.
   The shared content key means the copy costs no re-upload and no re-parse:
   the extraction the owner paid for answers for both. */

async function platformOwners(E, rows) {
  const ids = [...new Set((rows || []).map((r) => r.user_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data: users } = await E.from("users").select("id, full_name").in("id", ids);
  return new Map((users || []).map((u) => [u.id, u.full_name || "Learner"]));
}

async function platformFind({ userId, q }) {
  const E = db.schema("edu");
  const { activePremiumUserIds } = await import("./access.js");
  const premium = await activePremiumUserIds().catch(() => []);
  const discoverable = (query) => {
    let x = query.eq("private", false).in("kind", ["upload", "paste"])
      .is("deleted_at", null).neq("user_id", userId);
    if (premium.length) x = x.not("user_id", "in", `(${premium.join(",")})`);
    return x;
  };
  // By name first — a free note actually called what the learner asked for.
  const { data: named } = await discoverable(E.from("records").select("id, name, user_id, kind, file_key"))
    .ilike("name", `%${escapeLike(q)}%`).order("created_at", { ascending: false }).limit(6);
  if (named?.length) {
    const owners = await platformOwners(E, named);
    const withOwners = named.map((r) => ({ ...r, ownerName: owners.get(r.user_id) || "Learner" }));
    if (withOwners.length === 1) {
      const r = withOwners[0];
      return { record: { id: r.id, name: r.name }, platform: { ownerId: r.user_id, ownerName: r.ownerName } };
    }
    // Several free notes carry the topic's name: all of them would help —
    // they become ONE gathered content (Matt, 2026-11-16), not a question.
    return { records: withOwners.slice(0, 5).map((r) => ({ id: r.id, name: r.name, ownerId: r.user_id, ownerName: r.ownerName, kind: r.kind, file_key: r.file_key || null })) };
  }
  // Then by what is inside: lexical chunk hits over Discover-eligible
  // records, scored by term coverage, ranked like the own-Library tier.
  const hits = await searchPlatformChunks({ userId, q, limit: 60 }).catch(() => []);
  if (!hits.length) return null;
  const terms = platformTerms(q);
  const ownersByRecord = new Map(hits.map((h) => [h.recordId, { ownerId: h.ownerId, ownerName: h.ownerName }]));
  const ranked = rankContentHits(hits.map((h) => ({ ...h, fused: platformChunkScore(h.text, terms) })));
  // One clear source builds alone; several that would help build together
  // from a folder (platformHelpfulSet) — the platform tier no longer asks
  // the learner to choose between near-equal free notes.
  const set = platformHelpfulSet(ranked);
  if (!set.length) return null;
  if (set.length === 1) {
    const rec = hits.find((h) => h.recordId === set[0].recordId);
    if (!rec) return null;
    return { record: { id: rec.recordId, name: rec.name },
      platform: { ownerId: rec.ownerId, ownerName: rec.ownerName } };
  }
  const { data: full } = await E.from("records").select("id, kind, file_key").in("id", set.map((e) => e.recordId));
  const fullById = new Map((full || []).map((r) => [r.id, r]));
  return { records: set.map((e) => {
    const h = hits.find((x) => x.recordId === e.recordId);
    const owner = ownersByRecord.get(e.recordId) || {};
    const f = fullById.get(e.recordId) || {};
    return { id: e.recordId, name: e.name || h?.name || "", ownerId: owner.ownerId || h?.ownerId || null, ownerName: owner.ownerName || h?.ownerName || null, kind: f.kind || null, file_key: f.file_key || null };
  }) };
}

/**
 * Save the learner their own copy of a Discover record, re-verifying the
 * discovery rule at copy time (a record made private, deleted or Premium
 * since the search must not be copied). The copy is private (it never
 * re-enters the feed as a duplicate) and points at the SAME file, so the
 * shared extraction answers for it; a paste copies its text. An existing
 * copy of the same file is reused, never duplicated.
 * → { record } | { error }
 */
async function copyPlatformRecord({ userId, sourceId }) {
  const E = db.schema("edu");
  const { data: src } = await E.from("records")
    .select("id, user_id, kind, name, mime, size, duration, file_key, content, private")
    .eq("id", sourceId).is("deleted_at", null).maybeSingle();
  if (!src || src.user_id === userId || src.private || !["upload", "paste"].includes(src.kind)) {
    return { error: "That free note isn't available anymore — say so and offer another way." };
  }
  const { activePremiumUserIds } = await import("./access.js");
  const premium = await activePremiumUserIds().catch(() => []);
  if (premium.includes(src.user_id)) return { error: "That free note isn't available anymore — say so and offer another way." };
  if (src.kind === "upload" && src.file_key) {
    const { data: existing } = await E.from("records").select("id, name")
      .eq("user_id", userId).eq("file_key", src.file_key).is("deleted_at", null)
      .order("created_at", { ascending: true }).limit(1);
    if (existing?.[0]) return { record: existing[0] };
  }
  const { count } = await E.from("records").select("id", { count: "exact", head: true })
    .eq("user_id", userId).is("deleted_at", null);
  if ((count || 0) >= 200) return { error: "Their Library shelf is full (200) — ask them to remove something before saving a copy of a free note." };
  const { data: copy, error } = await E.from("records").insert({
    user_id: userId, kind: src.kind, name: src.name,
    mime: src.mime || null, size: src.size || 0,
    duration: src.duration ?? null,
    file_key: src.kind === "upload" ? src.file_key : null,
    content: src.kind === "paste" ? src.content : null,
    private: true,
  }).select("id, name").single();
  if (error || !copy) return { error: "Couldn't save a copy of that free note to their Library — try again in a moment." };
  // The create route's indexing, mirrored: the name always, a paste's text
  // too. An upload copy needs no page chunks — generation reads the shared
  // extraction by content key. Fire-and-forget, like the route.
  void indexRecord({ userId, recordId: copy.id, name: copy.name, contentKey: src.file_key || null,
    pasteText: src.kind === "paste" ? src.content : null });
  return { record: copy };
}

/* ── The gathered content (Matt, 2026-11-16) ───────────────────────────────
   Several Discover materials would help: instead of copying them into a
   folder, the agent writes ONE content from them — a single text saved in
   the learner's Library (a paste record; text already opens in the reader),
   cited to its sources with numbered markers. The record's `sources` jsonb
   is the citation map: marker → the ORIGINAL record, so the reader can open
   the source from a citation and come back. Study materials then generate
   from this one content like from any document. */

/** Readable passages of ONE Discover source, server-side: an upload reads
 *  its shared extraction, a paste reads its own text. → [passage] */
async function gatherSourcePassages(source) {
  try {
    if (source.kind === "paste") {
      const E = db.schema("edu");
      const { data } = await E.from("records").select("content").eq("id", source.id).maybeSingle();
      const text = String(data?.content || "");
      return text ? pagePassages(1, { markdown: text }) : [];
    }
    if (source.file_key) {
      const ext = await getExtraction(source.file_key).catch(() => null);
      return passagesFromExtraction({ pages: ext?.pages || [], scope: "document" });
    }
    return [];
  } catch { return []; }
}

const GATHER_LIMITS = Object.freeze({ PER_SOURCE_PASSAGES: 6, PER_SOURCE_CHARS: 6000, TOTAL_CHARS: 16000 });

/**
 * Write the gathered content's text from the sources' passages: one model
 * call for cited study notes (sections whose facts carry their source's
 * [n] marker); if the model can't, an extractive assembly — each source's
 * own section, its passages as paragraphs, the marker at each paragraph's
 * end. Either way the text ends with the Sources list the markers key to.
 * sources: [{ name, ownerName, passages }] (already in marker order).
 */
async function synthesiseGatheredText({ userId, topic, sources }) {
  const footer = ["", "Sources", ...sources.map((s, i) => `[${i + 1}] ${s.name} — ${s.ownerName || "another learner"} (free notes in Discover)`)].join("\n");
  const fallback = () => {
    const parts = [`# ${topic}`];
    sources.forEach((s, i) => {
      parts.push(`## ${s.name}`);
      for (const p of s.passages) parts.push(`${String(p.text || "").trim()} [${i + 1}]`);
    });
    return parts.join("\n\n") + "\n\n" + footer;
  };
  try {
    const blocks = [];
    let budget = GATHER_LIMITS.TOTAL_CHARS;
    sources.forEach((s, i) => {
      const texts = [];
      let used = 0;
      for (const p of s.passages.slice(0, GATHER_LIMITS.PER_SOURCE_PASSAGES)) {
        const t = String(p.text || "").trim();
        if (!t || used + t.length > GATHER_LIMITS.PER_SOURCE_CHARS || budget - t.length < 0) break;
        texts.push(t); used += t.length; budget -= t.length;
      }
      if (texts.length) blocks.push(`SOURCE [${i + 1}] — "${s.name}" by ${s.ownerName || "another learner"}:\n${texts.join("\n")}`);
    });
    if (!blocks.length) return fallback();
    const messages = [
      { role: "system", content: "You write clear study notes for a learner from excerpts of other learners' free notes. Write ONE set of notes on the topic, organised into short sections with headings. Use ONLY the excerpts — never invent facts. After each fact, cite the source it came from with its marker, like [1]. Keep the notes tight and readable. Return ONLY one JSON object: {\"sections\": [{\"heading\": \"...\", \"body\": \"...\"}]}." },
      { role: "user", content: `Topic: ${topic}\n\n${blocks.join("\n\n")}` },
    ];
    let json = null;
    for (const format of [{ type: "json_object" }, null]) {
      try {
        const completion = await openai.chat.completions.create({
          __role: "background", __userId: userId, __feature: "chat_gather_content",
          temperature: 0.3, max_tokens: 2400, messages,
          ...(format ? { response_format: format } : {}),
        });
        const raw = String(completion.choices?.[0]?.message?.content || "").trim()
          .replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
        const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
        if (a >= 0 && b > a) { const parsed = JSON.parse(raw.slice(a, b + 1)); if (Array.isArray(parsed?.sections) && parsed.sections.length) { json = parsed; break; } }
      } catch { /* try the next format, then the fallback */ }
    }
    if (!json) return fallback();
    const parts = [`# ${topic}`];
    for (const s of json.sections) {
      const heading = String(s?.heading || "").trim();
      const body = String(s?.body || "").trim();
      if (!body) continue;
      if (heading) parts.push(`## ${heading}`);
      parts.push(body);
    }
    return parts.length > 1 ? parts.join("\n\n") + "\n\n" + footer : fallback();
  } catch { return fallback(); }
}

/**
 * Build the gathered content for a multi-source platform hit and save it as
 * ONE text record in the learner's Library. Sources are re-verified against
 * the discovery rule first (a note made private, deleted or Premium since
 * the search must not be gathered). The record is private — it is a
 * derivative of other learners' notes, not the learner's own upload.
 * → { record, sources: [{ marker, recordId, name, ownerName, contentKey, kind }] } | { error }
 */
async function buildGatheredContent({ userId, query, sources }) {
  const E = db.schema("edu");
  const { activePremiumUserIds } = await import("./access.js");
  const premium = await activePremiumUserIds().catch(() => []);
  const { data: rows } = await E.from("records")
    .select("id, user_id, kind, name, file_key, private")
    .in("id", (sources || []).map((s) => s.id)).is("deleted_at", null);
  const byId = new Map((rows || []).map((r) => [r.id, r]));
  const usable = [];
  for (const s of sources || []) {
    const row = byId.get(s.id);
    if (!row || row.user_id === userId || row.private || premium.includes(row.user_id)) continue;
    const passages = await gatherSourcePassages({ ...s, kind: row.kind, file_key: row.file_key });
    if (passages.length) usable.push({ ...s, kind: row.kind, file_key: row.file_key || null, passages });
  }
  if (!usable.length) return { error: "Those free notes aren't available anymore — say so and offer another way." };
  const { count } = await E.from("records").select("id", { count: "exact", head: true })
    .eq("user_id", userId).is("deleted_at", null);
  if ((count || 0) >= 200) return { error: "Their Library shelf is full (200) — ask them to remove something before saving gathered notes." };
  const topic = platformTopicName(query);
  const text = await synthesiseGatheredText({ userId, topic, sources: usable });
  const citations = usable.map((s, i) => ({
    marker: i + 1, recordId: s.id, name: s.name, ownerName: s.ownerName || null,
    contentKey: s.file_key || null, kind: s.kind || null,
  }));
  const { data: record, error } = await E.from("records").insert({
    user_id: userId, kind: "paste", name: topic, content: text, size: text.length,
    private: true, sources: citations,
  }).select("id, name").single();
  if (error || !record) return { error: "Couldn't save the gathered notes to their Library — try again in a moment." };
  void indexRecord({ userId, recordId: record.id, name: record.name, pasteText: text });
  return { record, sources: citations };
}

/* ── The taught source (agent knowledge) ───────────────────────────────────
   What the learner taught their agent lives in edu.agent_knowledge as
   chunks (topic, subject, content, confidence) under their agent's row in
   edu.student_agents. A taught build materialises the matching chunks as
   ONE Library record — "Taught notes · <Topic>", a private paste — and
   generates from it like from any document, so the artifact, its card and
   its dedupe all hang off a record the learner owns and can open. The
   record is kept current: when the taught chunks change, its text is
   rewritten in place rather than duplicated. */

async function taughtFind({ userId, q }) {
  const terms = platformTerms(q);
  if (!terms.length) return null;
  const E = db.schema("edu");
  const { data: agent } = await E.from("student_agents").select("id").eq("student_id", userId).maybeSingle();
  if (!agent?.id) return null;
  const ors = terms.flatMap((t) => {
    const p = `%${escapeLike(t)}%`;
    return [`topic.ilike.${p}`, `subject.ilike.${p}`, `content.ilike.${p}`];
  }).join(",");
  const { data: rows } = await E.from("agent_knowledge")
    .select("topic, subject, content, confidence")
    .eq("agent_id", agent.id).not("content", "is", null)
    .or(ors).order("confidence", { ascending: false }).limit(12);
  const ql = String(q || "").toLowerCase();
  const topicHit = (c) => {
    const t = String(c.topic || "").toLowerCase().trim();
    return t.length >= 3 && (t.includes(ql) || ql.includes(t));
  };
  const kept = (rows || [])
    .filter((r) => String(r.content || "").trim())
    .map((c) => ({ ...c, score: platformChunkScore(`${c.topic || ""} ${c.content || ""}`, terms), hit: topicHit(c) }))
    .filter((c) => c.hit || c.score >= 0.5)
    .sort((a, b) => b.score - a.score).slice(0, 8);
  return kept.length ? { chunks: kept } : null;
}

async function materialiseTaughtRecord({ userId, query, chunks }) {
  const E = db.schema("edu");
  const name = taughtRecordName(query);
  const text = taughtNotesText({ topic: platformTopicName(query), chunks });
  const { data: existing } = await E.from("records").select("id, name, content")
    .eq("user_id", userId).eq("kind", "paste").eq("name", name).is("deleted_at", null)
    .order("created_at", { ascending: true }).limit(1);
  if (existing?.[0]) {
    if (existing[0].content === text) return { record: { id: existing[0].id, name } };
    const { error } = await E.from("records").update({ content: text, size: text.length }).eq("id", existing[0].id);
    if (error) return { error: "Couldn't refresh their taught notes — try again in a moment." };
    void indexRecord({ userId, recordId: existing[0].id, name, pasteText: text });
    return { record: { id: existing[0].id, name } };
  }
  const { count } = await E.from("records").select("id", { count: "exact", head: true })
    .eq("user_id", userId).is("deleted_at", null);
  if ((count || 0) >= 200) return { error: "Their Library shelf is full (200) — ask them to remove something before saving their taught notes." };
  const { data: record, error } = await E.from("records").insert({
    user_id: userId, kind: "paste", name, content: text, size: text.length, private: true,
  }).select("id, name").single();
  if (error || !record) return { error: "Couldn't save their taught notes — try again in a moment." };
  void indexRecord({ userId, recordId: record.id, name, pasteText: text });
  return { record };
}

async function resolveTaughtRecord({ userId, query = "" }) {
  const q = String(query || "").trim().slice(0, 200);
  if (q.length < 3) return null;
  const found = await taughtFind({ userId, q }).catch(() => null);
  if (!found) return null;
  const built = await materialiseTaughtRecord({ userId, query: q, chunks: found.chunks });
  if (built.error) return { error: built.error };
  return { record: built.record, taught: { topics: found.chunks.map((c) => c.topic).filter(Boolean) } };
}

/* ── The source resolvers ──────────────────────────────────────────────────
   One per source action. Each returns a resolution ({ record, … }), a
   needsChoice, an { error } for the cases that are answers in themselves
   (a named folder that doesn't exist, a chat file not read yet), or null
   for a plain miss — the caller turns a miss into the guided next step. */

/** upload: a file they sent in THIS chat, already read. Never substitutes
 *  another document — no read file is the answer, not a miss. */
async function resolveUploadRecord({ userId, query = "", conversationId = null }) {
  const q = String(query || "").trim().slice(0, 200);
  if (!UUID.test(String(conversationId || ""))) {
    return { code: "no_chat_file",
      error: "No file was sent in this chat to build from — ask them to attach it here, or to name a document or a topic instead. Don't build from a different document." };
  }
  const chat = await chatReadRecords({ userId, conversationId });
  if (!chat.length) {
    return { code: "no_chat_file",
      error: "No file sent in this chat has been read yet — if they just sent it, say it's still being read and ask them to try again in a moment. Don't build from a different document." };
  }
  const pick = pickChatRecord(chat, q);
  if (pick?.needsChoice) return { needsChoice: pick.needsChoice, chat: true };
  if (pick?.recordId) {
    const rec = chat.find((c) => c.recordId === pick.recordId);
    if (rec) return { record: { id: rec.recordId, name: rec.name }, chat: true };
  }
  return { code: "no_chat_file",
    error: "No file sent in this chat has been read yet — if they just sent it, say it's still being read and ask them to try again in a moment. Don't build from a different document." };
}

/** library: the learner's own documents — by id, inside a named folder,
 *  by name, or by what they say. */
async function resolveLibraryRecord({ userId, query = "", folder = "", recordId = null }) {
  const E = db.schema("edu");
  const live = (q) => q.eq("user_id", userId).is("deleted_at", null);
  if (recordId && UUID.test(String(recordId))) {
    const { data } = await live(E.from("records").select("id, name").eq("id", recordId)).maybeSingle();
    return data ? { record: data } : { error: "That document isn't in their Library." };
  }
  const q = String(query || "").trim().slice(0, 200);
  const f = String(folder || "").trim().slice(0, 120);
  let candidates = null, folderRow = null;
  if (f) {
    const { data: folders } = await E.from("library_folders").select("id, name").eq("user_id", userId)
      .ilike("name", `%${escapeLike(f)}%`).limit(3);
    folderRow = (folders || [])[0] || null;
    if (!folderRow) return { error: `No folder called "${f}" in their Library — say so and offer to search all their documents.` };
    // A folder holds its documents as items (item_type 'record'); only the learner's live records count.
    const { data: items } = await E.from("library_folder_items").select("item_ref").eq("folder_id", folderRow.id).eq("user_id", userId)
      .eq("item_type", "record").order("created_at", { ascending: false }).limit(30);
    const ids = (items || []).map((i) => i.item_ref).filter((x) => UUID.test(String(x)));
    const { data } = ids.length ? await live(E.from("records").select("id, name").in("id", ids)) : { data: [] };
    candidates = data || [];
    if (!candidates.length) return { error: `Their "${folderRow.name}" folder is empty.` };
    if (candidates.length === 1) return { record: candidates[0], folder: folderRow };
  }
  // By name first, then by what is inside (the learner's own records only).
  if (q.length >= 3) {
    const pool = candidates ? new Map(candidates.map((r) => [r.id, r])) : null;
    const byName = (candidates || []).find((r) => r.name?.toLowerCase().includes(q.toLowerCase()));
    if (byName) return { record: byName, folder: folderRow };
    if (!candidates) {
      // Deterministic: the most recently added match wins, never whichever
      // row the database happens to return first. escapeLike keeps the
      // query's real characters (the _ in a camera filename) while making
      // the LIKE wildcards literal.
      const { data: named } = await live(E.from("records").select("id, name"))
        .ilike("name", `%${escapeLike(q)}%`).order("created_at", { ascending: false }).limit(1);
      if (named?.[0]) return { record: named[0] };
    }
    const hits = await searchRecordChunks({ userId, q, limit: 20 }).catch(() => []);
    const ranked = rankContentHits(hits, {
      poolIds: pool ? new Set(pool.keys()) : null,
      names: pool ? new Map([...pool.values()].map((r) => [r.id, r.name])) : null,
    });
    const pick = pickContentWinner(ranked);
    if (pick?.needsChoice) return { needsChoice: pick.needsChoice, folder: folderRow };
    if (pick?.recordId) {
      const rec = pool?.get(pick.recordId) || (await live(E.from("records").select("id, name").eq("id", pick.recordId)).maybeSingle()).data;
      if (rec) return { record: rec, folder: folderRow };
    }
  }
  if (candidates) return { needsChoice: candidates.slice(0, 6).map((r) => ({ recordId: r.id, name: r.name })), folder: folderRow };
  return null;
}

/** discover: the community's free notes (the platform tier). */
async function resolveDiscoverRecord({ userId, query = "" }) {
  const q = String(query || "").trim().slice(0, 200);
  if (q.length < 3) return null;
  const plat = await platformFind({ userId, q }).catch(() => null);
  if (plat?.records?.length) return { records: plat.records, platform: true };
  if (plat?.record) return { record: plat.record, platform: plat.platform };
  return null;
}

/**
 * The no-source cascade, kept as one call: a named folder or an explicit
 * chat file answers first (their errors are answers, not misses), then the
 * chain in order — taught → library → discover. makeStudyMaterial prefers
 * the per-source actions; this serves callers that pass no source.
 */
export async function findStudyRecord({ userId, query = "", folder = "", recordId = null, conversationId = null, fromChatFile = false }) {
  const f = String(folder || "").trim();
  if (recordId || f) {
    const r = await resolveLibraryRecord({ userId, query, folder, recordId });
    if (r) return r;
  }
  if (fromChatFile && !f) return resolveUploadRecord({ userId, query, conversationId });
  const taught = await resolveTaughtRecord({ userId, query });
  if (taught) return taught;
  const library = await resolveLibraryRecord({ userId, query, folder: "", recordId: null });
  if (library) return library;
  const discover = await resolveDiscoverRecord({ userId, query });
  if (discover) return discover;
  return { error: "Nothing in their Library matches, and no free notes in Discover match either — say so; don't invent a document. Offer the ways forward: teach you the topic, or upload the document." };
}

/** Agent Chat: make the study material and save it as a reader tab. Never throws. */
export async function makeStudyMaterial({ userId, tool, query = "", folder = "", recordId = null, focus = "", count = "", difficulty = "", length = "", scope = "document", pageNumber = null, conversationId = null, fromChatFile = false, source = null } = {}) {
  try {
    if (!CHAT_STUDY_TOOLS.includes(tool)) return { error: `tool must be one of: ${CHAT_STUDY_TOOLS.join(", ")}.` };
    const docScope = scope === "page" ? "page" : "document";
    const page = Number.isInteger(Number(pageNumber)) && Number(pageNumber) >= 1 ? Number(pageNumber) : null;
    if (docScope === "page" && !page) return { error: "Which page? Say the page number (1-based) for a page-scoped request, or ask for the whole document." };
    // The source action (Matt, 2026-11-16): one tool, the source is the
    // action — like a domain tool. An explicit action runs ONLY its
    // resolver, and a miss answers with the next source to try (guided
    // chaining); no action keeps the full cascade as one call.
    const act = SOURCE_ACTIONS.includes(source) ? source : (fromChatFile ? "upload" : null);
    let found = null;
    if (act === "taught") found = await resolveTaughtRecord({ userId, query });
    else if (act === "library") found = await resolveLibraryRecord({ userId, query, folder, recordId });
    else if (act === "discover") found = await resolveDiscoverRecord({ userId, query });
    else if (act === "upload") found = await resolveUploadRecord({ userId, query, conversationId });
    else found = await findStudyRecord({ userId, query, folder, recordId, conversationId, fromChatFile });
    if (act && !found) return sourceMiss({ source: act, query });
    if (found.error) return { error: found.error, ...(found.code ? { code: found.code } : {}) };
    if (found.needsChoice) {
      return { needsChoice: true, tool, folder: found.folder?.name || null, records: found.needsChoice,
        note: found.chat
          ? `More than one file they sent in this chat could be the one — ask which one (by name) to make the ${tool} from; don't guess.`
          : found.folder
            ? `Their "${found.folder.name}" folder has several documents — ask which one (by name) to make the ${tool} from; don't guess.`
            : `More than one of their documents matches almost equally — ask which one (by name) to make the ${tool} from; don't guess.` };
    }
    // Platform tier: the source is other learners' free notes. A single
    // winner is copied into the learner's Library first; several that would
    // help become ONE gathered content (below). Either way the artifact, its
    // reader card and its dedupe hang off a record the learner owns, and the
    // reply can say where it came from.
    let platformNote = null;
    if (found.records?.length) {
      // Several free notes would help: ONE gathered content written from
      // all of them, cited to each source, saved as a single text in the
      // Library — the build then reads that content like any document.
      const built = await buildGatheredContent({ userId, query, sources: found.records });
      if (built.error) return { error: built.error };
      const list = built.sources.map((s) => `"${s.name}" by ${s.ownerName || "another learner"}`).join(", ");
      platformNote = { source: "platform", sourceName: built.record.name, sourceOwner: null,
        sources: built.sources.map((s) => ({ name: s.name, ownerName: s.ownerName })),
        note: `This was built from a gathered content now saved in their Library ("${built.record.name}") — Akoro brought together ${built.sources.length} free notes from Discover (${list}) and wrote them into one cited text, and the ${tool} was made from that text. Say so in your reply: name Discover and the gathered content; don't call the sources their own documents.` };
      found = { ...found, record: built.record };
    } else if (found.platform) {
      const copied = await copyPlatformRecord({ userId, sourceId: found.record.id });
      if (copied.error) return { error: copied.error };
      platformNote = { source: "platform", sourceName: found.record.name, sourceOwner: found.platform.ownerName || null,
        note: `This was built from ${found.platform.ownerName || "another learner"}'s free notes in Discover ("${found.record.name}") — a copy is now saved in their Library. Say so in your reply: name Discover and the owner, don't call it their own document.` };
      found = { ...found, record: copied.record };
    }
    const { resolveAskTargetFor } = await import("./access.js");
    const target = await resolveAskTargetFor({ userId, recordId: found.record.id });
    if (target.status) return { error: target.message };
    const taughtNote = found.taught ? { source: "taught",
      note: `This was built from what the learner taught their agent — their taught notes on the topic, saved in their Library as "${found.record.name}". Say so in your reply: it comes from their own teaching.` } : null;
    const base = { tool, recordId: found.record.id,
      // A platform build carries its provenance in the name the result
      // reports: the card title is built from it ("Quiz · Free notes in
      // Discover · <name>") and the model reads it too. The Library record
      // itself keeps its real name.
      name: platformNote ? `Free notes in Discover · ${found.record.name}` : found.record.name,
      ...(found.folder ? { folder: found.folder.name } : {}),
      ...(platformNote || taughtNote || { source: found.chat ? "chat" : "library" }) };

    // An identical rebuild returns the tab that already exists: same
    // document, same tool, same page, same knobs — no second generation, no
    // second save. (A podcast still in the making is caught here too; its
    // in-flight guard inside startPodcast stays as the backstop.)
    const dup = await listArtifacts({ userId, recordId: found.record.id })
      .then((arts) => findDuplicateArtifact(arts, {
        kind: tool, pageNumber: docScope === "page" ? page : null,
        focus: clean(focus, TOOL_LIMITS.MAX_FOCUS_CHARS), count, difficulty, length,
      }))
      .catch(() => null);
    if (dup) {
      const items = dup.content?.quizQuestions || dup.content?.cardSet || dup.content?.summaryPoints || [];
      return { made: true, deduped: true, ...base, artifactId: dup.id, label: LABEL[tool],
        ...(tool === "podcast" ? { status: dup.content?.podcast?.status || "ready" } : { count: items.length }),
        scope: docScope === "page" ? `Page ${page}` : "Whole document",
        href: `/library?record=${found.record.id}&artifact=${dup.id}` };
    }

    if (tool === "podcast") {
      const out = await startPodcast({ userId, target, scope: docScope, pageNumber: page, values: { focus, length }, deps: await podcastDeps() });
      if (out.status) return { error: out.message };
      return { made: true, ...base, artifactId: out.artifact.id, status: "making", label: LABEL.podcast,
        href: `/library?record=${found.record.id}&artifact=${out.artifact.id}` };
    }

    const values = toolValues({ focus, count, difficulty });
    const g = await generateToolResult({ userId, target, tool, scope: docScope, pageNumber: page, values, feature: `chat_${tool}` });
    if (g.status) return { error: g.message };
    const content = toReaderContent(tool, g.result);
    const created = await createArtifact({ userId, recordId: found.record.id, row: {
      kind: tool, page_number: docScope === "page" ? page : null, open: true,
      params: { ...values, scope: docScope === "page" ? `Page ${page}` : "Whole document", from: "chat",
        ...(platformNote?.sources ? { gathered: true, sources: platformNote.sources.map((s) => s.name) } : {}) }, content } });
    if (created.error) return { error: created.error };
    const n = (content.quizQuestions || content.cardSet || content.summaryPoints || []).length;
    return { made: true, ...base, artifactId: created.artifact.id, count: n, label: LABEL[tool],
      scope: docScope === "page" ? `Page ${page}` : "Whole document",
      href: `/library?record=${found.record.id}&artifact=${created.artifact.id}` };
  } catch (e) {
    console.warn("[study-material] not made:", String(e?.message || e).slice(0, 160));
    return { error: "Couldn't make that right now — try again in a moment." };
  }
}
