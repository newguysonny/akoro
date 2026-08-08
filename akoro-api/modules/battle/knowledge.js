// modules/battle/knowledge.js
//
// What a battle answer does to the learner's knowledge model.
//
// Lifted out of routes.js because the WORKER now needs it: agents answer
// battles, so the write that used to happen in the HTTP answer handler has to
// happen where the agent answers. Importing the router from the worker to get
// at it would couple the queue to the whole HTTP surface, and this codebase has
// already paid for one circular import (security → auth → security).
//
// This closes a loop rather than being a side effect: agentPlayer reads the
// same per-topic confidence to decide how likely an agent is to be right. If
// nothing wrote to it, every agent would be frozen at whatever its owner knew
// the day it shipped, and no battle would teach anyone anything.

import db from "../../db.js";

const now = () => new Date().toISOString();

/**
 * updateKnowledgeConfidence
 * Called after every battle answer submission.
 *
 * Correct answer  → confidence += 0.05 (capped at 1.0)
 * Wrong answer    → confidence -= 0.05 (floored at 0.0)
 * Topic unknown   → INSERT with confidence = -0.10 (negative = flagged for review)
 *
 * Updates edu.student_knowledge and edu.agent_knowledge in the edu schema.
 * Both tables have a 'confidence' column added in MIGRATIONS_v31.sql.
 */
export async function updateKnowledgeConfidence(userId, topic, subject, isCorrect) {
  if (!topic) return;

  try {
    // Get student's agent
    const { data: agent } = await db
      .schema("edu").from("student_agents")
      .select("id").eq("student_id", userId).single();
    if (!agent) return;

    const delta = isCorrect ? 0.05 : -0.05;

    // Try to update existing student_knowledge record
    const { data: existing } = await db
      .schema("edu").from("student_knowledge")
      .select("id, confidence, topic")
      .eq("agent_id", agent.id).eq("topic", topic).single();

    if (existing) {
      // Update confidence — clamp between 0.0 and 1.0
      const newConf = Math.min(1.0, Math.max(0.0, (existing.confidence ?? 0.5) + delta));
      await db.schema("edu").from("student_knowledge").update({
        confidence:      newConf,
        updated_at:      now(),
        next_review_due: isCorrect
          ? new Date(Date.now() + 7  * 86_400_000).toISOString()   // correct → review in 7 days
          : new Date(Date.now() + 1  * 86_400_000).toISOString(),  // wrong   → review in 1 day
      }).eq("id", existing.id);
    } else {
      // Topic not in student's knowledge base — insert with negative confidence
      // Negative score = "encountered but struggled" — triggers review priority
      const initialConf = isCorrect ? 0.40 : -0.10;
      await db.schema("edu").from("student_knowledge").insert({
        agent_id:        agent.id,
        topic,
        subject:         subject ?? null,
        confidence:      initialConf,
        decay_rate:      0.10,
        next_review_due: new Date(Date.now() + (isCorrect ? 7 : 1) * 86_400_000).toISOString(),
        priority:        isCorrect ? "low" : "critical",
      });

      if (!isCorrect) {
        // Log a decay event so the student gets a review notification
        try {
          await db.schema("edu").from("decay_notifications").insert({
            student_id: userId,
            agent_id:   agent.id,
            subject:    subject ?? "General",
            topic,
            confidence: initialConf,
            priority:   "critical",
            message:    `You got a question on "${topic}" wrong in a battle — let's review it!`,
          });
        } catch {}
      }
    }
  } catch (e) {
    // Non-fatal — battle continues even if knowledge update fails
    console.warn("[battle] Knowledge confidence update failed:", e.message);
  }
}
