import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./chat.js", import.meta.url), "utf8");

test("the sole Agent Chat response authority is the unified /agent route", () => {
  assert.match(source, /router\.post\("\/agent", async \(req, res\) =>/);
  assert.doesNotMatch(source, /router\.post\("\/tutor"/);
  assert.doesNotMatch(source, /router\.post\("\/chat"/);
});

test("the unified route assembles study grounding and invokes the authorised tool loop", () => {
  const route = source.slice(source.indexOf('router.post("/agent"'));
  assert.match(route, /getSyllabusGrounding\(userMessage/);
  assert.match(route, /getPastQuestionGrounding\(userMessage/);
  assert.match(route, /processAttachments\(rawAttachments\)/);
  assert.match(route, /runAgentToolLoop\(/);
  assert.match(route, /get_agent_capabilities/);
  assert.match(route, /toolChoice: "none"/);
});

test("durable Agent Chat context stays server-owned and uses an idempotent turn", () => {
  const route = source.slice(source.indexOf('router.post("/agent"'));
  assert.match(route, /loadLearnerAgentConversationContext/);
  assert.match(route, /retrieveLearnerAgentMemory/);
  assert.match(route, /completedLearnerAgentConversationTurn/);
  assert.match(route, /persistLearnerAgentConversationTurn/);
  assert.match(route, /sessionId: agentSessionId\(conversationId\)/);
  assert.match(route, /turnId,/);
});
