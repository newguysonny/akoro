import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
const { searchTerms, snippetAround, mergeChatHits } = await import("./chat-history-tools.js");
const read = (f) => readFile(new URL(f, import.meta.url), "utf8");

test("searchTerms: distinctive words only, longest first, max 4", () => {
  assert.deepEqual(searchTerms("What did we say about osmosis last week?"), ["osmosis", "last", "week"]);
  assert.deepEqual(searchTerms("the and for"), []);
  assert.ok(searchTerms("photosynthesis chlorophyll respiration mitochondria enzymes").length <= 4);
  assert.ok(!searchTerms("100% (drop) tables,").some((t) => /[%(),]/.test(t)), "ilike-unsafe characters never reach the query");
});

test("snippetAround: centred on the matched word, bounded", () => {
  const long = `${"a ".repeat(300)}we said osmosis moves water ${"b ".repeat(300)}`;
  const s = snippetAround(long, ["osmosis"], 120);
  assert.ok(s.includes("osmosis"));
  assert.ok(s.length <= 125);
  assert.equal(snippetAround("short text", ["x"]), "short text");
});

test("mergeChatHits: found both ways ranks first; message hit keeps its time for read_chat around", () => {
  const out = mergeChatHits({
    terms: ["osmosis"],
    summaries: [{ chatId: "A", content: "Biology revision: diffusion" }, { chatId: "B", content: "Osmosis and water potential" }],
    messages: [{ chatId: "B", text: "Osmosis is the movement of water", at: "2026-10-30T10:00:00Z" }, { chatId: "C", text: "osmosis again", at: "2026-10-01T10:00:00Z" }],
  });
  assert.equal(out[0].chatId, "B");
  assert.deepEqual(out[0].matchedBy.sort(), ["meaning", "words"]);
  assert.equal(out[0].matchedAt, "2026-10-30T10:00:00Z");
  assert.ok(out.find((c) => c.chatId === "A").snippet.includes("diffusion"));
  assert.equal(mergeChatHits({ summaries: [], messages: [] }).length, 0);
});

test("search_chats is a read tool, owner-scoped, and read_chat can land around a match", async () => {
  const [chat, history] = await Promise.all([read("../chat.js"), read("./chat-history-tools.js")]);
  assert.match(chat, /name: "search_chats",/);
  assert.match(chat, /case "search_chats": \{/);
  assert.doesNotMatch(chat.match(/export const SIDE_EFFECT_TOOLS = \[[^\]]*\]/)[0], /"search_chats"/);
  // every search path is scoped to the learner
  assert.match(history, /p_user_id: userId/);
  assert.match(history, /from\("chat_messages"\)\.select\("session_id, text, created_at"\)\s*\.eq\("user_id", userId\)/);
  assert.match(history, /from\("chat_sessions"\)\.select\("id, title, last_message_at"\)\s*\.eq\("user_id", userId\)\.in\("id"/);
  assert.match(chat, /around: input\.around/);
});
