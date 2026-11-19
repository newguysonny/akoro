/** Learner-facing controls for compact Python-agent study memory. */
import { Router } from "express";

import db from "../../db.js";
import { authenticateToken } from "../auth/routes.js";
import { CONVERSATION_ID, publicMemory } from "../../lib/conversationContextValidation.js";

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

/* "Learn from my conversations" (Grand Plan §7.16.6, D47): on by default with
   the agent Online; off pauses quiet learning — what is already remembered
   stays until the learner forgets it. */
router.get("/settings", authenticateToken, async (req, res) => {
  try {
    const { data, error } = await db.schema("edu").from("learner_agent_autonomy")
      .select("enabled, learn_from_chats").eq("user_id", req.user.id).maybeSingle();
    if (error) throw error;
    return res.json({ success: true, learnFromChats: data?.learn_from_chats !== false, agentOnline: Boolean(data?.enabled) });
  } catch (error) {
    console.error("[agent-memory/settings GET]", error.message);
    return res.status(503).json({ success: false, error: "Agent memory settings are unavailable" });
  }
});

router.patch("/settings", authenticateToken, async (req, res) => {
  if (typeof req.body?.learnFromChats !== "boolean") {
    return res.status(422).json({ success: false, error: "learnFromChats must be a boolean" });
  }
  try {
    const { data: row } = await db.schema("edu").from("learner_agent_autonomy").select("user_id").eq("user_id", req.user.id).maybeSingle();
    const write = row
      ? db.schema("edu").from("learner_agent_autonomy").update({ learn_from_chats: req.body.learnFromChats, updated_at: new Date().toISOString() }).eq("user_id", req.user.id)
      : db.schema("edu").from("learner_agent_autonomy").insert({ user_id: req.user.id, enabled: false, learn_from_chats: req.body.learnFromChats });
    const { error } = await write;
    if (error) throw error;
    return res.json({ success: true, learnFromChats: req.body.learnFromChats });
  } catch (error) {
    console.error("[agent-memory/settings PATCH]", error.message);
    return res.status(503).json({ success: false, error: "Could not save the memory setting" });
  }
});

/* Forget everything the agent remembers about the learner (summaries stay with their chats). */
router.delete("/memories", authenticateToken, async (req, res) => {
  try {
    const { data, error } = await db.schema("edu").from("learner_agent_memories")
      .update({ status: "forgotten", updated_at: new Date().toISOString() })
      .eq("user_id", req.user.id).eq("status", "active").select("id");
    if (error) throw error;
    return res.json({ success: true, forgotten: (data || []).length });
  } catch (error) {
    console.error("[agent-memory/memories DELETE all]", error.message);
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

// Scratchpad is working state, not the immutable chat record. A learner can
// clear it independently and the next completed Python turn will create a new,
// concise checklist from the current conversation.
router.delete("/conversations/:conversationId/scratchpad", authenticateToken, async (req, res) => {
  if (!CONVERSATION_ID.test(req.params.conversationId)) {
    return res.status(422).json({ success: false, error: "conversationId is invalid" });
  }
  try {
    const { data, error } = await db.schema("edu").from("learner_agent_conversation_scratchpads")
      .delete()
      .eq("chat_session_id", req.params.conversationId)
      .eq("user_id", req.user.id)
      .select("chat_session_id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: "Conversation scratchpad was not found" });
    return res.json({ success: true, clearedConversationId: data.chat_session_id });
  } catch (error) {
    console.error("[agent-memory/scratchpad DELETE]", error.message);
    return res.status(503).json({ success: false, error: "Agent scratchpad is unavailable" });
  }
});

export default router;
