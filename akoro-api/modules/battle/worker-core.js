/**
 * battle/worker-core.js — machinery shared by the battle worker's job modules:
 * the queue registry (worker.js owns the one Queue), the battle log and XP
 * writes, and the state that must stay single per process.
 */
import db from "../../db.js";
import { getIO } from "./worker-rules.js";

// The queue is constructed once, in worker.js, at import time. Job modules read
// it here instead of importing worker.js, which would close an import cycle.
let queue = null;
export function setBattleWorkerQueue(q) { queue = q; return q; }
export function getBattleWorkerQueue() {
  if (!queue) throw new Error("battle worker queue used before it was constructed");
  return queue;
}

// Agents already told they are out of coins this battle (one log line each, not
// one per question).
export const toldNoCoins = new Set();
// Each question's embedding, computed once when it goes out and reused by every
// agent's answer job (the platform pays for it — once, not once per agent).
const questionVectors = new Map();
export const rememberVector = (qid, v) => {
  if (!qid || !v) return;
  questionVectors.set(qid, v);
  if (questionVectors.size > 500) questionVectors.delete(questionVectors.keys().next().value);
};
export const questionVector = (qid) => questionVectors.get(qid);

export async function appendLog(battleId, eventType, message, userId = null, agentName = null, agentEmoji = null, questionOrder = null, meta = null) {
  await db.from("battle_log").insert({
    battle_id: battleId, question_order: questionOrder, event_type: eventType,
    user_id: userId, agent_name: agentName, agent_emoji: agentEmoji,
    message, meta_json: meta ? JSON.stringify(meta) : null,
  });
  getIO().to(`battle:${battleId}`).emit("battle:log", {
    eventType, agentName, agentEmoji, message, meta: meta ?? null,
    timestamp: new Date().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  });
}

export async function creditXP(userId, agentId, amount, source, referenceId) {
  const { data: current } = await db.from("user_agents").select("total_xp").eq("id", agentId).single();
  const newTotal = (current?.total_xp ?? 0) + amount;
  await db.from("user_agents").update({ total_xp: newTotal }).eq("id", agentId);
  await db.from("xp_ledger").insert({ user_id: userId, agent_id: agentId, amount, source, reference_id: referenceId, running_total: newTotal });
}
