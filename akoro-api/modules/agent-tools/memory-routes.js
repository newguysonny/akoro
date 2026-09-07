/** Learner-facing controls for compact Python-agent study memory. */
import { Router } from "express";

import db from "../../db.js";
import { authenticateToken } from "../auth/routes.js";
import { CONVERSATION_ID, publicMemory } from "./conversation-context-validation.js";

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get("/memories", authenticateToken, async (req, res) => {
  try {
    const { data, error } = await db.schema("edu").from("learner_agent_memories")
      .select("id, kind, content, subject, topic, created_at, updated_at")
      .eq("user_id", req.user.id)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return res.json({
      success: true,
      memories: (data || []).map((row) => ({ ...publicMemory(row), createdAt: row.created_at, updatedAt: row.updated_at })),
    });
  } catch (error) {
    console.error("[agent-memory/memories GET]", error.message);
    return res.status(503).json({ success: false, error: "Agent memory is unavailable" });
  }
});

router.delete("/memories/:memoryId", authenticateToken, async (req, res) => {
  if (!UUID.test(req.params.memoryId)) {
    return res.status(422).json({ success: false, error: "memoryId is invalid" });
  }
  try {
    const { data, error } = await db.schema("edu").from("learner_agent_memories")
      .update({ status: "forgotten", updated_at: new Date().toISOString() })
      .eq("id", req.params.memoryId)
      .eq("user_id", req.user.id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: "Memory note was not found" });
    return res.json({ success: true, forgottenMemoryId: data.id });
  } catch (error) {
    console.error("[agent-memory/memories DELETE]", error.message);
    return res.status(503).json({ success: false, error: "Agent memory is unavailable" });
  }
});

// A learner may clear the compact carry-over summary without deleting the full
// chat transcript. Deleting the existing chat session still cascades both.
router.delete("/conversations/:conversationId/summary", authenticateToken, async (req, res) => {
  if (!CONVERSATION_ID.test(req.params.conversationId)) {
    return res.status(422).json({ success: false, error: "conversationId is invalid" });
  }
  try {
    const { data, error } = await db.schema("edu").from("learner_agent_conversation_summaries")
      .delete()
      .eq("chat_session_id", req.params.conversationId)
      .eq("user_id", req.user.id)
      .select("chat_session_id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: "Conversation summary was not found" });
    return res.json({ success: true, clearedConversationId: data.chat_session_id });
  } catch (error) {
    console.error("[agent-memory/summary DELETE]", error.message);
    return res.status(503).json({ success: false, error: "Agent memory is unavailable" });
  }
});

export default router;
