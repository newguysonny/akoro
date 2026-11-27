// Knowledge-domain socket events: decay health, subject topics, alert
// acknowledgement, state snapshots, and agent growth.

import { getStudentState } from "../../learner-state/index.js";
import {
  getOrCreateStudentAgent, getTopicsBySubject,
} from "../agents/student/knowledge.js";
import { decayEngine } from "../agents/student/decayEngine.js";
import { activeSessions } from "./sessions.js";

export function registerKnowledgeHandlers(socket) {
  // ── get_knowledge_health ──────────────────────────────────
  socket.on("get_knowledge_health", async ({ studentId }) => {
    try {
      const agent     = await getOrCreateStudentAgent(studentId);
      const dashboard = await decayEngine.getKnowledgeDashboard(studentId, agent.id);
      socket.emit("knowledge_health_data", { dashboard, agentId: agent.id });
    } catch (err) { socket.emit("error", { message: err.message }); }
  });

  // ── get_subject_topics ────────────────────────────────────
  socket.on("get_subject_topics", async ({ studentId, subject }) => {
    try {
      const agent  = await getOrCreateStudentAgent(studentId);
      const topics = await getTopicsBySubject(agent.id, subject);
      socket.emit("subject_topics_data", { subject, topics, agentId: agent.id });
    } catch (err) { socket.emit("error", { message: err.message }); }
  });

  // ── acknowledge_alert ─────────────────────────────────────
  socket.on("acknowledge_alert", async ({ notificationId }) => {
    try {
      const acknowledged = await decayEngine.markNotificationRead(notificationId, socket.data.user.id);
      socket.emit("alert_acknowledged", { notificationId, acknowledged });
    } catch (err) { socket.emit("error", { message: err.message }); }
  });

  // ── get_state ─────────────────────────────────────────────
  socket.on("get_state", async () => {
    const { sessionId } = socket.data;
    const orchestrator  = activeSessions.get(sessionId);
    if (!orchestrator) {
      if (socket.data.sessionEnded) return;   // a completed session has no state to pull — not an error
      return socket.emit("error", { message: "No active session." });
    }
    try {
      const agentId = orchestrator.session?.agentId || orchestrator.studentId;
      const state   = await getStudentState(agentId);
      socket.emit("state_snapshot", { state });
    } catch (err) { socket.emit("error", { message: err.message }); }
  });

  // ── get_agent_growth ──────────────────────────────────────
  socket.on("get_agent_growth", async ({ studentId }) => {
    try {
      const { getAgentGrowthHistory } = await import("../agents/student/knowledge.js");
      const agent   = await getOrCreateStudentAgent(studentId);
      const history = await getAgentGrowthHistory(agent.id, 20);
      socket.emit("agent_growth_data", { agent, history });
    } catch (err) { socket.emit("error", { message: err.message }); }
  });
}
