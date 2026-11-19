import assert from "node:assert/strict";
import test from "node:test";
import { preFilterMemories, renderRelevantMemory } from "./chat-memory.js";

test("dedups identical memories, drops empty, keeps distinct", () => {
  const { memories, stats } = preFilterMemories([
    { kind: "note", content: "Likes fractions" },
    { kind: "note", content: "  Likes    fractions " },
    { kind: "note", content: "   " },
    { kind: "summary", content: "Working on biology" },
  ]);
  assert.deepEqual(memories.map((m) => m.text), ["Likes fractions", "Working on biology"]);
  assert.equal(stats.deduped, 1);
  assert.equal(stats.kept, 2);
});

test("caps both item count and total characters", () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ kind: "note", content: `note ${i} ${"z".repeat(20)}` }));
  const { memories, stats } = preFilterMemories(items, { maxItems: 5, maxChars: 10_000 });
  assert.equal(memories.length, 5);
  assert.equal(stats.kept, 5);

  const capped = preFilterMemories([
    { kind: "note", content: "a".repeat(100) },
    { kind: "note", content: "b".repeat(100) },
  ], { maxChars: 150 });
  assert.equal(capped.stats.truncated, 1);
  assert.ok(capped.stats.charsOut <= 150);
});

test("renderRelevantMemory: empty when nothing remains; keeps the 'not evidence' guidance", () => {
  assert.equal(renderRelevantMemory([]), "");
  const block = renderRelevantMemory([{ kind: "study_preference", content: "Likes diagrams" }]);
  assert.match(block, /Relevant learner memory/);
  assert.match(block, /never evidence[\s\S]*call the tool/);
  assert.match(block, /Likes diagrams/);
});
