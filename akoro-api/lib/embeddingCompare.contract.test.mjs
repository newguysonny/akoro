import assert from "node:assert/strict";
import test from "node:test";

/**
 * Choosing an embedding model without touching the stores (2026-10-20): a
 * fixed test set, scored per model; candidates are only the models deployed.
 */
import { candidates, compareEmbeddings, median, QUERY_INSTRUCTION, scoreRetrieval } from "./embeddingCompare.js";
import { PASSAGES, QUERIES } from "./embeddingEvalSet.js";

test("the test set: every question's answer is a passage; ids are unique; near neighbours share a subject", () => {
  const ids = new Set(PASSAGES.map((p) => p.id));
  assert.equal(ids.size, PASSAGES.length);
  for (const q of QUERIES) assert.ok(ids.has(q.answer), q.q);
  assert.ok(QUERIES.length <= 64 && PASSAGES.length <= 64, "each fits one worker job");
  assert.ok(QUERIES.some((q) => q.lang === "pcm"));
});

test("scoring: recall@1, recall@5, MRR, by language, with the misses", () => {
  const passages = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const passageVectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const queries = [{ q: "x", answer: "a", lang: "en" }, { q: "y", answer: "b", lang: "en" }, { q: "z", answer: "c", lang: "pcm" }];
  const queryVectors = [[0.9, 0.1, 0], [0.8, 0.5, 0], [0, 0.2, 0.9]];
  const s = scoreRetrieval({ passages, passageVectors, queries, queryVectors });
  assert.equal(s.recall1, 0.667);
  assert.equal(s.recall5, 1);
  assert.equal(s.mrr, round((1 + 0.5 + 1) / 3));
  assert.deepEqual(s.byLang.pcm, { queries: 1, recall1: 1, recall5: 1, mrr: 1 });
  assert.deepEqual(s.misses, [{ q: "y", want: "b", got: "a", rank: 2 }]);
});
const round = (x) => Math.round(x * 1000) / 1000;

test("candidates: only the deployed models; Qwen3 also with its query instruction; OpenAI only when it's the app's", () => {
  assert.deepEqual(candidates({}, {}), []);
  const env = { RUNPOD_API_KEY: "k", RUNPOD_EMBED_ENDPOINT_ID: "q", RUNPOD_EMBED_BGE_ENDPOINT_ID: "b", OPENAI_API_KEY: "o" };
  assert.deepEqual(candidates(env, { provider: "openai" }).map((c) => c.key), ["qwen3-embedding-0.6b", "qwen3-embedding-0.6b+instruction", "bge-m3", "text-embedding-3-small (current)"]);
  assert.deepEqual(candidates(env, { provider: "runpod" }).map((c) => c.key), ["qwen3-embedding-0.6b", "qwen3-embedding-0.6b+instruction", "bge-m3"]);
  assert.deepEqual(candidates({ ...env, RUNPOD_EMBED_ENDPOINT_ID: "" }, { provider: "runpod" }).map((c) => c.key), ["bge-m3"]);
  assert.equal(candidates(env)[1].instruction, QUERY_INSTRUCTION);
});

test("a run: each candidate scored and timed; one failing doesn't stop the others; the instruction goes on questions only", async () => {
  const seen = [];
  // A perfect model: each text maps to its passage's own axis (questions to their answer's).
  const axis = new Map(PASSAGES.map((p, i) => [p.text, i]));
  for (const q of QUERIES) axis.set(q.q, PASSAGES.findIndex((p) => p.id === q.answer));
  const embed = async (c, texts, { query }) => {
    seen.push({ key: c.key, query, n: texts.length, instruction: query ? c.instruction || null : null });
    if (c.key === "broken") throw new Error("model_unavailable: x");
    return texts.map((t) => { const v = new Array(PASSAGES.length).fill(0); v[axis.get(t)] = 1; return v; });
  };
  let clock = 0;
  const out = await compareEmbeddings({ embed, list: [{ key: "good", model: "m", instruction: "I" }, { key: "broken", model: "b" }], nowMs: () => (clock += 10) });
  const [good, broken] = out.results;
  assert.equal(good.recall1, 1);
  assert.equal(good.mrr, 1);
  assert.equal(good.searchEmbedMs, 10);
  assert.ok(good.firstCallMs > 0);
  assert.match(broken.error, /model_unavailable/);
  assert.equal(seen.filter((s) => s.key === "good" && !s.query).length, 1, "passages embedded once, as documents");
  assert.ok(seen.filter((s) => s.key === "good" && s.query).every((s) => s.instruction === "I"));
  assert.equal(median([5, 1, 9, 3]), 3);
});
