/**
 * lib/chatBridge.js — the chat tool catalogue and tool runner other modules
 * need, installed at boot (Phase 19 step 2). agent-tools and agent-capabilities
 * read this instead of importing adaptive-learning/chat.js internals.
 */
let bridge = null;

export function setChatBridge(next) {
  bridge = next;
}

/** → { CHAT_TOOLS, getLearnerChatTools, INSTRUCTOR_TOOLS, openAiInstructorTools, executeChatTool } */
export function chatBridge() {
  if (!bridge) throw new Error("Chat bridge used before installation (setChatBridge at boot).");
  return bridge;
}
