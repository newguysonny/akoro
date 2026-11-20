// Teaching-domain socket event: switch the guide inside a live session.

import { getOrchestrator } from "../agents/registry.js";
import { userOwnsAgent } from "../../learner-state/index.js";
import { serialiseTeachingEvidence } from "../learner/teaching-evidence.js";
import { activeSessions } from "./sessions.js";

export function registerTeachingSwitchHandlers(socket) {
  // ── switch_agent_pair ─────────────────────────────────────
  // v3.2: verifies ownership, then rebuilds the live session with the new
  // teacher guide — same student + topic, same sessionId (socket room intact).
  // The student agent's learned state is keyed by studentId, so its knowledge
  // carries over; only the guiding teacher changes.
  socket.on("switch_agent_pair", async ({ newAgentPairId, topic: topicArg, userId }) => {
    try {
      const data      = socket.data || {};
      const sessionId = data.sessionId;
      const studentId = data.agentId;
      const subject   = data.subject;
      const topic     = topicArg || data.topic;
      const caller    = userId || data.userId || studentId;

      if (!sessionId || !studentId)
        return socket.emit("error", { message: "No active session to switch." });
      if (!newAgentPairId)
        return socket.emit("error", { message: "newAgentPairId required" });
      if (!topic)
        return socket.emit("error", { message: "Session topic unavailable for switch." });

      // Resolve the teacher agent the new pair maps to (null = platform default)
      let teacherAgentId = null;
      if (!["nana-esumai", "nana-sargeant"].includes(newAgentPairId) && !newAgentPairId.startsWith("trained:")) {
        return socket.emit("error", { message: "Unknown teaching guide.", code: "UNKNOWN_GUIDE", agentPairId: newAgentPairId });
      }
      if (newAgentPairId.startsWith("trained:")) {
        teacherAgentId = newAgentPairId.replace("trained:", "");
        const owns = await userOwnsAgent(caller, teacherAgentId);
        if (!owns) {
          return socket.emit("error", {
            message: "You do not own this agent. Purchase it from the marketplace first.",
            code:    "NOT_PURCHASED",
            agentPairId: newAgentPairId,
          });
        }
      }

      socket.emit("agent_pair_switching", { newAgentPairId });

      // Rebuild the orchestrator with the new teacher; reuse student + topic
      const priorOrchestrator = activeSessions.get(sessionId);
      // Only the guide changes (D42): the session keeps its type, subject,
      // decay material, conversation, phase and evidence. (A switch used to
      // rebuild it as a fresh free-teaching session.)
      const orchestrator = await getOrchestrator({
        mode:     "student",
        studentId,
        userId:   caller,
        teacherAgentId,
        sessionType:  priorOrchestrator?.sessionType || "free_teaching",
        subject:      priorOrchestrator?.subject || subject || null,
        decayPayload: priorOrchestrator?.decayPayload || null,
        referenceMaterial: priorOrchestrator?.referenceMaterial || null,
        teachingEvidence: serialiseTeachingEvidence(priorOrchestrator?.teachingEvidence),
      });
      // The document stays with the session across a guide switch.
      orchestrator.documentTargetPromise = priorOrchestrator?.documentTargetPromise || null;
      if (priorOrchestrator?.session) {
        orchestrator.resumeFrom = {
          subtopicIdx: priorOrchestrator.session.mustKnowIndex || 0,
          phase: priorOrchestrator.session.phase || "PHASE_1",
        };
        orchestrator.dbSessionId = priorOrchestrator.dbSessionId || null;
        orchestrator.sessionMeta = priorOrchestrator.sessionMeta || null;
      }
      const init = await orchestrator.initialize(studentId, topic);
      // The live conversation carries over too (initialize() starts it empty).
      if (priorOrchestrator?.session?.history?.length && orchestrator.session) {
        orchestrator.session.history = priorOrchestrator.session.history;
      }

      // Swap in place under the same sessionId so the socket room stays valid
      activeSessions.set(sessionId, orchestrator);
      socket.data = { ...socket.data, agentPairId: newAgentPairId, teacherAgentId };

      socket.emit("agent_pair_switched", {
        sessionId,
        agentPairId:      newAgentPairId,
        topic,            subject,
        message:          init.openingPrompt,
        mustKnowParts:    init.mustKnowParts,
        agentLevel:       init.agentLevel,
        knowledgeScore:   init.knowledgeScore,
        initialState:     init.initialState,
        studentAgentName: init.studentAgentName,
        // The client appends this one server-shaped guide message after its
        // switch divider; it must not manufacture a phase or learning state.
        guideOpeningBlock: init.openingBlocks?.find((block) => block.type === "guide" || block.type === "guide-ideas") || null,
        guideProfile: {
          name:        orchestrator.guideOrchestrator?.guide?.name  || "NaNa Esumai",
          emoji:       orchestrator.guideOrchestrator?.guide?.emoji || "🧠",
          renderStyle: orchestrator.guideOrchestrator?.guide?.renderStyle || null,
          ttsVoice:    orchestrator.guideOrchestrator?.guide?.renderStyle?.ttsVoice || "alloy",
        },
      });
    } catch (err) {
      console.error("[switch_agent_pair]", err);
      socket.emit("error", { message: err.message });
    }
  });
}
