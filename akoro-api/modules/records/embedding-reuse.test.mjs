// H3: identical chunk text already embedded for this learner reuses the
// vector; only genuinely new text is sent to the provider. Pure planner.
import assert from "node:assert/strict";
import test from "node:test";
import { planEmbeddingReuse } from "./searchLib.js";

const row = (hash) => ({ content_hash: hash, text: `text-${hash}` });

test("identical text reuses its stored vector", () => {
  const { reused, missing } = planEmbeddingReuse(
    [row("a"), row("b")],
    [{ content_hash: "a", embedding: [0.1, 0.2], embed_model: "text-embedding-3-small" }],
    "text-embedding-3-small",
  );
  assert.deepEqual(reused[0], [0.1, 0.2]);
  assert.equal(reused[1], null);
  assert.deepEqual(missing, [1]);
});

test("a vector from another embedding model is never mixed in", () => {
  const { reused, missing } = planEmbeddingReuse(
    [row("a")],
    [{ content_hash: "a", embedding: [0.9], embed_model: "runpod-other" }],
    "text-embedding-3-small",
  );
  assert.equal(reused[0], null);
  assert.deepEqual(missing, [0]);
});

test("rows without a hash are always embedded, even if text repeats", () => {
  const { missing } = planEmbeddingReuse([{ text: "x" }, { text: "x" }], [{ content_hash: "x", embedding: [1] }], "m");
  assert.deepEqual(missing, [0, 1]);
});

test("no existing vectors → everything is embedded", () => {
  const { reused, missing } = planEmbeddingReuse([row("a")], [], "m");
  assert.deepEqual(reused, [null]);
  assert.deepEqual(missing, [0]);
});
