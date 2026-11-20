// =============================================================
// training/extraction.js
// GPT-4o JSON extraction (style, segments) and audio transcription.
// =============================================================

import { toFile } from "openai";
import fs   from "fs";
import path from "path";
import { openai } from "../../../lib/aiModel.js";
import { transcribeFileDeepgram, hasDeepgram } from "../../voice/index.js";

// ── GPT-4o helpers ────────────────────────────────────────────
async function gptJson(systemPrompt, userPrompt, maxTokens = 2000) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o", max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt   },
    ],
  });
  const raw = res.choices[0].message.content.trim();
  return JSON.parse(raw.replace(/^```json?\n?/i, "").replace(/\n?```$/i, "").trim());
}

async function extractStyleProfile(transcript, subject) {
  return gptJson(
    `You are an expert in pedagogical analysis. Respond with valid JSON only.`,
    `Analyse this teaching transcript on "${subject}" and extract a pedagogical fingerprint.

Transcript: """${transcript.substring(0, 12000)}"""

Return this exact JSON:
{
  "pedagogical_pattern": "concept-first|problem-first|socratic|example-first|mixed",
  "vocabulary_level": "formal|conversational|mixed|simplified",
  "explanation_structure": "1-sentence description",
  "pacing_style": "fast|moderate|slow|variable",
  "analogies": ["quote1","quote2"],
  "transition_phrases": ["phrase1","phrase2","phrase3"],
  "confusion_handling_phrases": ["phrase1","phrase2"],
  "encouragement_phrases": ["phrase1","phrase2"],
  "correction_phrases": ["phrase1","phrase2"],
  "question_style": "rhetorical|direct|socratic|wait-time",
  "example_structure": "how teacher sets up examples",
  "misconceptions_flagged": ["misconception1","misconception2"],
  "key_concepts_taught": ["concept1","concept2"],
  "unique_teaching_patterns": ["pattern1","pattern2"],
  "tone": "strict|encouraging|casual|authoritative|warm",
  "overall_summary": "2-sentence summary"
}`, 2000);
}

async function extractSegments(transcript, subject) {
  const result = await gptJson(
    `You are an expert in pedagogical content analysis. Return valid JSON only.`,
    `From this transcript on "${subject}", extract all high-value teaching segments.

Transcript: """${transcript.substring(0, 14000)}"""

Return a JSON array:
[{
  "type": "analogy|worked_example|concept_explanation|correction|encouragement|question",
  "concept": "concept being taught",
  "text": "exact relevant quote",
  "why_valuable": "brief reason",
  "xp": 40
}]

XP values: worked_example=80, analogy=60, concept_explanation=40, correction=50, encouragement=20, question=30`, 3000);

  if (Array.isArray(result)) return result;
  const key = Object.keys(result).find(k => Array.isArray(result[k]));
  return key ? result[key] : [];
}

// ── Transcription ─────────────────────────────────────────────
// Deepgram (nova-2) is the primary STT — real speaker diarization and no
// 25MB cap. If DEEPGRAM_API_KEY is missing we fall back to OpenAI Whisper
// (25MB limit, no diarization) so the pipeline still runs.
async function transcribeFile(localPath, mimeType) {
  if (hasDeepgram()) {
    return transcribeFileDeepgram(localPath, mimeType);
  }

  const result = await openai.audio.transcriptions.create({
    file:     await toFile(fs.createReadStream(localPath), path.basename(localPath)),
    model:    "whisper-1",
    language: "en",
    prompt:   "calculus, differentiation, integration, theorem, WAEC, JAMB",
    response_format:         "verbose_json",
    timestamp_granularities: ["word", "segment"],
  });

  const fullText = result.text || "";
  const words    = (result.words || []).map(w => ({
    word: w.word, start: w.start, end: w.end, confidence: 1, speaker: null,
  }));
  const paragraphs = (result.segments || []).map(s => ({
    speaker: null, start: s.start, end: s.end,
    sentences: [s.text.trim()],
  }));
  return { fullText, words, paragraphs };
}

export { gptJson, extractStyleProfile, extractSegments, transcribeFile };
