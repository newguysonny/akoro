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
  medium: { id: "medium", minutes: "5–6", chars: 5000, maxTokens: 3600 },
  long:   { id: "long",   minutes: "8–10", chars: 8400, maxTokens: 5600 },
});
export const PODCAST_LIMITS = Object.freeze({
  MAX_TURNS: 60,
  MAX_TURN_CHARS: 1200,
  TTS_MODEL: "tts-1",
  TTS_INPUT_MAX: 4000,       // the API caps one request at 4096 characters
  CONCURRENCY: 4,
  STALE_MS: 15 * 60_000,     // a "making" item older than this was lost (a restart)
  MIN_PAGE_CHARS: 360,        // a cover/thin page isn't an episode — widen to the document
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

/* The script prompt (Matt, 2026-11-17): the old one described the target
 * voice ("warm and conversational") but never showed it, and the model
 * returned narrated textbook prose — section-announcement host turns,
 * paragraph-length guest turns, no recap. This one defines the two
 * personas, shows an example exchange in the target voice, and requires
 * the moves that make YouLearn's episodes work: a hook opening, the
 * material's confusing points raised as questions, an analogy per major
 * idea, short alternating turns, and a real recap. */
export function buildPodcastMessages({ docName = "this document", passages = [], length = PODCAST_LENGTHS.medium, focus = "", contextText = "" }) {
  const words = Math.round(length.chars / 6);
  const system = [
    `You write a short study podcast about the document "${clip(docName, 160)}" for a learner — a real conversation, not a lecture read aloud.`,
    "The two voices: the HOST is a curious learner who has skimmed this material and thinks aloud — asking the questions a student would actually ask, including the confused ones ('Wait, are they saying…?', 'But isn't that just…?'). The GUEST is a teacher who answers plainly, with an analogy or a concrete picture for every major idea.",
    "Open on a hook: the most surprising fact, the strangest claim, or a question the material raises — never 'Welcome, today we walk through…'.",
    "Hunt through the material for its confusing points — odd units, exceptions, claims that sound wrong, things learners commonly misunderstand — and let the Host raise them as questions; the Guest resolves each one. That is where the learning happens.",
    "Keep turns SHORT: 1-3 sentences each, and alternate strictly — Host, Guest, Host. No monologues and no section announcements ('Now let's turn to…'); the Host's next genuine question is the transition.",
    "End with a recap: the Host asks what to remember, the Guest gives the 3-4 things that matter most in one turn, then one warm closing line from the Host.",
    `About ${words} words in total (roughly ${length.minutes} minutes spoken).`,
    "Use ONLY the numbered passages below — never invent facts. Every turn names the passage it draws on as `source` (the opening and recap name the passage they summarise).",
    "Write for the ear: no markdown, no lists, no symbols read aloud, no page numbers. Use the passages' language.",
    "The voice to aim for (a different topic — style only, never copy its content):",
    "Host: 'Wait — if the heart is just a pump, why does it have its own blood supply? Isn't it full of blood already?'",
    "Guest: 'It is, but that blood is passing through, not stopping for a meal. Think of a water park: the slides are full of water, but the café still needs its own tap.'",
    "Host: 'Okay, that actually makes sense. So the coronary arteries are the tap?'",
    "Guest: 'Exactly. And when that tap gets blocked, the muscle downstream starves — that is a heart attack.'",
    focus ? `Concentrate on: ${clip(focus, TOOL_LIMITS.MAX_FOCUS_CHARS)}.` : "",
    contextText || "",
    "",
    "Passages:",
    passages.map((p) => `[${p.n}] (${passageWhere(p)})\n${p.text}`).join("\n\n"),
  ].filter(Boolean).join("\n");
  return [{ role: "system", content: system }, { role: "user", content: "Write the episode now." }];
}

/**
 * The model's answer → the script object, salvaged the way the reader
 * tools salvage theirs: a fenced block, or the object inside prose.
 * Providers that ignore json_schema answer like this; a raw JSON.parse
 * failed whole episodes on it. Returns {} when nothing parses (a
 * truncated answer salvages nothing — the caller's retry covers that).
 */
export function parsePodcastScriptText(text) {
  const raw = String(text || "").trim();
  if (!raw) return {};
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  for (const candidate of [raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim(), fenced?.[1]]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* try the object inside */ }
    const a = candidate.indexOf("{");
    const b = candidate.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return JSON.parse(candidate.slice(a, b + 1)); } catch { /* give up */ } }
  }
  return {};
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
  // Strict alternation: the model still runs two same-speaker turns together
  // (a Guest paragraph split in two was the common case) — merge them into
  // one turn rather than dropping content.
  const merged = [];
  for (const t of turns) {
    const prev = merged[merged.length - 1];
    if (prev && prev.speaker === t.speaker) {
      prev.text = clip(`${prev.text} ${t.text}`, PODCAST_LIMITS.MAX_TURN_CHARS);
      if (!prev.cite && t.cite) prev.cite = t.cite;
    } else merged.push({ ...t });
  }
  return { title: clip(json?.title || "", 140) || "Study podcast", turns: merged };
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
export async function runPodcastJob({ artifactId, target, scope, pageNumber, pageNumbers = [], pageText, pageTexts = [], focus, length, startedAt, contextText = "" }, deps) {
  const base = { status: "making", length: length.id, startedAt };
  const fail = (error) => deps.update(artifactId, { podcast: { ...base, status: "failed", error } }).catch(() => {});
  try {
    let passages = await deps.gather({ target, scope, pageNumber, pageNumbers, pageText, pageTexts, focus });
    // A "this page" request that lands on a cover or a caption has too little
    // to talk about; widen to the document rather than fail the episode.
    const pageChars = passages.reduce((n, p) => n + String(p?.text || "").length, 0);
    const coverPage = Number(pageNumber) <= 1 && target?.kind === "paste";   // a paste's page 1 is the reader's cover
    if (scope === "page" && (pageChars < PODCAST_LIMITS.MIN_PAGE_CHARS || coverPage)) {
      const wider = await deps.gather({ target, scope: "document", pageNumber, pageText: "", focus }).catch(() => []);
      if (wider.length) passages = wider;
    }
    if (!passages.length) {
      return fail(scope === "page"
        ? "This page has no readable text yet — extract the document's text first."
        : "This document isn't readable yet — extract its text (or transcribe the recording) first.");
    }
    let json = {};
    try { json = parsePodcastScriptText(await deps.chat(buildPodcastMessages({ docName: target.name, passages, length, focus, contextText }), length)); }
    catch (e) {
      if (e?.name === "InsufficientCoins") return fail("You're out of AI credit — top up to make episodes.");
      throw e;
    }
    let script = shapePodcastScript(json, passages, length);
    if (!script.turns.length) {
      // One retry: an empty/truncated draft is usually the provider, not the
      // material (the whole-document run of the same page succeeded).
      try { json = parsePodcastScriptText(await deps.chat(buildPodcastMessages({ docName: target.name, passages, length, focus, contextText }), length)); }
      catch (e) {
        if (e?.name === "InsufficientCoins") return fail("You're out of AI credit — top up to make episodes.");
        throw e;
      }
      script = shapePodcastScript(json, passages, length);
    }
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
