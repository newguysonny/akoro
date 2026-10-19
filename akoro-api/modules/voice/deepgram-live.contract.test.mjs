import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createDeepgramTranscriber, deepgramLiveUrl, readDeepgramMessage } from "./deepgramLive.js";

test("the Deepgram stream reads the audio the client already sends", () => {
  const url = new URL(deepgramLiveUrl({}));
  assert.equal(url.host, "api.deepgram.com");
  for (const [k, v] of [["model", "nova-3"], ["encoding", "linear16"], ["sample_rate", "24000"], ["channels", "1"], ["interim_results", "true"], ["vad_events", "true"]]) assert.equal(url.searchParams.get(k), v);
  assert.equal(new URL(deepgramLiveUrl({ DEEPGRAM_LIVE_MODEL: "nova-2" })).searchParams.get("model"), "nova-2");
});

test("Deepgram messages → interim (whole text), final, speech start, utterance end, errors", () => {
  const res = (t, is_final) => JSON.stringify({ type: "Results", is_final, channel: { alternatives: [{ transcript: t }] } });
  assert.deepEqual(readDeepgramMessage(res("osmosis is", false)), { kind: "interim", text: "osmosis is" });
  assert.deepEqual(readDeepgramMessage(res("Osmosis is movement of water.", true)), { kind: "final", text: "Osmosis is movement of water." });
  assert.equal(readDeepgramMessage(res("  ", true)), null, "an empty final adds nothing");
  assert.deepEqual(readDeepgramMessage('{"type":"SpeechStarted"}'), { kind: "speech_started" });
  assert.deepEqual(readDeepgramMessage('{"type":"UtteranceEnd"}'), { kind: "utterance_end" });
  assert.equal(readDeepgramMessage('{"type":"Metadata"}'), null);
  assert.equal(readDeepgramMessage("not json"), null);
});

test("the client: authorised, audio as binary once open, CloseStream on close, events routed", async () => {
  const sockets = [];
  class FakeWS extends EventEmitter { constructor(url, opts) { super(); Object.assign(this, { url, opts, sent: [] }); sockets.push(this); } send(d) { this.sent.push(d); } close() { this.emit("close"); } }
  const got = [];
  const t = createDeepgramTranscriber({ env: { DEEPGRAM_API_KEY: "dg" }, WS: FakeWS,
    onOpen: () => got.push("open"), onInterim: (x) => got.push(`i:${x}`), onCompleted: (x) => got.push(`f:${x}`),
    onSpeechStarted: () => got.push("start"), onSpeechStopped: () => got.push("end") });
  const ws = sockets[0];
  assert.equal(ws.opts.headers.Authorization, "Token dg");
  t.sendAudio(Buffer.from("x").toString("base64"));
  assert.equal(ws.sent.length, 0, "nothing before the socket opens");
  ws.emit("open");
  t.sendAudio(Buffer.from([1, 2, 3]).toString("base64"));
  assert.ok(Buffer.isBuffer(ws.sent[0]) && ws.sent[0].length === 3, "PCM goes as binary");
  ws.emit("message", '{"type":"SpeechStarted"}');
  ws.emit("message", JSON.stringify({ type: "Results", is_final: false, channel: { alternatives: [{ transcript: "osmo" }] } }));
  ws.emit("message", JSON.stringify({ type: "Results", is_final: true, channel: { alternatives: [{ transcript: "Osmosis." }] } }));
  ws.emit("message", '{"type":"UtteranceEnd"}');
  assert.deepEqual(got, ["open", "start", "i:osmo", "f:Osmosis.", "end"]);
  t.close();
  assert.equal(ws.sent.at(-1), JSON.stringify({ type: "CloseStream" }));
});

test("Deepgram first, OpenAI Realtime only as the fallback", async () => {
  const { createLiveTranscriber } = await import("./liveTranscriber.js");
  const made = [];
  let dgCb = null;
  const deepgram = (cb) => { dgCb = cb; made.push("deepgram"); return { sendAudio() {}, close() {} }; };
  const openai = () => { made.push("openai"); return { sendAudio() {}, close() {} }; };
  const errors = [];
  const live = createLiveTranscriber({ onError: (e) => errors.push(e.message) }, { env: { DEEPGRAM_API_KEY: "dg", OPENAI_API_KEY: "oa" }, deepgram, openai, log: { warn() {} } });
  assert.equal(live.provider(), "deepgram");
  dgCb.onError(Object.assign(new Error("401"), { beforeOpen: true }));
  assert.equal(live.provider(), "openai", "fails before opening → OpenAI");
  assert.deepEqual(made, ["deepgram", "openai"]);
  assert.deepEqual(errors, [], "the learner sees no error for a fallback");
  const later = createLiveTranscriber({ onError: (e) => errors.push(e.message) }, { env: { DEEPGRAM_API_KEY: "dg", OPENAI_API_KEY: "oa" }, deepgram, openai, log: { warn() {} } });
  dgCb.onError(new Error("dropped mid-stream"));
  assert.equal(later.provider(), "deepgram");
  assert.deepEqual(errors, ["dropped mid-stream"], "a mid-stream failure is reported, not silently switched");
  assert.equal(createLiveTranscriber({}, { env: { OPENAI_API_KEY: "oa" }, deepgram, openai }).provider(), "openai", "no Deepgram key → OpenAI");
});
