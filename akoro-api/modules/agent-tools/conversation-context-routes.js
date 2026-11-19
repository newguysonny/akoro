/**
 * Private durable-context gateway for the additive Python agent service.
 *
 * The existing public `/api/adaptive/chat/sessions` routes remain the learner's
 * history UI. This router lets only the deployed Python service read a bounded
 * owned snapshot and write one completed user/assistant turn with a
 * capability-bound idempotency key. It is not browser-facing.
 *
 * Storage lives in lib/conversationContextStore.js; this file owns the HTTP
 * surface and its capability checks.
 */
import { Router } from "express";

import db from "../../db.js";
import {
  ConversationGatewayError,
  loadConversationSnapshot,
  ownedConversation,
  persistTurn,
  relevantMemory,
} from "../../lib/conversationContextStore.js";
import {
  boundedText,
  conversationRequest,
  memoryRetrievalRequest,
  persistenceRequest,
} from "../../lib/conversationContextValidation.js";
import {
  requireAgentToolsCredential,
  verifyAgentToolsCapability,
} from "./capability.js";

// Keep the established module entry surface: the authenticated first-party
// Agent endpoint and the verification scenarios import these from here.
export {
  boundedConversationMessages,
  completedLearnerAgentConversationTurn,
  loadLearnerAgentConversationContext,
  persistLearnerAgentConversationTurn,
  persistLearnerAgentUserTurnMessage,
  retrieveLearnerAgentMemory,
  savedTurnReplyId,
} from "../../lib/conversationContextStore.js";

const router = Router();

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
