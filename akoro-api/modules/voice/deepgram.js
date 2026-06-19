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
