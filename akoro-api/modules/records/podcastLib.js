/**
 * modules/records/podcastLib.js — the reader's Podcast tool, for real.
 *
 * A learner asks for an episode on a page (or the whole document). The
 * server:
 *   1. gathers the same numbered passages Summary / Quiz use,
 *   2. has the model write a two-host script — every turn names the passage
 *      it explains, so the transcript carries jump-to-source citations,
 *   3. narrates each turn with OpenAI TTS (two voices), joins the MP3s
 *      (MP3 frames are self-contained — the parts play as one file) and
 *      records each turn's byte range, so the player can follow along,
 *   4. stores the episode under the learner's own prefix and marks the
 *      podcast item (an edu.record_artifacts row) ready.
 *
 * Generation takes a minute or two, so it runs after the request answers;
 * the reader polls the item. Billing: the script is metered like any chat
 * call; narration is charged per character at the TTS rate.
 *
 * The shaping is pure and covered by podcast.contract.test.mjs.
 */
import { citeOf, TOOL_LIMITS } from "./toolsLib.js";
import { passageWhere } from "./askLib.js";

export const PODCAST_LENGTHS = Object.freeze({
  short:  { id: "short",  minutes: "2–3", chars: 2400, maxTokens: 1500 },
  medium: { id: "medium", minutes: "5–6", chars: 5000, maxTokens: 2800 },
  long:   { id: "long",   minutes: "8–10", chars: 8400, maxTokens: 4200 },
});
export const PODCAST_LIMITS = Object.freeze({
  MAX_TURNS: 60,
  MAX_TURN_CHARS: 1200,
  TTS_MODEL: "tts-1",
  TTS_INPUT_MAX: 4000,       // the API caps one request at 4096 characters
  CONCURRENCY: 4,
  STALE_MS: 15 * 60_000,     // a "making" item older than this was lost (a restart)
});
/** Host and guest sound different — the episode reads as a conversation. */
export const PODCAST_VOICES = Object.freeze({ Host: "nova", Guest: "onyx" });

const clip = (text, max) => {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/** "Short · 2–3 min" | "short" | anything → a length preset (medium by default). */
export function lengthOf(value) {
  const word = String(value || "").trim().toLowerCase().split(/[^a-z]/)[0];
  return PODCAST_LENGTHS[word] || PODCAST_LENGTHS.medium;
}

export function podcastSchema() {
  return {
    type: "object", additionalProperties: false, required: ["title", "turns"],
    properties: {
      title: { type: "string" },
      turns: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["speaker", "text", "source"],
          properties: {
            speaker: { type: "string", enum: ["Host", "Guest"] },
            text: { type: "string" },
            source: { type: "integer", description: "The number of the passage this turn explains." },
          },
        },
      },
    },
  };
}

export function buildPodcastMessages({ docName = "this document", passages = [], length = PODCAST_LENGTHS.medium, focus = "" }) {
  const words = Math.round(length.chars / 6);
  const system = [
    `You write a short study podcast about the document "${clip(docName, 160)}" for a learner.`,
    "Two voices: Host (guides, asks) and Guest (explains clearly, with an analogy or example now and then).",
    "Warm and conversational, never filler: open with what the episode covers, walk through the key ideas in order, end with a quick recap of what to remember.",
    `About ${words} words in total (roughly ${length.minutes} minutes spoken). Turns of 1-4 sentences; alternate speakers.`,
    "Use ONLY the numbered passages below — never invent facts. Every turn names the passage it draws on as `source` (the opening and recap name the passage they summarise).",
    "Write for the ear: no markdown, no lists, no symbols read aloud, no page numbers. Use the passages' language.",
    focus ? `Concentrate on: ${clip(focus, TOOL_LIMITS.MAX_FOCUS_CHARS)}.` : "",
    "",
    "Passages:",
    passages.map((p) => `[${p.n}] (${passageWhere(p)})\n${p.text}`).join("\n\n"),
  ].filter(Boolean).join("\n");
  return [{ role: "system", content: system }, { role: "user", content: "Write the episode now." }];
}

/**
 * The model's JSON → { title, turns:[{ speaker, text, cite }] }. Turns naming
 * a passage that doesn't exist keep their words (no citation); empty turns
 * are dropped; the script is capped near the chosen length.
 */
export function shapePodcastScript(json, passages, length = PODCAST_LENGTHS.medium) {
  const byN = new Map(passages.map((p) => [p.n, p]));
  const budget = Math.round(length.chars * 1.3);
  const turns = [];
  let chars = 0;
  for (const t of Array.isArray(json?.turns) ? json.turns : []) {
    const text = clip(String(t?.text || "").replace(/\s*\[\d+\]/g, ""), PODCAST_LIMITS.MAX_TURN_CHARS);
    if (!text) continue;
    if (chars + text.length > budget || turns.length >= PODCAST_LIMITS.MAX_TURNS) break;
    const p = byN.get(Number(t?.source));
    turns.push({ speaker: t?.speaker === "Guest" ? "Guest" : "Host", text, cite: p ? citeOf(p) : null });
    chars += text.length;
  }
  return { title: clip(json?.title || "", 140) || "Study podcast", turns };
}

/** Run `fn` over items with at most `limit` in flight, results in order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Narrate turns → { audio: Buffer, segments:[{ speaker, byteStart, byteEnd }],
 * chars }. `speak(text, voice)` → Buffer (an MP3). Segment i is turn i.
 */
export async function narrateTurns(turns, { speak, concurrency = PODCAST_LIMITS.CONCURRENCY }) {
  const clips = await mapLimit(turns, concurrency, (t) =>
    speak(t.text.slice(0, PODCAST_LIMITS.TTS_INPUT_MAX), PODCAST_VOICES[t.speaker] || PODCAST_VOICES.Host));
  const segments = [];
  let bytes = 0, chars = 0;
  clips.forEach((buf, i) => {
    segments.push({ speaker: turns[i].speaker, byteStart: bytes, byteEnd: bytes + buf.length });
    bytes += buf.length;
    chars += Math.min(turns[i].text.length, PODCAST_LIMITS.TTS_INPUT_MAX);
  });
  return { audio: Buffer.concat(clips), segments, chars };
}

/** Is this podcast item still being made (and not lost to a restart)? */
export function podcastInFlight(content, now = Date.now()) {
  const p = content?.podcast;
  if (p?.status !== "making") return false;
  const started = Date.parse(p.startedAt || "");
  return Number.isFinite(started) && now - started < PODCAST_LIMITS.STALE_MS;
}

/** The stored item → what the reader gets: a lost job reads as failed. */
export function podcastForClient(content, now = Date.now()) {
  const p = content?.podcast || {};
  if (p.status === "making" && !podcastInFlight(content, now)) {
    return { ...p, status: "failed", error: "This episode didn't finish — try again." };
  }
  const { audioKey, ...rest } = p;   // the storage key never leaves the server
  return rest;
}

/**
 * Make the episode and fill the item. Never throws: a failure lands on the
 * item as { status: "failed", error }. deps: { gather, chat, speak, store,
 * update, charge } — all injected by the route (and the test).
 */
export async function runPodcastJob({ artifactId, target, scope, pageNumber, pageText, focus, length, startedAt }, deps) {
  const base = { status: "making", length: length.id, startedAt };
  const fail = (error) => deps.update(artifactId, { podcast: { ...base, status: "failed", error } }).catch(() => {});
  try {
    const passages = await deps.gather({ target, scope, pageNumber, pageText, focus });
    if (!passages.length) {
      return fail(scope === "page"
        ? "This page has no readable text yet — extract the document's text first."
        : "This document isn't readable yet — extract its text (or transcribe the recording) first.");
    }
    let json = {};
    try { json = JSON.parse(await deps.chat(buildPodcastMessages({ docName: target.name, passages, length, focus }), length) || "{}"); }
    catch (e) {
      if (e?.name === "InsufficientCoins") return fail("You're out of AI credit — top up to make episodes.");
      throw e;
    }
    const script = shapePodcastScript(json, passages, length);
    if (!script.turns.length) return fail("Couldn't write an episode from this material — try a different page or focus.");

    const { audio, segments, chars } = await narrateTurns(script.turns, { speak: deps.speak });
    // Charged on the characters actually narrated. The voice work is already
    // done, so a failed debit never throws the episode away.
    await deps.charge(chars).catch(() => {});
    const audioKey = await deps.store(audio);
    await deps.update(artifactId, {
      podcast: {
        ...base, status: "ready", title: script.title, turns: script.turns, segments,
        totalBytes: audio.length, audioKey, voices: PODCAST_VOICES, finishedAt: new Date().toISOString(),
      },
    });
    return { ok: true };
  } catch (e) {
    console.warn("[records-podcast] failed:", String(e?.message || e).slice(0, 200));
    return fail(/too large/i.test(String(e?.message)) ? String(e.message) : "Couldn't make this episode right now — try again in a moment.");
  }
}
