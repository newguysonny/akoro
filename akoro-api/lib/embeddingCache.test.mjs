import assert from "node:assert/strict";
import test from "node:test";
import { singleTextKey, cacheModel, DEFAULT_EMBED_MODEL } from "./embeddingCache.js";

test("same text → same key; different text → different key", () => {
  const a = singleTextKey({ input: "the water cycle" });
  const b = singleTextKey({ input: "the water cycle" });
  const c = singleTextKey({ input: "the water cycle!" });
  assert.equal(a, b, "identical text must share a key");
  assert.notEqual(a, c, "changed text must invalidate (a different key)");
  assert.match(a, /^[0-9a-f]{64}$/, "a sha256 hex");
});

test("batch and blank inputs bypass the cache (no key)", () => {
  assert.equal(singleTextKey({ input: ["a", "b"] }), null);
  assert.equal(singleTextKey({ input: "   " }), null);
  assert.equal(singleTextKey({ input: 42 }), null);
});

test("the key is scoped to provider:model", () => {
  const def = singleTextKey({ input: "x" });
  const other = singleTextKey({ input: "x", model: "some-other-model" });
  assert.notEqual(def, other, "a different model must not share a vector key");
  assert.match(cacheModel({}), new RegExp(DEFAULT_EMBED_MODEL));
});
