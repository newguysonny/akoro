import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (f) => readFile(new URL(f, import.meta.url), "utf8");
const source = await read("../features/agent-chat/AgentChatTab.jsx");
// The teaching session was split (Phase 19 step 6): its socket lifecycle is
// in the feature hook, its markup in the feature's components.
const teachSource = (await Promise.all([
  read("../features/teaching/components/TeachAgentModal.jsx"),
  read("../features/teaching/hooks/useTeachAgent.js"),
])).join("\n");
const decaySource = await read("../features/teaching/components/DecaySessionModal.jsx");

const between = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end));

test("Agent Chat delegates every reply to the unified authenticated API authority", () => {
  const sendMessage = between(source, "const sendMessage=async", "const toLocalInput=");

  assert.match(sendMessage, /streamPost\(agentChatEndpoint\(\{ stream: true \}\), payload/);
  assert.match(sendMessage, /apiPost\(agentChatEndpoint\(\), payload\)/);
  assert.doesNotMatch(sendMessage, /\/api\/adaptive\/chat\/(?:tutor|chat|message)/);
  assert.doesNotMatch(sendMessage, /get_agent_capabilities/);
  assert.doesNotMatch(sendMessage, /createTask\s*\(/);
  assert.match(sendMessage, /toolExecutions/);
  assert.match(sendMessage, /refetchTasks\(\)/);
});

test("adaptive teaching turns remain socket-only and never supply a browser identity", () => {
  for (const sessionSource of [teachSource, decaySource]) {
    assert.match(sessionSource, /emit\("start_adaptive_session"/);
    assert.match(sessionSource, /emit\("teacher_message"/);
    assert.match(sessionSource, /emit\("resume_session"/);
    assert.doesNotMatch(sessionSource, /\/api\/adaptive\/(?:chat\/(?:agent|tutor)|teaching\/(?:start|message|summary))/);
    assert.doesNotMatch(sessionSource, /studentId\s*:\s*STUDENT_ID/);
    assert.doesNotMatch(sessionSource, /userId\s*:\s*STUDENT_ID/);
  }

  assert.match(teachSource, /emit\("request_summary"/);
});
