/**
 * Private durable-context gateway for the additive Python agent service.
 *
 * The existing public `/api/adaptive/chat/sessions` routes remain the learner's
 * history UI. This router lets only the deployed Python service read a bounded
 * owned snapshot and write one completed user/assistant turn with a
 * capability-bound idempotency key. It is not browser-facing.
 */
import { Router } from "express";

import db from "../../db.js";
import { embedText } from "../../lib/embeddingSweeper.js";
import { embedForSearch } from "../../lib/searchEmbedding.js";
import {
  requireAgentToolsCredential,
  verifyAgentToolsCapability,
} from "./capability.js";
import {
  AGENT_ID,
  CONVERSATION_ID,
  MEMORY_KINDS,
  TURN_ID,
  boundedText,
  conversationRequest,
  memoryRetrievalRequest,
  normaliseScratchpad,
  persistenceRequest,
  publicConversationMessage,
  publicMemory,
  publicRelevantMemory,
  publicScratchpad,
} from "./conversation-context-validation.js";

const router = Router();
// A nearest vector neighbour is not automatically useful study context. Lexical
// hits remain valid on their own; vector-only hits must clear this modest floor.
const MIN_MEMORY_SIMILARITY = 0.30;

class ConversationGatewayError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function gatewayError(res, error) {
  const status = error instanceof ConversationGatewayError ? error.status : 503;
  if (!(error instanceof ConversationGatewayError)) {
    console.error("[agent-tools/conversations]", error?.message || error);
  }
  return res.status(status).json({
    success: false,
    error: error instanceof ConversationGatewayError
      ? error.message
      : "Learner conversation context is unavailable",
  });
}

function authorisedRequest(req) {
  let request;
  try {
    request = conversationRequest(req.body || {});
  } catch (error) {
    throw new ConversationGatewayError(422, error.message);
  }
  const claims = verifyAgentToolsCapability(request.toolContext, request.sessionId);
  if (!claims) throw new ConversationGatewayError(403, "Invalid or expired conversation context");
  // Teacher task capabilities are deliberately not a way to browse a learner's
  // personal chat history. They retain their task-scoped tool catalogue only.
  if (claims.scope !== "student") {
    throw new ConversationGatewayError(403, "Learner conversation context requires a learner capability");
  }
  return { ...request, claims };
}

async function activePrincipal(claims) {
  const { data, error } = await db.from("users")
    .select("id, is_active")
    .eq("id", claims.sub)
    .maybeSingle();
  if (error) throw new ConversationGatewayError(503, "Learner identity lookup is unavailable");
  if (!data || !data.is_active) throw new ConversationGatewayError(403, "Learner account is unavailable");
  return data;
}

async function ownedConversation(conversationId, userId) {
  const { data, error } = await db.from("chat_sessions")
    .select("id, title")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ConversationGatewayError(503, "Conversation ownership lookup is unavailable");
  if (!data) throw new ConversationGatewayError(404, "Conversation was not found");
  return data;
}

function boundedConversationMessages(rows) {
  // Keep the most recent, role-correct dialogue inside the same explicit
  // budget the Python LLM adapter accepts. This bounds the private HTTP body as
  // well as provider context cost; the full raw history remains in Akoro.
  const recentFirst = (rows || []).reverse().map(publicConversationMessage).filter(Boolean);
  const selected = [];
  let remaining = 24_000;
  for (const message of recentFirst) {
    if (remaining <= 0 || selected.length >= 24) break;
    const content = message.content.slice(-remaining);
    if (content) {
      selected.push({ ...message, content });
      remaining -= content.length;
    }
  }
  return selected.reverse();
}

async function loadConversationSnapshot(conversationId, userId) {
  const [messagesResult, summaryResult, scratchpadResult, memoriesResult] = await Promise.all([
    db.from("chat_messages")
      .select("role, text, created_at")
      .eq("session_id", conversationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40),
    db.schema("edu").from("learner_agent_conversation_summaries")
      .select("summary")
      .eq("chat_session_id", conversationId)
      .eq("user_id", userId)
      .maybeSingle(),
    db.schema("edu").from("learner_agent_conversation_scratchpads")
      .select("goal, progress_summary, completed, plan, next_steps, open_questions, tool_state")
      .eq("chat_session_id", conversationId)
      .eq("user_id", userId)
      .maybeSingle(),
    db.schema("edu").from("learner_agent_memories")
      .select("id, kind, content, subject, topic")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(8),
  ]);
  if (messagesResult.error || summaryResult.error || scratchpadResult.error || memoriesResult.error) {
    throw new ConversationGatewayError(503, "Conversation context storage is unavailable");
  }
  return {
    messages: boundedConversationMessages(messagesResult.data),
    summary: boundedText(summaryResult.data?.summary, 4_000) || null,
    scratchpad: scratchpadResult.data ? publicScratchpad(scratchpadResult.data) : null,
    memories: (memoriesResult.data || []).map(publicMemory).filter(Boolean),
  };
}

async function recentMemoryFallback(userId) {
  // This is deliberately deterministic and bounded. Retrieval outages must not
  // erase all durable context or make a learner's agent depend on a vector API.
  const [memoriesResult, summaryResult] = await Promise.all([
    db.schema("edu").from("learner_agent_memories")
      .select("id, kind, content, subject, topic, updated_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(6),
    db.schema("edu").from("learner_agent_conversation_summaries")
      .select("chat_session_id, summary, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(2),
  ]);
  if (memoriesResult.error || summaryResult.error) {
    throw new ConversationGatewayError(503, "Learner memory retrieval is unavailable");
  }
  const rows = [
    ...(memoriesResult.data || []).map((row) => ({ ...row, memory_type: "memory" })),
    ...(summaryResult.data || []).map((row) => ({
      id: row.chat_session_id,
      memory_type: "conversation_summary",
      kind: "conversation_summary",
      content: row.summary,
      updated_at: row.updated_at,
    })),
  ].sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));
  return rows.slice(0, 6).map(publicRelevantMemory).filter(Boolean);
}

async function relevantMemory({ query, subject, userId }) {
  // The private Akoro gateway, rather than the Python service, owns provider
  // metering and embedding credentials. A failed or late embedding (at most a
  // few seconds — lib/searchEmbedding.js) still permits the SQL function's
  // lexical branch below.
  const embedding = await embedForSearch(query, { userId, feature: "learner_agent_memory_query" });

  try {
    const { data, error } = await db.rpc("match_learner_agent_memory", {
      p_user_id: userId,
      p_query_embedding: embedding,
      p_match_count: 6,
      p_query_text: query,
      p_subject: subject,
    });
    if (error) throw error;
    const memories = (data || [])
      // A vector-only nearest neighbour can still be unrelated. Lexical hits
      // carry their own exact-term evidence and do not have a cosine floor.
      .filter((row) => row.vector_rank == null || Number(row.similarity ?? 0) >= MIN_MEMORY_SIMILARITY)
      .map(publicRelevantMemory).filter(Boolean).slice(0, 6);
    // Empty is a valid hybrid result. It is better than injecting irrelevant
    // newest notes, so only use recency when the retrieval implementation is
    // actually unavailable.
    return { mode: embedding ? "hybrid" : "lexical", memories };
  } catch (error) {
    console.warn("[agent-tools/conversations] semantic retrieval unavailable:", error?.message || error);
    return { mode: "recency", memories: await recentMemoryFallback(userId) };
  }
}

function memoryEmbeddingText({ content, topic, subject }) {
  return [content, topic, subject].filter(Boolean).join(" ").trim();
}

async function writeEmbedding({ table, filters, userId, updatedAt, text }) {
  if (!text || text.length < 3) return;
  try {
    const embedding = await embedText(text, "learner_agent_memory_write", userId);
    if (!embedding) return;
    let update = db.schema("edu").from(table)
      .update({ embedding, embedded_at: new Date().toISOString() })
      .eq("user_id", userId)
      // Do not stamp a newer summary/note with a vector made for an older one.
      .eq("updated_at", updatedAt);
    for (const [column, value] of Object.entries(filters)) update = update.eq(column, value);
    const { error } = await update;
    if (error) throw error;
  } catch (error) {
    // Persistence has already succeeded. The missing-vector sweeper will retry
    // without making a learner's completed lesson fail when OpenAI is down.
    console.warn(`[agent-tools/conversations] ${table} embedding deferred:`, error?.message || error);
  }
}

async function embedPersistedContext({ request, userId, updatedAt }) {
  const writes = [writeEmbedding({
    table: "learner_agent_conversation_summaries",
    filters: { chat_session_id: request.conversationId },
    userId,
    updatedAt,
    text: request.summary,
  })];
  for (const memory of request.memories) {
    writes.push(writeEmbedding({
      table: "learner_agent_memories",
      filters: {
        chat_session_id: request.conversationId,
        agent_session_id: request.sessionId,
        agent_turn_id: request.turnId,
        kind: memory.kind,
      },
      userId,
      updatedAt,
      text: memoryEmbeddingText(memory),
    }));
  }
  await Promise.all(writes);
}

async function messageForTurn({ conversationId, userId, sessionId, turnId, role, text, createdAt }) {
  const existing = await db.from("chat_messages")
    .select("id, text")
    .eq("session_id", conversationId)
    .eq("user_id", userId)
    .eq("agent_session_id", sessionId)
    .eq("agent_turn_id", turnId)
    .eq("role", role)
    .maybeSingle();
  if (existing.error) throw new ConversationGatewayError(503, "Conversation message lookup is unavailable");
  if (existing.data) {
    if (existing.data.text !== text) {
      throw new ConversationGatewayError(409, "turnId cannot be reused for different conversation content");
    }
    return existing.data;
  }

  const inserted = await db.from("chat_messages")
    .insert({
      session_id: conversationId,
      user_id: userId,
      role,
      text,
      agent_session_id: sessionId,
      agent_turn_id: turnId,
      created_at: createdAt,
    })
    .select("id")
    .single();
  if (!inserted.error && inserted.data) return inserted.data;
  // A concurrent retry can win the unique partial index after the initial
  // read. Re-read instead of creating a second transcript row.
  if (inserted.error?.code === "23505") {
    const retry = await db.from("chat_messages")
      .select("id, text")
      .eq("session_id", conversationId)
      .eq("user_id", userId)
      .eq("agent_session_id", sessionId)
      .eq("agent_turn_id", turnId)
      .eq("role", role)
      .maybeSingle();
    if (!retry.error && retry.data) {
      if (retry.data.text !== text) {
        throw new ConversationGatewayError(409, "turnId cannot be reused for different conversation content");
      }
      return retry.data;
    }
  }
  throw new ConversationGatewayError(503, "Conversation message could not be saved");
}

async function markTurn({ conversationId, userId, sessionId, turnId, patch }) {
  const { data, error } = await db.schema("edu").from("learner_agent_conversation_turns")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("chat_session_id", conversationId)
    .eq("user_id", userId)
    .eq("agent_session_id", sessionId)
    .eq("agent_turn_id", turnId)
    .select("id, status, user_message_id, agent_message_id")
    .maybeSingle();
  if (error || !data) throw new ConversationGatewayError(503, "Conversation turn state could not be saved");
  return data;
}

async function claimTurn({ conversationId, userId, sessionId, turnId }) {
  const table = db.schema("edu").from("learner_agent_conversation_turns");
  const current = await table.select("id, status, user_message_id, agent_message_id")
    .eq("chat_session_id", conversationId)
    .eq("user_id", userId)
    .eq("agent_session_id", sessionId)
    .eq("agent_turn_id", turnId)
    .maybeSingle();
  if (current.error) throw new ConversationGatewayError(503, "Conversation turn state is unavailable");
  if (current.data?.status === "completed") return { ...current.data, replayed: true };
  if (current.data) {
    // A stopped deployment can leave a recoverable writing/failed row. The
    // message-level unique key makes resuming this exact idempotent turn safe.
    const resumed = await markTurn({
      conversationId, userId, sessionId, turnId,
      patch: { status: "writing", error_code: null },
    });
    return { ...resumed, replayed: false };
  }
  const created = await table.insert({
    chat_session_id: conversationId,
    user_id: userId,
    agent_session_id: sessionId,
    agent_turn_id: turnId,
    status: "writing",
  }).select("id, status, user_message_id, agent_message_id").single();
  if (!created.error && created.data) return { ...created.data, replayed: false };
  if (created.error?.code === "23505") return claimTurn({ conversationId, userId, sessionId, turnId });
  throw new ConversationGatewayError(503, "Conversation turn could not be claimed");
}

async function persistTurn({ request, userId }) {
  const turn = await claimTurn({
    conversationId: request.conversationId,
    userId,
    sessionId: request.sessionId,
    turnId: request.turnId,
  });
  if (turn.replayed) {
    return {
      saved: true,
      replayed: true,
      userMessageId: turn.user_message_id,
      assistantMessageId: turn.agent_message_id,
    };
  }

  try {
    const now = new Date();
    const contextUpdatedAt = now.toISOString();
    const userMessage = await messageForTurn({
      conversationId: request.conversationId, userId, sessionId: request.sessionId, turnId: request.turnId,
      role: "user", text: request.userMessage, createdAt: now.toISOString(),
    });
    // The 1ms offset preserves deterministic chronological role ordering when
    // Postgres timestamps are otherwise identical.
    const assistantMessage = await messageForTurn({
      conversationId: request.conversationId, userId, sessionId: request.sessionId, turnId: request.turnId,
      role: "agent", text: request.assistantMessage, createdAt: new Date(now.getTime() + 1).toISOString(),
    });
    const countResult = await db.from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("session_id", request.conversationId)
      .eq("user_id", userId);
    if (countResult.error) throw new ConversationGatewayError(503, "Conversation message count is unavailable");
    const [summaryResult, scratchpadResult, memoryResult, sessionResult] = await Promise.all([
      db.schema("edu").from("learner_agent_conversation_summaries").upsert({
        chat_session_id: request.conversationId,
        user_id: userId,
        summary: request.summary,
        source_message_count: Number(countResult.count || 0),
        // A summary is rewritten on every completed turn. Queue a fresh vector
        // rather than leaving a semantically stale representation behind.
        embedding: null,
        embedded_at: null,
        updated_at: contextUpdatedAt,
      }, { onConflict: "chat_session_id" }),
      db.schema("edu").from("learner_agent_conversation_scratchpads").upsert({
        chat_session_id: request.conversationId,
        user_id: userId,
        goal: request.scratchpad.goal,
        progress_summary: request.scratchpad.progressSummary,
        completed: request.scratchpad.completed,
        plan: request.scratchpad.plan,
        next_steps: request.scratchpad.nextSteps,
        open_questions: request.scratchpad.openQuestions,
        tool_state: request.scratchpad.toolState,
        updated_at: new Date().toISOString(),
      }, { onConflict: "chat_session_id" }),
      request.memories.length
        ? db.schema("edu").from("learner_agent_memories").upsert(request.memories.map((memory) => ({
          user_id: userId,
          chat_session_id: request.conversationId,
          agent_session_id: request.sessionId,
          agent_turn_id: request.turnId,
          ...memory,
          status: "active",
          // Retried writes are idempotent; marking this null makes both new
          // and amended notes eligible for the central embedding repairer.
          embedding: null,
          embedded_at: null,
          updated_at: contextUpdatedAt,
        })), { onConflict: "chat_session_id,agent_session_id,agent_turn_id,kind" })
        : Promise.resolve({ error: null }),
      db.from("chat_sessions").update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", request.conversationId).eq("user_id", userId),
    ]);
    if (summaryResult.error || scratchpadResult.error || memoryResult.error || sessionResult.error) {
      throw new ConversationGatewayError(503, "Conversation context could not be completed");
    }
    // Embeddings are best-effort and never change durable-turn success. Failed
    // writes retain embedded_at=null for the central sweeper to repair.
    await embedPersistedContext({ request, userId, updatedAt: contextUpdatedAt });
    await markTurn({
      conversationId: request.conversationId, userId, sessionId: request.sessionId, turnId: request.turnId,
      patch: {
        status: "completed",
        error_code: null,
        user_message_id: userMessage.id,
        agent_message_id: assistantMessage.id,
        completed_at: new Date().toISOString(),
      },
    });
    return { saved: true, replayed: false, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id };
  } catch (error) {
    try {
      await markTurn({
        conversationId: request.conversationId, userId, sessionId: request.sessionId, turnId: request.turnId,
        patch: { status: "failed", error_code: "persistence_failed" },
      });
    } catch (markError) {
      console.error("[agent-tools/conversations mark failed]", markError.message);
    }
    throw error;
  }
}

// These exported operations are used by the authenticated first-party Agent
// endpoint as well as the private Python gateway below. They deliberately take
// a server-derived `userId`; browser input cannot select another learner or
// bypass ownership checks.
export async function loadLearnerAgentConversationContext({ conversationId, userId }) {
  const conversation = await ownedConversation(conversationId, userId);
  const snapshot = await loadConversationSnapshot(conversation.id, userId);
  return {
    conversationId: conversation.id,
    title: boundedText(conversation.title, 180) || null,
    ...snapshot,
  };
}

export async function retrieveLearnerAgentMemory({ query, subject = null, userId }) {
  return relevantMemory({ query: boundedText(query, 4_000), subject: boundedText(subject, 180) || null, userId });
}

export async function completedLearnerAgentConversationTurn({ conversationId, userId, sessionId, turnId }) {
  if (!CONVERSATION_ID.test(conversationId) || !AGENT_ID.test(sessionId) || !TURN_ID.test(turnId)) return null;
  const { data: turn, error } = await db.schema("edu").from("learner_agent_conversation_turns")
    .select("agent_message_id")
    .eq("chat_session_id", conversationId)
    .eq("user_id", userId)
    .eq("agent_session_id", sessionId)
    .eq("agent_turn_id", turnId)
    .eq("status", "completed")
    .maybeSingle();
  if (error) throw new ConversationGatewayError(503, "Conversation turn state is unavailable");
  if (!turn?.agent_message_id) return null;
  const { data: message, error: messageError } = await db.from("chat_messages")
    .select("text")
    .eq("id", turn.agent_message_id)
    .eq("session_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (messageError) throw new ConversationGatewayError(503, "Conversation reply is unavailable");
  return boundedText(message?.text, 12_000) || null;
}

export async function persistLearnerAgentConversationTurn({
  conversationId, userId, sessionId, turnId, userMessage, assistantMessage,
  summary, scratchpad, memories = [],
}) {
  const request = {
    conversationId,
    sessionId: boundedText(sessionId, 180),
    turnId: boundedText(turnId, 180),
    userMessage: boundedText(userMessage, 12_000),
    assistantMessage: boundedText(assistantMessage, 12_000),
    summary: boundedText(summary, 4_000),
    scratchpad: normaliseScratchpad(scratchpad),
    memories: Array.isArray(memories) ? memories.slice(0, 4).map((memory) => ({
      kind: memory?.kind,
      content: boundedText(memory?.content, 1_500),
      topic: boundedText(memory?.topic, 180) || null,
      subject: boundedText(memory?.subject, 180) || null,
    })).filter((memory) => MEMORY_KINDS.has(memory.kind) && memory.content) : [],
  };
  if (!CONVERSATION_ID.test(request.conversationId) || !AGENT_ID.test(request.sessionId)
      || !TURN_ID.test(request.turnId) || !request.userMessage || !request.assistantMessage || !request.summary) {
    throw new ConversationGatewayError(422, "Agent conversation turn is invalid");
  }
  return persistTurn({ request, userId });
}

router.post("/context", requireAgentToolsCredential, async (req, res) => {
  try {
    const request = authorisedRequest(req);
    const principal = await activePrincipal(request.claims);
    const conversation = await ownedConversation(request.conversationId, principal.id);
    const snapshot = await loadConversationSnapshot(conversation.id, principal.id);
    return res.json({
      success: true,
      conversation: {
        conversationId: conversation.id,
        title: boundedText(conversation.title, 180) || null,
        ...snapshot,
      },
    });
  } catch (error) {
    return gatewayError(res, error);
  }
});

router.post("/relevant-memory", requireAgentToolsCredential, async (req, res) => {
  try {
    let request;
    try {
      request = memoryRetrievalRequest(req.body || {});
    } catch (error) {
      throw new ConversationGatewayError(422, error.message);
    }
    const claims = verifyAgentToolsCapability(request.toolContext, request.sessionId);
    if (!claims || claims.scope !== "student") {
      throw new ConversationGatewayError(403, "A valid learner conversation context is required");
    }
    const principal = await activePrincipal(claims);
    // The supplied conversation ID is still ownership-checked even though
    // retrieval can return relevant notes from the learner's other sessions.
    await ownedConversation(request.conversationId, principal.id);
    const result = await relevantMemory({ ...request, userId: principal.id });
    return res.json({ success: true, retrieval: result.mode, memories: result.memories });
  } catch (error) {
    return gatewayError(res, error);
  }
});

router.post("/turns", requireAgentToolsCredential, async (req, res) => {
  try {
    let request;
    try {
      request = persistenceRequest(req.body || {});
    } catch (error) {
      throw new ConversationGatewayError(422, error.message);
    }
    const claims = verifyAgentToolsCapability(request.toolContext, request.sessionId);
    if (!claims || claims.scope !== "student") {
      throw new ConversationGatewayError(403, "A valid learner conversation context is required");
    }
    const principal = await activePrincipal(claims);
    await ownedConversation(request.conversationId, principal.id);
    return res.json({ success: true, persistence: await persistTurn({ request, userId: principal.id }) });
  } catch (error) {
    return gatewayError(res, error);
  }
});

export default router;
