/**
 * deepgram.js — prerecorded speech-to-text via Deepgram (nova-2).
 *
 * Used by the agent-training pipeline for file + recorded-lesson transcription.
 * OpenAI is still used for the LLM work (style/segment extraction) and
 * embeddings; Deepgram only handles transcription.
 *
 * Returns the shape the training pipeline expects:
 *   { fullText, words: [{ word, start, end, confidence, speaker }],
 *     paragraphs: [{ speaker, start, end, sentences: [text] }] }
 *
 * Env: DEEPGRAM_API_KEY
 */

import { createClient } from "@deepgram/sdk";
import fs from "fs";

let _client = null;
function client() {
  if (!process.env.DEEPGRAM_API_KEY) throw new Error("DEEPGRAM_API_KEY is not set");
  if (!_client) _client = createClient(process.env.DEEPGRAM_API_KEY);
  return _client;
}

export const hasDeepgram = () => !!process.env.DEEPGRAM_API_KEY;

/**
 * Mint a short-lived Deepgram token for a client to open the realtime Agent
 * (speech-to-speech) WebSocket directly — used by the voice chat widget.
 *
 * Returns { access_token, token_type }:
 *  - token_type "bearer": a temporary grant token (preferred, short-lived).
 *  - token_type "token":  the raw DEEPGRAM_API_KEY, used only when the key
 *    cannot grant temporary tokens AND DEEPGRAM_ALLOW_RAW_KEY=true. Both are
 *    valid WebSocket subprotocol credentials for Deepgram.
 *
 * grantToken() needs a key with permission to create tokens (Owner/Admin or
 * a key with `keys:write`); a transcription-only key returns FORBIDDEN.
 */
export async function grantAgentToken() {
  try {
    const { result, error } = await client().auth.grantToken();
    if (error) throw error;
    if (result?.access_token) return { access_token: result.access_token, token_type: "bearer" };
    throw new Error("Deepgram returned no access token");
  } catch (err) {
    const detail = err?.err_msg || err?.message || "grantToken failed";
    if (process.env.DEEPGRAM_ALLOW_RAW_KEY === "true" && process.env.DEEPGRAM_API_KEY) {
      console.warn(`[deepgram] grantToken failed (${detail}); falling back to raw API key.`);
      return { access_token: process.env.DEEPGRAM_API_KEY, token_type: "token" };
    }
    const e = new Error(detail);
    e.deepgram = true;
    throw e;
  }
}

// Domain hints that improve recognition of exam/STEM vocabulary.
const KEYTERMS = [
  "calculus", "differentiation", "integration", "theorem",
  "WAEC", "JAMB", "algebra", "trigonometry", "photosynthesis",
];

async function transcribeBuffer(buffer, opts = {}) {
  const { result, error } = await client().listen.prerecorded.transcribeFile(buffer, {
    model:        "nova-2",
    language:     "en",
    smart_format: true,
    punctuate:    true,
    keywords:     KEYTERMS,
    ...opts,
  });
  if (error) throw error;
  return result;
}

/**
 * Transcribe a short audio buffer (e.g. a push-to-talk clip or a live chunk).
 * Returns { transcript, words: [{ word, start, end }], duration }.
 */
export async function transcribeBufferDeepgram(buffer, { language = "en" } = {}) {
  const result = await transcribeBuffer(buffer, { language });
  const alt = result?.results?.channels?.[0]?.alternatives?.[0] || {};
  return {
    transcript: (alt.transcript || "").trim(),
    words: (alt.words || []).map((w) => ({ word: w.punctuated_word || w.word, start: w.start, end: w.end })),
    duration: result?.metadata?.duration ?? 0,
  };
}

export async function transcribeFileDeepgram(localPath, _mimeType) {
  const buffer = fs.readFileSync(localPath);

  const result = await transcribeBuffer(buffer, {
    diarize:    true,
    paragraphs: true,
    utterances: true,
  });

  const channel = result?.results?.channels?.[0];
  const alt     = channel?.alternatives?.[0] || {};
  const fullText = alt.transcript || "";

  const words = (alt.words || []).map((w) => ({
    word:       w.punctuated_word || w.word,
    start:      w.start,
    end:        w.end,
    confidence: w.confidence ?? 1,
    speaker:    typeof w.speaker === "number" ? w.speaker : null,
  }));

  const paragraphs = (alt.paragraphs?.paragraphs || []).map((p) => ({
    speaker:   typeof p.speaker === "number" ? p.speaker : null,
    start:     p.start,
    end:       p.end,
    sentences: (p.sentences || []).map((s) => s.text),
  }));

  return { fullText, words, paragraphs };
}
