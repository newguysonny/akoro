/**
 * modules/records/studyMaterial.js — the reader's study tools, callable from
 * anywhere (the reader's routes and Agent Chat).
 *
 *   generateToolResult({ userId, target, tool, scope, pageNumber, pageText, values })
 *       summary | quiz | flashcards → { result } | { status, message }
 *   startPodcast({ userId, target, scope, pageNumber, pageText, values })
 *       → { artifact } (status "making"; the episode is finished in the background) | { status, message }
 *   toReaderContent(tool, result)   the tab content the reader shows (its citation shape)
 *   makeStudyMaterial({ userId, tool, query, folder, focus, count, difficulty, length })
 *       Agent Chat: find the learner's document (or the best one in a folder),
 *       build the tool from the WHOLE document, save it as a reader tab →
 *       { made, tool, recordId, artifactId, name, href, count } | { needsChoice } | { error }
 *
 * Whatever chat makes is the same saved item the reader makes (edu.record_artifacts),
 * so the link `/library?record=<id>&artifact=<id>` opens the reader on that tab.
 */
import db from "../../db.js";
import { openai } from "../../lib/aiModel.js";
import { TOOL_IDS, TOOL_LIMITS, toolSchema, buildToolMessages, shapeToolResult, gatherToolPassages } from "./toolsLib.js";
import { searchRecordChunks } from "./searchLib.js";
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
export async function generateToolResult({ userId = null, target, tool, scope = "document", pageNumber = null, pageText = "", values = {}, feature = null }) {
  if (!TOOL_IDS.includes(tool)) return { status: 400, message: `tool must be one of: ${TOOL_IDS.join(", ")}.` };
  const passages = await gatherToolPassages({ target, scope, pageNumber, pageText, focus: values.focus, search: searchRecordChunks });
  if (!passages.length) {
    return { status: 409, message: scope === "page"
      ? "This page has no readable text yet — extract the document's text first."
      : "This document isn't readable yet — extract its text (or transcribe the recording) first." };
  }
  try {
    const completion = await openai.chat.completions.create({
      __role: "background", temperature: 0.3, max_tokens: tool === "quiz" ? 2400 : 1600,
      messages: buildToolMessages({ tool, docName: target.name, passages, values }),
      response_format: { type: "json_schema", json_schema: { name: `reader_${tool}`, strict: true, schema: toolSchema(tool) } },
      ...(userId ? { __userId: userId } : {}), ...(feature ? { __feature: feature } : {}),
    });
    let json = null;
    try { json = JSON.parse(completion.choices?.[0]?.message?.content || "{}"); } catch { json = {}; }
    const result = shapeToolResult(tool, json, passages, values);
    const items = result.summaryPoints || result.quizQuestions || result.cardSet || [];
    if (!items.length) return { status: 422, message: "Couldn't build that from this material — try a different page or focus." };
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
  const existing = await listArtifacts({ userId, recordId: target.recordId });
  if (existing.some((a) => a.kind === "podcast" && podcastInFlight(a.content))) {
    return { status: 409, message: "An episode for this document is already being made — it'll be ready in a minute or two." };
  }
  const focus = clean(values.focus, TOOL_LIMITS.MAX_FOCUS_CHARS);
  const length = lengthOf(values.length);
  const startedAt = new Date().toISOString();
  const created = await createArtifact({
    userId, recordId: target.recordId,
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

/** The learner's document for a request: by id, by name, inside a folder, or by what it says. */
export async function findStudyRecord({ userId, query = "", folder = "", recordId = null }) {
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
      .ilike("name", `%${f.replace(/[%_]/g, "")}%`).limit(3);
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
      const { data: named } = await live(E.from("records").select("id, name")).ilike("name", `%${q.replace(/[%_]/g, "")}%`).limit(1);
      if (named?.[0]) return { record: named[0] };
    }
    const hits = await searchRecordChunks({ userId, q, limit: 20 }).catch(() => []);
    const score = new Map();
    for (const h of hits) if (h.recordId && (!pool || pool.has(h.recordId))) score.set(h.recordId, (score.get(h.recordId) || 0) + 1);
    const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) {
      const rec = pool?.get(best[0]) || (await live(E.from("records").select("id, name").eq("id", best[0])).maybeSingle()).data;
      if (rec) return { record: rec, folder: folderRow };
    }
  }
  if (candidates) return { needsChoice: candidates.slice(0, 6).map((r) => ({ recordId: r.id, name: r.name })), folder: folderRow };
  return { error: "Nothing in their Library matches — say so; don't invent a document." };
}

/** Agent Chat: make the study material and save it as a reader tab. Never throws. */
export async function makeStudyMaterial({ userId, tool, query = "", folder = "", recordId = null, focus = "", count = "", difficulty = "", length = "" } = {}) {
  try {
    if (!CHAT_STUDY_TOOLS.includes(tool)) return { error: `tool must be one of: ${CHAT_STUDY_TOOLS.join(", ")}.` };
    const found = await findStudyRecord({ userId, query, folder, recordId });
    if (found.error) return { error: found.error };
    if (found.needsChoice) {
      return { needsChoice: true, folder: found.folder?.name || null, records: found.needsChoice,
        note: `Their "${found.folder?.name}" folder has several documents — ask which one (by name) to make the ${tool} from; don't guess.` };
    }
    const { resolveAskTargetFor } = await import("./access.js");
    const target = await resolveAskTargetFor({ userId, recordId: found.record.id });
    if (target.status) return { error: target.message };
    const base = { tool, recordId: found.record.id, name: found.record.name, ...(found.folder ? { folder: found.folder.name } : {}) };

    if (tool === "podcast") {
      const out = await startPodcast({ userId, target, scope: "document", values: { focus, length }, deps: await podcastDeps() });
      if (out.status) return { error: out.message };
      return { made: true, ...base, artifactId: out.artifact.id, status: "making", label: LABEL.podcast,
        href: `/library?record=${found.record.id}&artifact=${out.artifact.id}` };
    }

    const values = toolValues({ focus, count, difficulty });
    const g = await generateToolResult({ userId, target, tool, scope: "document", values, feature: `chat_${tool}` });
    if (g.status) return { error: g.message };
    const content = toReaderContent(tool, g.result);
    const created = await createArtifact({ userId, recordId: found.record.id, row: {
      kind: tool, page_number: null, open: true, params: { ...values, scope: "Whole document", from: "chat" }, content } });
    if (created.error) return { error: created.error };
    const n = (content.quizQuestions || content.cardSet || content.summaryPoints || []).length;
    return { made: true, ...base, artifactId: created.artifact.id, count: n, label: LABEL[tool],
      href: `/library?record=${found.record.id}&artifact=${created.artifact.id}` };
  } catch (e) {
    console.warn("[study-material] not made:", String(e?.message || e).slice(0, 160));
    return { error: "Couldn't make that right now — try again in a moment." };
  }
}
