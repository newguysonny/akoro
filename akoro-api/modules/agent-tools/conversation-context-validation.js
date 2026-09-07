/**
 * Pure validation/bounding helpers for the private Python conversation gateway.
 * Kept dependency-free so the durable-context contract can be tested without
 * starting the API or importing database-backed routes.
 */

export const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const AGENT_ID = /^[A-Za-z0-9_-]{1,180}$/;
export const TURN_ID = /^[A-Za-z0-9_-]{8,180}$/;
export const MEMORY_KINDS = new Set(["learning_summary", "study_preference", "learner_goal"]);

export function boundedText(value, maximum) {
  return typeof value === "string"
    ? value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim().slice(0, maximum)
    : "";
}

export function conversationRequest(body = {}) {
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const toolContext = typeof body.toolContext === "string" ? body.toolContext : "";
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  if (!AGENT_ID.test(sessionId) || !toolContext || toolContext.length > 4096 || !CONVERSATION_ID.test(conversationId)) {
    throw new Error("sessionId, toolContext, and conversationId are required");
  }
  return { sessionId, toolContext, conversationId };
}

export function persistenceRequest(body = {}) {
  const { sessionId, toolContext, conversationId } = conversationRequest(body);
  const turnId = typeof body.turnId === "string" ? body.turnId : "";
  const userMessage = boundedText(body.userMessage, 12_000);
  const assistantMessage = boundedText(body.assistantMessage, 12_000);
  const summary = boundedText(body.summary, 4_000);
  if (!TURN_ID.test(turnId) || !userMessage || !assistantMessage || !summary) {
    throw new Error("turnId, userMessage, assistantMessage, and summary are required");
  }
  const raw = Array.isArray(body.memories) ? body.memories : [];
  if (raw.length > 4) throw new Error("At most four memory notes may be saved per turn");
  const memories = raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("memory note is invalid");
    const kind = typeof item.kind === "string" ? item.kind : "";
    const content = boundedText(item.content, 1_500);
    const topic = boundedText(item.topic, 180) || null;
    const subject = boundedText(item.subject, 180) || null;
    if (!MEMORY_KINDS.has(kind) || !content) throw new Error("memory note is invalid");
    return { kind, content, topic, subject };
  });
  return { sessionId, toolContext, conversationId, turnId, userMessage, assistantMessage, summary, memories };
}

export function publicConversationMessage(row = {}) {
  const role = row.role === "agent" ? "assistant" : row.role;
  if (role !== "user" && role !== "assistant") return null;
  const content = boundedText(row.text ?? row.content, 12_000);
  if (!content) return null;
  return {
    role,
    content,
    createdAt: row.created_at || row.createdAt || null,
  };
}

export function publicMemory(row = {}) {
  if (!MEMORY_KINDS.has(row.kind)) return null;
  const content = boundedText(row.content, 1_500);
  if (!content) return null;
  return {
    id: boundedText(row.id, 80),
    kind: row.kind,
    content,
    topic: boundedText(row.topic, 180) || null,
    subject: boundedText(row.subject, 180) || null,
  };
}
