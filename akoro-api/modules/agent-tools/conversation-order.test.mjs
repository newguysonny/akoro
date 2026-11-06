import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
const { boundedConversationMessages } = await import("./conversation-context-routes.js");

// The query returns rows NEWEST FIRST (created_at descending, limit 40).
const chat = (n) => Array.from({ length: n }, (_, i) => ({
  role: i % 2 ? "agent" : "user", text: `message ${i + 1}`, created_at: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
})).reverse();

test("the model gets the LATEST messages, oldest to newest", () => {
  const out = boundedConversationMessages(chat(32));
  assert.equal(out.length, 24);
  assert.equal(out.at(-1).content, "message 32", "the last message is the latest one");
  assert.equal(out[0].content, "message 9", "the window is the latest 24, not the first 24");
  for (let i = 1; i < out.length; i++) assert.ok(out[i].createdAt > out[i - 1].createdAt, "chronological order");
});

test("a short chat is passed whole, in order; the input array is not mutated", () => {
  const rows = chat(4);
  const copy = JSON.stringify(rows);
  const out = boundedConversationMessages(rows);
  assert.deepEqual(out.map((m) => m.content), ["message 1", "message 2", "message 3", "message 4"]);
  assert.equal(JSON.stringify(rows), copy);
});

test("the character budget drops the OLDEST messages, never the latest", () => {
  const rows = chat(6).map((r, i) => ({ ...r, text: `${r.text} ${"x".repeat(9000)}` }));
  const out = boundedConversationMessages(rows);
  assert.equal(out.at(-1).content.startsWith("message 6"), true);
  assert.ok(!out.some((m) => m.content.startsWith("message 1 ")));
});
