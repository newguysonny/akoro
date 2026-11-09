import assert from "node:assert/strict";
import test from "node:test";
import { contentKey, extractOnce } from "./extractionCache.js";

test("contentKey: same inputs → same key; changes with bytes, model or hint", () => {
  const base = { scope: "syllabus_vision", model: "gpt-4o", hint: "{}" };
  const a = contentKey(Buffer.from("pdf-bytes"), base);
  const b = contentKey(Buffer.from("pdf-bytes"), base);
  assert.equal(a, b);
  assert.notEqual(a, contentKey(Buffer.from("other-bytes"), base));
  assert.notEqual(a, contentKey(Buffer.from("pdf-bytes"), { ...base, model: "gpt-4o-mini" }));
  assert.notEqual(a, contentKey(Buffer.from("pdf-bytes"), { ...base, hint: '{"exam":"WAEC"}' }));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("extractOnce: the extractor runs exactly once; the second call is a cache hit", async () => {
  const store = new Map();
  let calls = 0;
  const extract = async () => { calls++; return { name: "Physics", topics: [{ title: "Motion" }] }; };
  const get = async (k) => store.get(k) ?? null;
  const put = async (k, v) => { store.set(k, v); };
  const key = contentKey(Buffer.from("x"), { scope: "s" });

  const first = await extractOnce({ key, extract, get, put });
  assert.equal(first.cached, false);
  assert.equal(calls, 1);

  const second = await extractOnce({ key, extract, get, put });
  assert.equal(second.cached, true);
  assert.equal(calls, 1, "extraction is not re-run for the same content");
  assert.deepEqual(second.doc, first.doc);
});

test("extractOnce: a cache failure degrades to a miss, never throws", async () => {
  const out = await extractOnce({ key: "k", extract: async () => ({ ok: true }), get: async () => { throw new Error("db down"); }, put: async () => {} });
  assert.deepEqual(out, { doc: { ok: true }, cached: false });
});
