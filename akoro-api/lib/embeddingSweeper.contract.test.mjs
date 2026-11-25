// Cost guard: the sweeper must batch a store's texts into ONE provider call.
// On the RunPod endpoint, one call per row cold-started workers repeatedly and
// left them idle-billed (the qwen3 log showed ~16 jobs every 10 minutes).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "embeddingSweeper.js"), "utf8");

test("one embeddings call per store, not one per row", () => {
  const sweep = /export async function sweepOnce[\s\S]*?\n\}/.exec(src)?.[0] || "";
  assert.match(sweep, /embeddable\.push\(\{ row: r, text \}\)/);
  assert.match(sweep, /openai\.embeddings\.create\(\{/);
  assert.match(sweep, /input: embeddable\.map/);
  assert.doesNotMatch(sweep, /await embedText\(/, "no per-row embedding calls");
});

test("the sweeper still bounds and parks stores", () => {
  assert.match(src, /const BATCH = 25/);
  assert.match(src, /FAILED_STORE_BACKOFF_MS/);
  assert.match(src, /is\("embedding", null\)\.is\("embedded_at", null\)/);
});
