import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./chat.js", import.meta.url), "utf8");
const agentChatDoctrine = await readFile(
  new URL("../../akoro-agent/policies/AGENT_CHAT.md", import.meta.url), "utf8");
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
  // P1: the agent-chat operating doctrine loads from the workspace.
  assert.match(agentChatDoctrine, /never submit one automatically/);
  assert.match(source, /assembleChatDoctrine/);
  assert.match(source, /Never expose a raw transcript, internal scratchpad, hidden reasoning, or raw tool output/);
});

test("the instructor chat is durable and uses the shared Fortizo composer", () => {
  // Same session store as learners: lazily created owned session, resume on
  // mount, and both transports carry the durable turn key + chat mode.
  assert.match(instructorChatPage, /ensureChatSession/);
  assert.match(instructorChatPage, /openChatSession\(list\[0\]\.id\)/);
  assert.match(instructorChatPage, /role: 'instructor', conversationId: sid, turnId, mode: chatMode/);
  // The composer is the learner app's Fortizo one; modes mirror its trio.
  assert.match(instructorChatPage, /<FortizoChatComposer/);
  assert.match(instructorChatPage, /const CHAT_MODES = \[/);
  assert.match(instructorChatPage, /id: 'research', label: 'Research'/);
  // Prompt chips fill the composer — they never auto-send.
  assert.match(instructorChatPage, /setInput\(chip\.fill\)/);
  assert.doesNotMatch(instructorChatPage, /onClick=\{\(\) => send\(chip/);
  // A transient failure gets one quiet retry on a FRESH turn key before the
  // honest error bubble — a dropped stream must not dead-end the instructor.
  assert.match(instructorChatPage, /const attemptTurn = async \(turnId\) =>/);
  assert.match(instructorChatPage, /data = await attemptTurn\(newTurnId\(\)\);\s*\n\s*\} catch \(e\) \{/);
});
