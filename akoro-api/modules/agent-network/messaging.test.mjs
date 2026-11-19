import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-openai-key";
const { screenMessage, buildPeerAnswerMessages, shapeAnswer, MESSAGE_LIMITS, AGENT_CONSULT_FEATURE } = await import("./messaging.js");
const src = await readFile(new URL("./messaging.js", import.meta.url), "utf8");
const chat = await readFile(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");
const toolCatalogue = await readFile(new URL("../adaptive-learning/chat/tool-catalogue-core.js", import.meta.url), "utf8");

test("screening: length bounds; no emails, phones or links cross between learners", () => {
  assert.equal(screenMessage("How do you remember the stages of mitosis?").ok, true);
  assert.equal(screenMessage("hi").reason, "too_short");
  assert.equal(screenMessage("x".repeat(MESSAGE_LIMITS.MAX_CHARS + 1)).reason, "too_long");
  for (const bad of ["email me at ada@example.com please", "call 0803 123 4567 tonight ok", "join wa.me/2348031234567 now", "see https://site.com for notes"]) {
    assert.equal(screenMessage(bad).reason, "contact_details", bad);
  }
});

test("the answering agent is a protégé: taught knowledge only, nothing personal; contact details stripped", () => {
  const [sys, user] = buildPeerAnswerMessages({ agentName: "Zara", learnerFirst: "Tobi", question: "What is osmosis?", taught: [{ subject: "Biology", topic: "Osmosis", content: "Water moves across a membrane." }], askerAgent: "Kofi" });
  assert.match(sys.content, /only know what Tobi has taught you/);
  assert.match(sys.content, /hasn't taught you that yet/);
  assert.match(sys.content, /Never share anything personal/);
  assert.match(user.content, /Water moves across a membrane/);
  assert.match(buildPeerAnswerMessages({ agentName: "Z", learnerFirst: "T", question: "q?", taught: [] })[1].content, /nothing on this/);
  const a = shapeAnswer({ answer: "Ask me at tobi@mail.com or 08031234567", from_taught: true });
  assert.doesNotMatch(a.answer, /tobi@mail\.com|08031234567/);
  assert.equal(a.fromTaught, true);
});

test("the asker pays; limits per day and per recipient; privacy and blocks apply; live consult uses online agents", () => {
  assert.match(src, /__userId: asker, __feature: AGENT_CONSULT_FEATURE/);
  assert.equal(AGENT_CONSULT_FEATURE, "agent_consult");
  assert.match(src, /PER_RECIPIENT_PER_DAY/);
  assert.match(src, /canMessage\(/);
  assert.match(chat, /const live = await consultOnlineAgents\(studentId, question/);
  for (const name of ["message_agent", "check_agent_inbox", "reply_to_agent"]) {
    assert.match(toolCatalogue, new RegExp(`name: "${name}",`));
    assert.match(chat, new RegExp(`case "${name}": \\{`));
  }
  assert.match(chat, /protegeCtx \+ inboxCtx \+/);
});
