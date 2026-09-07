/**
 * One browser-facing response authority for learner Agent Chat.
 *
 * Intent recognition must never decide whether a learner receives tutoring or
 * an account action. The server-side agent prompt and authorised tools make
 * that decision after authenticating the learner and loading their context.
 */
export const AGENT_CHAT_ENDPOINT = "/api/adaptive/chat/agent";

export function agentChatEndpoint({ stream = false } = {}) {
  return stream ? `${AGENT_CHAT_ENDPOINT}?stream=1` : AGENT_CHAT_ENDPOINT;
}

export function createAgentChatTurnId() {
  const uuid = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `turn_${uuid}`;
}
