import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const {
  PODCAST_LENGTHS, PODCAST_LIMITS, PODCAST_VOICES, lengthOf, podcastSchema, buildPodcastMessages, shapePodcastScript,
  narrateTurns, podcastInFlight, podcastForClient, runPodcastJob,
} = await import("./podcastLib.js");
const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const artifacts = await readFile(new URL("./artifactsLib.js", import.meta.url), "utf8");

const passages = [
  { n: 1, kind: "block", pageNumber: 2, bbox: [10, 20, 900, 80], startMs: null, endMs: null, text: "Photosynthesis turns light into chemical energy." },
  { n: 2, kind: "page", pageNumber: 3, bbox: null, startMs: null, endMs: null, text: "Chlorophyll absorbs red and blue light." },
];

test("length presets: the form's labels and bare ids both resolve; medium by default", () => {
  assert.equal(lengthOf("Short · 2–3 min"), PODCAST_LENGTHS.short);
  assert.equal(lengthOf("long"), PODCAST_LENGTHS.long);
  assert.equal(lengthOf("Medium · 5–6 min"), PODCAST_LENGTHS.medium);
  assert.equal(lengthOf(""), PODCAST_LENGTHS.medium);
  assert.equal(lengthOf("Huge"), PODCAST_LENGTHS.medium);
});

test("the script schema is strict and the prompt carries the passages, length and focus", () => {
  const schema = podcastSchema();
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.turns.items.properties.speaker.enum, ["Host", "Guest"]);
  const [system] = buildPodcastMessages({ docName: "Biology", passages, length: PODCAST_LENGTHS.short, focus: "light" });
  assert.match(system.content, /\[1\] \(page 2\)\nPhotosynthesis/);
  assert.match(system.content, /2–3 minutes/);
  assert.match(system.content, /Concentrate on: light/);
  assert.match(system.content, /never invent facts/i);
});

test("script shaping: cites map to passages, bad turns drop, the length budget caps", () => {
  const out = shapePodcastScript({
    title: "Light work",
    turns: [
      { speaker: "Host", text: "Today: how plants eat light [1].", source: 1 },
      { speaker: "Guest", text: "   ", source: 1 },
      { speaker: "Narrator", text: "Chlorophyll is picky about colour.", source: 2 },
      { speaker: "Guest", text: "No such passage here.", source: 9 },
    ],
  }, passages);
  assert.equal(out.title, "Light work");
  assert.deepEqual(out.turns.map((t) => t.speaker), ["Host", "Host", "Guest"]);
  assert.equal(out.turns[0].text, "Today: how plants eat light.");
  assert.deepEqual(out.turns[0].cite, { n: 1, pageNumber: 2, bbox: [10, 20, 900, 80], startMs: null, endMs: null, quote: passages[0].text });
  assert.equal(out.turns[2].cite, null);
  const long = shapePodcastScript({ turns: Array.from({ length: 50 }, () => ({ speaker: "Host", text: "x".repeat(500), source: 1 })) }, passages, PODCAST_LENGTHS.short);
  assert.ok(long.turns.length <= Math.ceil((PODCAST_LENGTHS.short.chars * 1.3) / 500));
  assert.equal(shapePodcastScript({}, passages).title, "Study podcast");
});

test("narration: two voices, turns in order, byte ranges add up", async () => {
  const said = [];
  const speak = async (text, voice) => { said.push(voice); await new Promise((r) => setTimeout(r, text.length % 3)); return Buffer.alloc(text.length * 2, 1); };
  const turns = [{ speaker: "Host", text: "abc" }, { speaker: "Guest", text: "defgh" }, { speaker: "Host", text: "ij" }];
  const { audio, segments, chars } = await narrateTurns(turns, { speak, concurrency: 2 });
  assert.equal(audio.length, 20);
  assert.equal(chars, 10);
  assert.deepEqual(segments, [
    { speaker: "Host", byteStart: 0, byteEnd: 6 },
    { speaker: "Guest", byteStart: 6, byteEnd: 16 },
    { speaker: "Host", byteStart: 16, byteEnd: 20 },
  ]);
  assert.deepEqual(said.sort(), [PODCAST_VOICES.Guest, PODCAST_VOICES.Host, PODCAST_VOICES.Host].sort());
});

test("in-flight vs lost: a 'making' item past the stale window reads as failed; the key never leaves", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  const fresh = { podcast: { status: "making", startedAt: "2026-10-10T11:58:00Z" } };
  const lost = { podcast: { status: "making", startedAt: new Date(now - PODCAST_LIMITS.STALE_MS - 1000).toISOString() } };
  assert.equal(podcastInFlight(fresh, now), true);
  assert.equal(podcastInFlight(lost, now), false);
  assert.equal(podcastForClient(lost, now).status, "failed");
  assert.equal(podcastForClient({ podcast: { status: "ready", audioKey: "records/u/x.mp3", title: "T" } }, now).audioKey, undefined);
});

const deps = (over = {}) => {
  const log = [];
  return {
    log,
    gather: async () => passages,
    chat: async () => JSON.stringify({ title: "Ep", turns: [{ speaker: "Host", text: "Hello there.", source: 1 }, { speaker: "Guest", text: "Hi.", source: 2 }] }),
    speak: async (text) => Buffer.from(text),
    charge: async (chars) => { log.push(["charge", chars]); },
    store: async (audio) => { log.push(["store", audio.length]); return "records/u/1-podcasts/a.mp3"; },
    update: async (id, content) => { log.push(["update", id, content.podcast.status, content.podcast]); },
    ...over,
  };
};
const job = { artifactId: "a1", target: { name: "Doc" }, scope: "page", pageNumber: 2, pageText: "", focus: "", length: PODCAST_LENGTHS.short, startedAt: "t0" };

test("the job: script → narration → charge → store → ready, with turns, segments and the key", async () => {
  const d = deps();
  await runPodcastJob(job, d);
  assert.deepEqual(d.log.map((l) => l[0]), ["charge", "store", "update"]);
  assert.equal(d.log[0][1], "Hello there.".length + "Hi.".length);
  const [, id, status, podcast] = d.log[2];
  assert.equal(id, "a1");
  assert.equal(status, "ready");
  assert.equal(podcast.title, "Ep");
  assert.equal(podcast.turns.length, 2);
  assert.equal(podcast.totalBytes, 15);
  assert.equal(podcast.audioKey, "records/u/1-podcasts/a.mp3");
  assert.equal(podcast.length, "short");
});

test("the job fails honestly: nothing to read, no script, no credit, a provider error", async () => {
  const last = (d) => d.log.at(-1);
  let d = deps({ gather: async () => [] });
  await runPodcastJob(job, d);
  assert.match(last(d)[3].error, /no readable text/);
  d = deps({ chat: async () => JSON.stringify({ title: "x", turns: [] }) });
  await runPodcastJob(job, d);
  assert.match(last(d)[3].error, /Couldn't write an episode/);
  d = deps({ chat: async () => { const e = new Error("no"); e.name = "InsufficientCoins"; throw e; } });
  await runPodcastJob(job, d);
  assert.match(last(d)[3].error, /out of AI credit/);
  d = deps({ speak: async () => { throw new Error("tts down"); } });
  await runPodcastJob(job, d);
  assert.equal(last(d)[2], "failed");
  assert.ok(!d.log.some((l) => l[0] === "store"));
  // A debit hiccup after the voice work is done never throws the episode away.
  d = deps({ charge: async () => { throw new Error("db"); } });
  await runPodcastJob(job, d);
  assert.equal(last(d)[2], "ready");
});

test("routes: made by the server, polled, never client-writable, audio deleted with the item", () => {
  assert.match(routes, /router\.post\("\/podcast", authenticateToken/);
  assert.match(routes, /router\.get\("\/podcast\/:id", authenticateToken/);
  const post = routes.slice(routes.indexOf('router.post("/podcast"'), routes.indexOf('router.get("/podcast/:id"'));
  assert.match(post, /resolveAskTarget\(req, req\.body\)/);
  assert.match(post, /coinsAvailable\(/);                       // hard block before any spend
  assert.match(post, /podcastInFlight\(a\.content\)/);          // one episode at a time
  assert.match(post, /res\.status\(202\)[\s\S]*void runPodcastJob/);   // answers first, works after
  assert.match(post, /__userId: userId, __billTo: billTo/);
  assert.match(post, /coinsForTtsChars\(PODCAST_LIMITS\.TTS_MODEL, chars\)/);
  assert.match(routes, /SERVER_MADE_KINDS\.includes\(v\.row\.kind\)\) return res400/);   // no client-made podcasts
  assert.match(routes, /SERVER_MADE_KINDS\.includes\(row\.kind\)\) return res400/);      // no content patches
  assert.match(routes, /ownsRecordFileKey\(raw\.audioKey, userId\)/);                   // presign only own keys
  assert.match(routes, /gone\.kind === "podcast"[\s\S]{0,200}removeRecordFile\(audioKey\)/);
  assert.match(artifacts, /SERVER_MADE_KINDS = Object\.freeze\(\["podcast"\]\)/);
});
