import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Self-hosted embeddings (2026-10-20): Qwen3-Embedding-0.6B on our RunPod
 * endpoint, 1024 dims padded to the 1536 columns, behind the one embeddings
 * seam — and never mixed with OpenAI's vectors.
 */
import { canEmbed, DB_DIMENSIONS, embeddingsProvider, padTo, runpodEmbeddings, selfHostedModel, SELF_HOSTED_DIMENSIONS, SELF_HOSTED_MODEL } from "./embeddingProvider.js";

const env = { EMBEDDINGS_PROVIDER: "runpod", RUNPOD_EMBED_ENDPOINT_ID: "ep1", RUNPOD_API_KEY: "k" };

test("the provider is RunPod only when it's chosen AND configured", () => {
  assert.equal(embeddingsProvider(env), "runpod");
  assert.equal(embeddingsProvider({ ...env, RUNPOD_EMBED_ENDPOINT_ID: "" }), "openai", "half-configured stays on OpenAI");
  assert.equal(embeddingsProvider({}), "openai");
  assert.equal(canEmbed(env), true, "no OpenAI key needed with our own endpoint");
  assert.equal(canEmbed({}), false);
});

test("padding with zeros keeps cosine similarity exactly the model's own", () => {
  const a = [0.6, 0.8], b = [0.8, 0.6];
  const cos = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0) / Math.sqrt(x.reduce((s, v) => s + v * v, 0) * y.reduce((s, v) => s + v * v, 0));
  const pa = padTo(a), pb = padTo(b);
  assert.equal(pa.length, DB_DIMENSIONS);
  assert.ok(Math.abs(cos(a, b) - cos(pa, pb)) < 1e-12);
  assert.throws(() => padTo(new Array(2000).fill(0)), /columns hold 1536/);
});

test("runsync → OpenAI's shape, padded, in order, with its usage; a cold worker is polled", async () => {
  const calls = [];
  const v = (x) => { const out = new Array(SELF_HOSTED_DIMENSIONS).fill(0); out[0] = x; return out; };
  const answers = [
    { status: "IN_QUEUE", id: "job1" },
    { status: "IN_PROGRESS", id: "job1" },
    { status: "COMPLETED", id: "job1", output: { embeddings: [v(1), v(2)], usage: { prompt_tokens: 12 } } },
  ];
  const fetchImpl = async (url, init) => { calls.push({ url, method: init.method, body: init.body }); return { ok: true, status: 200, json: async () => answers.shift() }; };
  const res = await runpodEmbeddings({ input: ["a", "b"], model: "text-embedding-3-small" }, { env, fetchImpl, sleep: async () => {} });
  assert.match(calls[0].url, /^https:\/\/api\.runpod\.ai\/v2\/ep1\/runsync/);
  assert.deepEqual(JSON.parse(calls[0].body), { input: { input: ["a", "b"], dimensions: 1024 } });
  assert.match(calls[1].url, /\/status\/job1$/);
  assert.equal(res.model, SELF_HOSTED_MODEL);
  assert.deepEqual(res.data.map((d) => [d.index, d.embedding.length, d.embedding[0]]), [[0, 1536, 1], [1, 1536, 2]]);
  assert.deepEqual(res.usage, { prompt_tokens: 12, total_tokens: 12 });
});

test("a worker error is an error — never an empty or partial result", async () => {
  const once = (body, status = 200) => async () => ({ ok: status < 300, status, json: async () => body });
  await assert.rejects(runpodEmbeddings({ input: "a" }, { env, fetchImpl: once({ status: "COMPLETED", output: { error: "model_unavailable: x" } }) }), (e) => e.status === 503);
  await assert.rejects(runpodEmbeddings({ input: "a" }, { env, fetchImpl: once({ status: "COMPLETED", output: { embeddings: [] } }) }), /0 vectors for 1 texts/);
  await assert.rejects(runpodEmbeddings({ input: "a" }, { env, fetchImpl: once({}, 401) }), (e) => e.status === 401);
  await assert.rejects(runpodEmbeddings({ input: "a" }, { env, fetchImpl: once({ status: "FAILED", error: "boom" }) }), /FAILED: boom/);
});

test("the seam: one breaker, either provider, never a fallback between them; billed under the model that answered", async () => {
  const [aiModelSrc, breakersSrc] = await Promise.all([
    readFile(new URL("./aiModel.js", import.meta.url), "utf8"),
    readFile(new URL("./aiBreakers.js", import.meta.url), "utf8"),
  ]);
  const src = `${aiModelSrc}\n${breakersSrc}`;
  assert.match(src, /embeddingsProvider\(\) === "runpod" \? runpodEmbeddings\(params\) : rawClient\.embeddings\.create\(params\)/);
  assert.match(src, /isSelfHostedModel\(res\.model\) \? res\.model/);
});

test("the switch covers every table that stores a vector", async () => {
  const { readdir } = await import("node:fs/promises");
  const dir = new URL("../migrations/", import.meta.url);
  const tables = new Set();
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".sql"))) {
    const sql = await readFile(new URL(f, dir), "utf8");
    // Each vector column belongs to the nearest table named above it (search functions' parameters aren't columns).
    for (const m of sql.matchAll(/^\s*(?:ADD COLUMN IF NOT EXISTS\s+)?embedding\s+vector\(1536\)/gim)) {
      const owner = [...sql.slice(0, m.index).matchAll(/(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+edu\.(\w+)/gi)].pop();
      if (owner) tables.add(owner[1]);
    }
  }
  const src = await readFile(new URL("./embeddingCutover.js", import.meta.url), "utf8");
  for (const t of tables) assert.match(src, new RegExp(`table: "${t}"`), `${t} is re-embedded on a switch`);
  assert.ok(tables.size >= 9, [...tables].join(", "));
});

test("two self-hosted models, one endpoint each: EMBEDDINGS_MODEL picks the app's; a model without an endpoint isn't used", async () => {
  const both = { ...env, RUNPOD_EMBED_BGE_ENDPOINT_ID: "ep-bge" };
  assert.equal(selfHostedModel(both), "qwen3-embedding-0.6b", "Qwen3 unless named");
  assert.equal(selfHostedModel({ ...both, EMBEDDINGS_MODEL: "bge-m3" }), "bge-m3");
  assert.equal(selfHostedModel({ ...both, EMBEDDINGS_MODEL: "nonsense" }), "qwen3-embedding-0.6b");
  assert.equal(embeddingsProvider({ ...env, EMBEDDINGS_MODEL: "bge-m3" }), "openai", "bge-m3 chosen but not deployed → stays on OpenAI");
  assert.equal(embeddingsProvider({ ...both, EMBEDDINGS_MODEL: "bge-m3" }), "runpod");
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ status: "COMPLETED", output: { embeddings: [[1]], usage: { prompt_tokens: 1 } } }) }; };
  const bge = await runpodEmbeddings({ input: "a" }, { env: both, model: "bge-m3", fetchImpl });
  assert.match(calls[0].url, /\/v2\/ep-bge\/runsync/);
  assert.equal(bge.model, "bge-m3", "billed under the model that answered");
  await runpodEmbeddings({ input: "q" }, { env: both, instruction: "Find the passage", fetchImpl });
  assert.match(calls[1].url, /\/v2\/ep1\//);
  assert.equal(calls[1].body.input.instruction, "Find the passage");
  await assert.rejects(runpodEmbeddings({ input: "a" }, { env, model: "bge-m3", fetchImpl }), /RUNPOD_EMBED_BGE_ENDPOINT_ID/);
});
