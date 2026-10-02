import assert from "node:assert/strict";
import test from "node:test";

import { blocksToConversationHistory } from "./continuation-history.js";

test("maps user and student-agent blocks into the conversation roles the workflow uses", () => {
  const history = blocksToConversationHistory([
    { type: "user",          text: "Photosynthesis is how plants make food." },
    { type: "student-agent", text: "Oh interesting — from sunlight?" },
    { type: "guide",         text: "Good start — ask about the chloroplast." },
  ]);

  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map(h => h.role),
    ["human_teacher", "student_agent"]
  );
  assert.equal(history[0].content, "Photosynthesis is how plants make food.");
  assert.equal(history[1].content, "Oh interesting — from sunlight?");
  // Provenance marker + timestamp, so restored turns are distinguishable.
  assert.ok(history.every(h => h.restored === true));
  assert.ok(history.every(h => h.timestamp instanceof Date));
});

test("UI chrome blocks never become conversation memory", () => {
  const history = blocksToConversationHistory([
    { type: "guide",           text: "Steer them back to the mitochondria." },
    { type: "sargeant",        text: "Assessment gate — hold." },
    { type: "subtopic-hdr",    text: "Cell respiration", items: [] },
    { type: "system-divider",  label: "Previous session" },
    { type: "assess-result",   confidence: 70, passed: true },
    { type: "session-complete", text: "Done!" },
  ]);

  assert.deepEqual(history, []);
});

test("keeps only the most recent turns and truncates each entry", () => {
  const blocks = [];
  for (let i = 1; i <= 10; i++) {
    blocks.push({ type: "user", text: `question ${i}` });
    blocks.push({ type: "student-agent", text: `answer ${i}` });
  }
  const history = blocksToConversationHistory(blocks);

  // Default cap is the last 12 turns — the first two exchanges fall off.
  assert.equal(history.length, 12);
  assert.equal(history[0].content, "question 5");
  assert.equal(history[history.length - 1].content, "answer 10");

  const long = blocksToConversationHistory(
    [{ type: "student-agent", text: "x".repeat(900) }],
    { maxChars: 50 }
  );
  assert.equal(long[0].content.length, 50);
  assert.ok(long[0].content.endsWith("…"));
});

test("restores legacy JSON-string block_history without failing session start", () => {
  const history = blocksToConversationHistory(
    JSON.stringify([{ type: "user", text: "legacy row" }])
  );
  assert.equal(history.length, 1);
  assert.equal(history[0].content, "legacy row");
});

test("unreadable or absent input degrades to blank memory, never an error", () => {
  assert.deepEqual(blocksToConversationHistory(null), []);
  assert.deepEqual(blocksToConversationHistory(undefined), []);
  assert.deepEqual(blocksToConversationHistory("not json {"), []);
  assert.deepEqual(blocksToConversationHistory({ nope: true }), []);
  assert.deepEqual(blocksToConversationHistory([{ type: "user" }, null, 42]), []);
});
