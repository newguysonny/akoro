import assert from "node:assert/strict";
import test from "node:test";

import { AGENT_CHAT_ENDPOINT, AGENT_CHAT_STOP_ENDPOINT, agentChatEndpoint, createAgentChatTurnId } from "../features/agent-chat/lib/agentChatEndpoint.js";

test("all learner Agent Chat turns use the single /agent response endpoint", () => {
  assert.equal(AGENT_CHAT_ENDPOINT, "/api/adaptive/chat/agent");
  assert.equal(agentChatEndpoint(), AGENT_CHAT_ENDPOINT);
  assert.equal(agentChatEndpoint({ stream: true }), "/api/adaptive/chat/agent?stream=1");
  assert.equal(AGENT_CHAT_STOP_ENDPOINT, "/api/adaptive/chat/agent/stop");
});

test("each Agent Chat request has an opaque retry-safe turn identifier", () => {
  const turnId = createAgentChatTurnId();
  assert.match(turnId, /^turn_[A-Za-z0-9_-]{8,180}$/);
});
