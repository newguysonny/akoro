import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auraVoiceFor, speakBuffer, ttsPieces, DEEPGRAM_TTS_MAX_CHARS } from "./tts.js";

const body = (bufs) => ({ async *[Symbol.asyncIterator]() { for (const b of bufs) yield b; } });
const fakeOpenAI = (calls) => ({ audio: { speech: { create: async (p) => { calls.push(p); return { body: body([Buffer.from("OA")]) }; } } } });

test("Deepgram first: voices map to Aura, long text goes in sentence-sized pieces", async () => {
  process.env.DEEPGRAM_API_KEY = "dg"; process.env.OPENAI_API_KEY = "oa";
  assert.equal(auraVoiceFor("nova", {}), "aura-2-luna-en");
  assert.equal(auraVoiceFor("unknown", {}), "aura-2-thalia-en");
  assert.equal(auraVoiceFor("nova", { DEEPGRAM_TTS_MODEL: "aura-2-hera-en" }), "aura-2-hera-en");
  const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} explains osmosis in plants.`).join(" ");
  const pieces = ttsPieces(long);
  assert.ok(pieces.length >= 2 && pieces.every((p) => p.length <= DEEPGRAM_TTS_MAX_CHARS && /\.$/.test(p)), "whole sentences, under the limit");
  assert.equal(pieces.join(" "), long);

  const urls = []; const oa = [];
  const fetchImpl = async (url, init) => { urls.push([url, JSON.parse(init.body).text.length, init.headers.Authorization]); return { ok: true, body: body([Buffer.from("DG")]) }; };
  const r = await speakBuffer({ text: long, voice: "nova", fetchImpl, openai: fakeOpenAI(oa) });
  assert.equal(r.model, "deepgram-aura-2");
  assert.equal(r.buffer.toString(), "DG".repeat(pieces.length));
  assert.match(urls[0][0], /model=aura-2-luna-en&encoding=mp3/);
  assert.equal(urls[0][2], "Token dg");
  assert.equal(oa.length, 0, "OpenAI not called");
});

test("OpenAI only as the fallback: Deepgram fails before any audio, or isn't set up", async () => {
  process.env.DEEPGRAM_API_KEY = "dg"; process.env.OPENAI_API_KEY = "oa";
  const oa = [];
  const failing = async () => ({ ok: false, status: 402, text: async () => "no credit" });
  const r = await speakBuffer({ text: "Hello there.", voice: "echo", fetchImpl: failing, openai: fakeOpenAI(oa), log: { warn() {} } });
  assert.equal(r.model, "tts-1");
  assert.equal(oa[0].voice, "echo");
  delete process.env.DEEPGRAM_API_KEY;
  const r2 = await speakBuffer({ text: "Hi.", voice: "alloy", fetchImpl: async () => { throw new Error("must not call"); }, openai: fakeOpenAI(oa) });
  assert.equal(r2.model, "tts-1");
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(speakBuffer({ text: "Hi.", openai: null }), /No text-to-speech provider/);
});

test("both read-aloud paths use it, and charge the provider that spoke", async () => {
  const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");
  const streaming = await readFile(new URL("./streaming.js", import.meta.url), "utf8");
  assert.match(routes, /await speakBuffer\(\{ text: input, voice: ttsVoice, openai \}\)/);
  assert.match(routes, /coinsForTtsChars\(model, input\.length\)/);
  assert.match(streaming, /await speakStream\(\{ text: input, voice: ttsVoice, signal: controller\.signal, openai \}\)/);
  assert.match(streaming, /coinsForTtsChars\(model, input\.length\), feature: "voice_tts", model/);
  assert.ok(!/audio\.speech\.create/.test(routes + streaming), "no direct OpenAI TTS left");
});
