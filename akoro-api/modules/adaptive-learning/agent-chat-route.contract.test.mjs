import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./chat.js", import.meta.url), "utf8");
const instructorChatPage = await readFile(
  new URL("../../../akoro-instructor/src/pages/ChatPage.jsx", import.meta.url), "utf8",
);
const learnerChatTab = await readFile(
  new URL("../../../akoro-learner/src/components/tabs/AgentChatTab.jsx", import.meta.url), "utf8",
);

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
  assert.match(route, /requiresAgentCapabilitiesTool\(userMessage\)/);
  assert.match(route, /requiredTool:.*get_agent_capabilities/s);
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

test("learner study projections remain bounded tools and product feedback needs explicit consent", () => {
  for (const tool of [
    "get_learning_overview", "get_knowledge_map", "search_my_study_knowledge",
    "get_concept_tracker_summary", "get_learning_insights_summary", "get_exam_prep_status",
    "get_chat_memory", "get_agent_preferences", "get_autonomy_status", "submit_tool_request",
  ]) assert.match(source, new RegExp(`name: "${tool}"`));
  assert.match(source, /hasExplicitToolRequestConsent\(userMessage\)/);
  assert.match(source, /never submit one automatically/);
  assert.match(source, /Never expose a raw transcript, internal scratchpad, hidden reasoning, or raw tool output/);
});
