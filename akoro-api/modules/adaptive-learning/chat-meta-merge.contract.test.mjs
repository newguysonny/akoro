import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("reply materials and ideas merge atomically instead of overwriting", () => {
  const chat = read("./chat.js");
  const sql = read("../../migrations/2026-chat-message-meta-merge.sql");
  const manifest = JSON.parse(read("../../migrations/manifest.json"));
  assert.match(sql, /create or replace function public\.merge_chat_message_meta/);
  assert.match(sql, /coalesce\(meta, '\{\}'::jsonb\) \|\| coalesce\(p_patch/, "jsonb || merge in one UPDATE");
  assert.ok(manifest.schema.includes("2026-chat-message-meta-merge.sql"));
  assert.match(chat, /async function mergeChatMeta/, "one merge helper");
  assert.match(chat, /db\.rpc\("merge_chat_message_meta"/, "uses the atomic function");
  assert.match(chat, /if \(meta\) await mergeChatMeta\(messageId, meta\)/, "the turn merges materials");
  assert.match(chat, /await mergeChatMeta\(last\.id, \{ ideas: ideas\.slice\(0, 3\) \}\)/, "suggestions merge ideas");
  assert.doesNotMatch(chat, /update\(\{ \.\.\.\(hasTrace \? \{ trace \} : \{\}\), \.\.\.\(meta \? \{ meta \} : \{\}\) \}\)/, "no replacing write remains");
});
