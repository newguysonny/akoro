/**
 * modules/records/study-material-generate.js — the model calls behind the
 * reader's study tools: the structured quiz/flashcards/summary generation
 * over numbered passages, the two-voice podcast, and the writing of a
 * gathered Discover content.
 *
 * Everything here talks to the model; the shapes it returns are
 * study-material-shape.js, and the record/artifact rows are
 * study-material-store.js.
 */
import db from "../../db.js";
import { openai } from "../../lib/aiModel.js";
import { TOOL_IDS, TOOL_LIMITS, toolSchema, toolCount, buildToolMessages, shapeToolResult, gatherToolPassages, citeOf } from "./toolsLib.js";
import { applyPromptIntent } from "./toolPrompt.js";
import { selectContextChunksHybrid, contextPromptBlock } from "./toolContext.js";
import { searchRecordChunks } from "./searchLib.js";
import { getExtraction } from "./extractLib.js";
import { passagesFromExtraction } from "./studyMaterialCore.js";
import { createArtifact, listArtifacts, updateArtifact } from "./artifactsLib.js";
import { PODCAST_LIMITS, lengthOf, podcastSchema, podcastInFlight, runPodcastJob, parsePodcastScriptText } from "./podcastLib.js";
import { coinsAvailable, debitCoins } from "../../lib/coins.js";
import { coinsForTtsChars } from "../../lib/aiPricing.js";
import { getAiBillTo } from "../../lib/aiContext.js";
import { UUID, clean, itemsOf, parseModelJson } from "./study-material-shape.js";

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

export async function generateToolResult({ userId = null, target, tool, scope = "document", pageNumber = null, pageNumbers = [], pageText = "", pageTexts = [], values = {}, feature = null, contextText = "", contextAttached = false, contextItems = [] }) {
  if (!TOOL_IDS.includes(tool)) return { status: 400, message: `tool must be one of: ${TOOL_IDS.join(", ")}.` };
  // The learner's Prompt can request pages, a count, difficulty or an exam
  // board; apply it before anything reads scope/values.
  const applied = applyPromptIntent({ prompt: values.focus, scope, pageNumbers, values, contextAttached });
  const effScope = applied.scope;
  const effPages = applied.pageNumbers;
  const effValues = applied.values;
  let passages = await gatherToolPassages({ target, scope: effScope, pageNumber, pageNumbers: effPages, pageText, pageTexts, focus: values.focus, search: searchRecordChunks });
  if (!passages.length && effScope !== "pages") passages = await extractedPassages({ target, scope: effScope, pageNumber });
  if (!passages.length) {
    return { status: 409, message: effScope === "page"
      ? "This page has no readable text yet — extract the document's text first."
      : effScope === "pages"
      ? "Those pages have no readable text yet — extract the document's text first."
      : "This document isn't readable yet — extract its text (or transcribe the recording) first." };
  }
  // Only the attached pieces that actually touch these passages/concepts are
  // sent to the model; the rest of a past paper or syllabus is noise.
  let selectedContext = [];
  let selectedSemantic = false;
  let effectiveContextText = contextText;
  if (Array.isArray(contextItems) && contextItems.length) {
    const picked = await selectContextChunksHybrid({ items: contextItems, passages, prompt: values.focus, mode: applied.intent.contextMode, embeddingsEnabled: process.env.TOOL_CONTEXT_EMBEDDINGS !== "off" });
    selectedContext = picked.chunks;
    selectedSemantic = !!picked.semantic;
    effectiveContextText = picked.related ? contextPromptBlock(picked.chunks, { mode: picked.mode }) : "";
    if (!picked.related) applied.notes.push("No attached reference material matched these passages — ignore the attachments and do not claim to have used them.");
  }
  const contextNames = selectedContext.map((c) => ({ name: c.name, index: c.index, text: c.text }));
  try {
    const messages = buildToolMessages({ tool, docName: target.name, passages, values: effValues, contextText: effectiveContextText, intentNotes: applied.notes });
    const base = {
      __role: "background", temperature: 0.3, max_tokens: tool === "quiz" ? 2400 : 1600,
      ...(userId ? { __userId: userId } : {}), ...(feature ? { __feature: feature } : {}),
    };
    // One generation attempt: 1) strict schema where the provider honours it
    // (OpenAI-family models); 2) JSON mode + the schema in the prompt —
    // DeepSeek/GLM via OpenCode often ignore json_schema and answer in prose;
    // this keeps generation working.
    const callModel = async (msgs) => {
      let completion = null, json = null, error = null;
      try {
        completion = await openai.chat.completions.create({
          ...base, messages: msgs,
          response_format: { type: "json_schema", json_schema: { name: `reader_${tool}`, strict: true, schema: toolSchema(tool) } },
        });
        json = parseModelJson(completion.choices?.[0]?.message?.content);
      } catch (e) { error = e; }
      if (!itemsOf(tool, json || {}).length) {
        try {
          completion = await openai.chat.completions.create({
            ...base,
            messages: [...msgs, { role: "system", content: `Return ONLY one JSON object matching this JSON Schema:\n${JSON.stringify(toolSchema(tool))}` }],
            response_format: { type: "json_object" },
          });
          const j2 = parseModelJson(completion.choices?.[0]?.message?.content);
          if (j2) json = j2;
        } catch (e) { error = error || e; }
      }
      return { completion, json, error };
    };
    let { completion, json, error: firstError } = await callModel(messages);
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
    let result = shapeToolResult(tool, json, passages, effValues, contextNames);
    let items = result.summaryPoints || result.quizQuestions || result.cardSet || [];
    // Quality top-up: shapeToolResult's gate drops items that copy the source
    // word-for-word or ask about the document itself. When it fired, ask ONCE
    // for replacements that fix the fault — a shorter, honest set beats a
    // padded one, but a fixable rejection shouldn't shrink the set either.
    const wanted = toolCount(tool, effValues);
    // The learner's number is a contract (10 questions means 10): top up when
    // the model returns fewer, whether they were rejected by the quality gate
    // or simply never written.
    if (tool !== "summary" && items.length < wanted) {
      const fromModel = itemsOf(tool, json).length;
      const rejected = Math.max(0, fromModel - items.length);
      const needed = wanted - items.length;
      const keptKeys = items.map((it) => String(it.prompt || it.front || "").toLowerCase().trim()).filter(Boolean);
      const note = rejected > 0
        ? `${rejected} of your items were rejected: they copied the source text word-for-word or asked about the document itself (its sections, title or structure) instead of the material. Write ${needed} replacement item(s) that test the material in your own words, in the same JSON shape, with only the replacements. Do not repeat these kept items: ${keptKeys.map((k) => `"${k.slice(0, 80)}"`).join("; ") || "none"}.`
        : `You returned ${items.length} items but the learner asked for exactly ${wanted}. Write ${needed} more item(s) in the same JSON shape, covering material the first batch did not. Do not repeat these kept items: ${keptKeys.map((k) => `"${k.slice(0, 80)}"`).join("; ") || "none"}.`;
      const second = await callModel([...messages, { role: "system", content: note }]).catch(() => ({ json: null }));
      if (second.json) {
        const extra = shapeToolResult(tool, second.json, passages, effValues, contextNames);
        const extraItems = extra.quizQuestions || extra.cardSet || [];
        const seen = new Set(keptKeys);
        const merged = [...items];
        for (const it of extraItems) {
          const key = String(it.prompt || it.front || "").toLowerCase().trim();
          if (key && seen.has(key)) continue;
          seen.add(key);
          merged.push(it);
          if (merged.length >= wanted) break;
        }
        if (merged.length > items.length) {
          result = tool === "quiz" ? { quizQuestions: merged } : { cardSet: merged };
          items = merged;
        }
      }
    }
    if (!items.length) {
      // Bounded diagnostics: enough to see why a batch was dropped.
      console.warn("[records-tools] empty result", tool, JSON.stringify(json).slice(0, 600));
      return { status: 422, message: "Couldn't build that from this material — try a different page or focus." };
    }
    return { result: { ...result, passages: passages.length, appliedIntent: { scope: effScope, pageNumbers: effPages, count: effValues.count || null, difficulty: effValues.difficulty || null, exam: applied.intent.exam, contextMode: selectedContext.length ? applied.intent.contextMode || null : null, contextChunks: selectedContext.length, contextSemantic: selectedSemantic } } };
  } catch (err) {
    if (err?.name === "InsufficientCoins") return { status: 402, message: "You're out of AI credit — top up to keep generating." };
    console.warn("[records-tools] failed:", String(err?.message || err).slice(0, 200));
    return { status: 424, message: "Couldn't generate that right now — try again in a moment." };
  }
}

/** Start a two-voice episode: the item exists at once ("making"), the episode follows. */
export async function startPodcast({ userId, target, scope = "document", pageNumber = null, pageNumbers = [], pageText = "", pageTexts = [], values = {}, contextText = "", contextAttached = false, contextItems = [], deps }) {
  const billTo = getAiBillTo();
  const { ok } = await coinsAvailable({ userId, billTo, min: 1 });
  if (!ok) return { status: 402, message: "You're out of AI credit — top up to make episodes.", code: "INSUFFICIENT_COINS" };
  const anchor = target.folderId ? { folderId: target.folderId } : { recordId: target.recordId };
  const existing = await listArtifacts({ userId, ...anchor });
  if (existing.some((a) => a.kind === "podcast" && podcastInFlight(a.content))) {
    return { status: 409, message: "An episode for this document is already being made — it'll be ready in a minute or two." };
  }
  const focus = clean(values.focus, TOOL_LIMITS.MAX_FOCUS_CHARS);
  // "Summarise the whole document" / "pages 5–15" in the Prompt overrides the
  // form, exactly as it does for the other tools.
  const applied = applyPromptIntent({ prompt: focus, scope, pageNumbers, values: {}, contextAttached });
  const effScope = applied.scope;
  const effPages = applied.pageNumbers;
  const length = lengthOf(values.length);
  const startedAt = new Date().toISOString();
  const created = await createArtifact({
    userId, ...anchor,
    row: {
      kind: "podcast", page_number: pageNumber, open: true,
      params: { focus, length: typeof values.length === "string" ? values.length.slice(0, 40) : length.id,
        scope: effScope === "document" ? "Whole document" : effScope === "pages" ? `Pages ${effPages.slice(0, 8).join(", ")}${effPages.length > 8 ? "…" : ""}` : "This page",
        pages: effPages },
      content: { podcast: { status: "making", length: length.id, startedAt } },
    },
  });
  if (created.error) return { status: 409, message: created.error };
  const artifactId = created.artifact.id;
  let spokeWith = PODCAST_LIMITS.TTS_MODEL;
  void runPodcastJob({ artifactId, target, scope: effScope, pageNumber, pageNumbers: effPages, pageText, pageTexts, focus, length, startedAt, contextText, contextItems, intentNotes: applied.notes }, {
    gather: (args) => gatherToolPassages({ ...args, search: searchRecordChunks }),
    chat: async (messages, len) => {
      const base = { __role: "background", temperature: 0.7, max_tokens: len.maxTokens, __userId: userId, __billTo: billTo, __feature: "reader_podcast" };
      // Streamed, deliberately: a medium/long script is a 3-4k-token answer,
      // and a plain request for one sits silent past the gateway's response
      // timeout and dies — episodes failed at the same age (~80s) every
      // time while short ones (half the tokens) squeaked through. Streaming
      // starts the bytes at once and assembles the same text.
      const ask = async (msgs, response_format) => {
        const stream = await openai.chat.completions.create({ ...base, messages: msgs, response_format, stream: true });
        let text = "";
        for await (const chunk of stream) text += chunk.choices?.[0]?.delta?.content || "";
        return text;
      };
      const firstText = await ask(messages, { type: "json_schema", json_schema: { name: "reader_podcast", strict: true, schema: podcastSchema() } }).catch(() => "");
      if (parsePodcastScriptText(firstText)?.turns?.length) return firstText;
      const secondText = await ask([...messages, { role: "system", content: `Return ONLY one JSON object matching this JSON Schema:\n${JSON.stringify(podcastSchema())}` }], { type: "json_object" }).catch(() => "");
      return secondText || firstText;
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

export async function podcastDeps() {
  const [{ speakBuffer }, { putRecordObject }] = await Promise.all([import("../voice/index.js"), import("./storage.js")]);
  return { speakBuffer, putRecordObject };
}

/* ── The gathered content (Matt, 2026-11-16) ───────────────────────────────
   Several Discover materials would help: instead of copying them into a
   folder, the agent writes ONE content from them — a single text saved in
   the learner's Library (a paste record; text already opens in the reader),
   cited to its sources with numbered markers. The record's `sources` jsonb
   is the citation map: marker → the ORIGINAL record, so the reader can open
   the source from a citation and come back. Study materials then generate
   from this one content like from any document. */

const GATHER_LIMITS = Object.freeze({ PER_SOURCE_PASSAGES: 6, PER_SOURCE_CHARS: 6000, TOTAL_CHARS: 16000 });

/**
 * Write the gathered content's text from the sources' passages: one model
 * call for cited study notes (sections whose facts carry their source's
 * [n] marker); if the model can't, an extractive assembly — each source's
 * own section, its passages as paragraphs, the marker at each paragraph's
 * end. Either way the text ends with the Sources list the markers key to.
 * sources: [{ name, ownerName, passages }] (already in marker order).
 */
export async function synthesiseGatheredText({ userId, topic, sources }) {
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
