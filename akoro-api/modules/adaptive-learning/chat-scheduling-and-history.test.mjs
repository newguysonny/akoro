// "Message me here in 10 minutes" + the agent's chat-history tools.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateFollowUpInput } from "./chat-follow-up-validation.js";
import { validateLearnerTaskInput } from "./learner-task-validation.js";

const chat = readFileSync(new URL("./chat.js", import.meta.url), "utf8");
const followUps = readFileSync(new URL("./chat-follow-ups.js", import.meta.url), "utf8");
const history = readFileSync(new URL("./chat-history-tools.js", import.meta.url), "utf8");

test("a relative 'in 10 minutes' is resolved server-side — no clock maths for the model", () => {
  const before = Date.now();
  const v = validateFollowUpInput({ message: "Time to revise!", inMinutes: 10 }, { defaultTimezone: "Africa/Lagos" });
  const at = new Date(v.scheduledAt).getTime();
  assert.ok(at >= before + 10 * 60_000 - 1000 && at <= Date.now() + 10 * 60_000 + 1000);
  assert.ok(v.delayMs > 9 * 60_000);
});

test("an explicit scheduledAt still wins over inMinutes", () => {
  const when = new Date(Date.now() + 60 * 60_000).toISOString();
  const v = validateFollowUpInput({ message: "hi", inMinutes: 5, scheduledAt: when });
  assert.equal(new Date(v.scheduledAt).toISOString(), when);
});

test("a task can be due 'in 30 minutes'", () => {
  const t = validateLearnerTaskInput({ title: "Revise", priority: "low", dueInMinutes: 30 });
  assert.ok(Math.abs(new Date(t.dueAt).getTime() - (Date.now() + 30 * 60_000)) < 2000);
  assert.equal(validateLearnerTaskInput({ title: "Revise", priority: "low" }).dueAt, null);
});

test("schedule_chat_follow_up can deliver into THIS chat or a chosen one; message-me requests don't become tasks", () => {
  assert.match(chat, /where: \{ type: "string", enum: \["here", "chat", "new"\]/);
  assert.match(chat, /if \(where === "here"\) \{[\s\S]{0,200}targetSessionId = conversationId;/);
  assert.match(chat, /targetSessionId = await ownedChatId\(studentId, input\.chatId\);/);
  assert.match(chat, /use schedule_chat_follow_up instead — a task does not send anything/);
  assert.match(chat, /required: \["message"\],/);
  assert.match(followUps, /const chatSessionId = targetSessionId \|\| randomUUID\(\);/);
});

test("chat-history tools exist, are scoped to the learner, and only post_to_chat writes", () => {
  for (const name of ["list_chats", "read_chat", "post_to_chat"]) {
    assert.match(chat, new RegExp(`name: "${name}",`));
    assert.match(chat, new RegExp(`case "${name}": \\{`));
  }
  assert.match(chat, /export const SIDE_EFFECT_TOOLS = \[[^\]]*"post_to_chat"/);
  assert.doesNotMatch(chat.match(/export const SIDE_EFFECT_TOOLS = \[[^\]]*\]/)[0], /"list_chats"|"read_chat"/);
  // every lookup is by id AND user_id
  assert.match(history, /\.eq\("id", chatId\.trim\(\)\)\.eq\("user_id", userId\)/);
  assert.match(history, /\.eq\("session_id", id\)\.eq\("user_id", userId\)/);
  assert.match(history, /That is this chat — just say it in your reply/);
});
