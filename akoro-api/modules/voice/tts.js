/**
 * modules/voice/tts.js — text to speech for read-aloud and the voice stream.
 * Deepgram Aura first (DEEPGRAM_API_KEY); OpenAI tts-1 only as the fallback,
 * when Deepgram isn't set up or fails before any audio was sent.
 *
 *   speakStream({ text, voice, signal }) → { model, chunks }   chunks: async iterable of Buffers (MP3)
 *   speakBuffer({ text, voice })         → { model, buffer }
 *
 * Deepgram takes at most 2000 characters a request: longer text is split at
 * sentence ends and the MP3 pieces stream one after another.
 * Env: DEEPGRAM_TTS_MODEL (an Aura voice for every request, overrides the map).
 */
export const DEEPGRAM_TTS_MAX_CHARS = 1900;
export const TTS_MODELS = Object.freeze({ deepgram: "deepgram-aura-2", openai: "tts-1" });

/** The app's (OpenAI) voice names → Deepgram Aura-2 voices of the same character. */
export const AURA_VOICE = Object.freeze({
  alloy: "aura-2-thalia-en", echo: "aura-2-orion-en", fable: "aura-2-odysseus-en",
  onyx: "aura-2-zeus-en", nova: "aura-2-luna-en", shimmer: "aura-2-athena-en",
});
export const auraVoiceFor = (voice, env = process.env) => env.DEEPGRAM_TTS_MODEL || AURA_VOICE[voice] || AURA_VOICE.alloy;

/** Text in pieces Deepgram accepts: whole sentences where possible, hard-split only when one runs on. */
export function ttsPieces(text, max = DEEPGRAM_TTS_MAX_CHARS) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const sentences = clean.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [clean];
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length <= max) { cur += s; continue; }
    if (cur.trim()) out.push(cur.trim());
    cur = "";
    let rest = s;
    while (rest.length > max) {
      const cut = rest.lastIndexOf(" ", max) > max / 2 ? rest.lastIndexOf(" ", max) : max;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut);
    }
    cur = rest;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function* deepgramChunks(pieces, voice, signal, fetchImpl) {
  for (const piece of pieces) {
    const res = await fetchImpl(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}&encoding=mp3`, {
      method: "POST", signal,
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: piece }),
    });
    if (!res.ok) throw Object.assign(new Error(`Deepgram TTS answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`), { status: res.status });
    for await (const chunk of res.body) {
      if (signal?.aborted) return;
      yield Buffer.from(chunk);
    }
  }
}

async function* openaiChunks(text, voice, openai) {
  const response = await openai.audio.speech.create({ model: "tts-1", voice, input: text, response_format: "mp3" });
  for await (const chunk of response.body) yield Buffer.from(chunk);
}

/**
 * Deepgram first; if it fails before its first byte, OpenAI. The first chunk is
 * awaited here so the fallback decision is made before anything is sent.
 */
export async function speakStream({ text, voice = "alloy", signal = null, openai = null, fetchImpl = fetch, log = console } = {}) {
  const input = String(text || "").slice(0, 4096);
  const tryFirst = async (gen) => {
    const it = gen[Symbol.asyncIterator]();
    const first = await it.next();
    return (async function* () { if (!first.done) yield first.value; for (let n = await it.next(); !n.done; n = await it.next()) yield n.value; })();
  };
  if (process.env.DEEPGRAM_API_KEY) {
    try {
      return { model: TTS_MODELS.deepgram, chunks: await tryFirst(deepgramChunks(ttsPieces(input), auraVoiceFor(voice), signal, fetchImpl)) };
    } catch (error) {
      if (signal?.aborted) throw error;
      log.warn?.(`[tts] Deepgram failed, falling back to OpenAI: ${String(error?.message || error).slice(0, 160)}`);
    }
  }
  if (!openai || !process.env.OPENAI_API_KEY) throw new Error("No text-to-speech provider is set up (DEEPGRAM_API_KEY, or OPENAI_API_KEY as fallback).");
  return { model: TTS_MODELS.openai, chunks: await tryFirst(openaiChunks(input, voice, openai)) };
}

export async function speakBuffer(opts) {
  const { model, chunks } = await speakStream(opts);
  const parts = [];
  for await (const c of chunks) parts.push(c);
  return { model, buffer: Buffer.concat(parts) };
}
