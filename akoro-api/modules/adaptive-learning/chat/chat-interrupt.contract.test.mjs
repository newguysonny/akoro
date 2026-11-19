import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const chat = readFileSync(new URL("../chat.js", import.meta.url), "utf8");
const api = readFileSync(new URL("../../../../akoro-learner/src/services/api.js", import.meta.url), "utf8");

test("an interrupted stream persists what the learner saw", () => {
  assert.match(chat, /let streamedAnswer = ""/, "answer deltas are accumulated");
  assert.match(chat, /streamedAnswer \+= data\.text/);
  assert.match(chat, /could not save the interrupted turn/);
  assert.match(chat, /appendFastChatTurn\(\{[\s\S]{0,300}turnCtx\.turnId/, "the catch saves under the same turn");
  assert.match(chat, /The connection dropped while the agent was working/, "honest client-facing message");
});

test("chat streams are exempt from the 30-second API deadline", () => {
  assert.match(api, /\}, 0\);/, "streamPost calls authedFetch with timeout 0");
});
