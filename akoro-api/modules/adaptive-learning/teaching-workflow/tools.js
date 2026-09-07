/**
 * Server-only tools used by the fixed adaptive-teaching turn workflow.
 *
 * These are procedural capabilities, not model-advertised function tools. Each
 * tool has one bounded responsibility and shares one private in-memory context;
 * only the runner's public step labels may cross the WebSocket boundary.
 */
import { getStudentState, updateStudentState } from "../student-state.js";
import {
  applyTeachingObservation,
  capProtegeAnalysis,
  createTeachingEvidenceState,
} from "../teaching-evidence.js";
import { TEACHING_TURN_TOOL_CATALOG } from "./catalog.js";

export { TEACHING_TURN_TOOL_CATALOG };

function activeConcept(context) {
  return context.mustKnowParts[context.mustKnowIndex] || context.topic;
}

function teachingContext(orchestrator) {
  return orchestrator.getTeachingEvidenceSnapshot?.() || null;
}

/**
 * Tool implementations are created per invocation so no turn's messages or
 * state can leak into another authenticated session.
 */
export function createTeachingTurnTools() {
  return Object.freeze({
    load_session_state: {
      async execute(context) {
        context.state = await getStudentState(context.agentId);
      },
    },

    observe_teaching_evidence: {
      async execute(context) {
        const { orchestrator } = context;
        if (!orchestrator.teachingEvidence) {
          orchestrator.teachingEvidence = createTeachingEvidenceState({
            conceptCount: context.mustKnowParts.length || 1,
          });
          orchestrator.session.teachingEvidence = orchestrator.teachingEvidence;
        }

        let observation;
        try {
          observation = await orchestrator.studentAgent.assessTeachingEvidence({
            humanMessage: context.humanMessage,
            topic: context.topic,
            currentSubtopic: activeConcept(context),
            history: context.history,
          });
        } catch (error) {
          // An unavailable evaluator is no evidence—not weak evidence—and must
          // leave support/pacing and advancement safely unchanged.
          console.warn("[teaching-workflow/evidence] evaluator unavailable:", error.message);
          observation = { notChecked: true };
        }

        context.evidenceUpdate = applyTeachingObservation(
          orchestrator.teachingEvidence,
          context.mustKnowIndex,
          observation,
        );
        orchestrator.teachingEvidence = context.evidenceUpdate.state;
        orchestrator.session.teachingEvidence = orchestrator.teachingEvidence;
      },
    },

    generate_protege_discussion: {
      async execute(context) {
        const { orchestrator, evidenceUpdate } = context;
        context.studentReply = await orchestrator.studentAgent.reply(
          context.humanMessage,
          context.topic,
          context.state.cognitive,
          context.history,
          context.phaseLabels[context.phase],
          context.callbacks.onStudentChunk || null,
          {
            dialogue: evidenceUpdate.dialogue,
            evidence: evidenceUpdate.current,
          },
        );
      },
    },

    assess_protege_understanding: {
      async execute(context) {
        const agentAnalysis = await context.orchestrator.studentAgent.analyzeUnderstanding(
          context.studentReply,
          context.topic,
          context.history,
        );
        // A fluent synthetic reply remains subordinate to independently
        // observed learner teaching evidence.
        context.analysis = capProtegeAnalysis(agentAnalysis, context.evidenceUpdate.current);
      },
    },

    persist_cognitive_state: {
      async execute(context) {
        const { orchestrator } = context;
        context.updatedState = await updateStudentState(
          context.agentId,
          context.topic,
          context.analysis,
          { phase: context.phase, mustKnowIndex: context.mustKnowIndex, lastAction: null },
        );
        context.callbacks.onStateUpdate?.({
          understanding: Math.round(context.updatedState.cognitive.understanding * 100),
          confusion: Math.round(context.updatedState.cognitive.confusion * 100),
          engagement: Math.round(context.updatedState.cognitive.engagement * 100),
        });
      },
    },

    record_verified_learning: {
      async execute(context) {
        const { orchestrator, evidenceUpdate, analysis } = context;
        const extracted = await orchestrator.studentAgent.extractKnowledgeFromTurn(
          context.humanMessage,
          context.studentReply,
          context.topic,
          context.subject,
          analysis,
          evidenceUpdate.current,
        );
        if (extracted) orchestrator.stats.agentKnowledgeAdded++;

        await orchestrator.studentAgent.extractStudentKnowledge(
          context.humanMessage,
          context.topic,
          context.subject,
          analysis,
          evidenceUpdate.current,
        );
        orchestrator.stats.studentKnowledgeRefs = orchestrator.studentAgent.studentKnowledgeRefs;
        orchestrator.stats.teacherChunksUsed = orchestrator.studentAgent.teacherChunksUsed;

        if (evidenceUpdate.current.masteryStatus === "verified" && analysis.newConceptLearned) {
          orchestrator.stats.conceptsLearned.push(analysis.newConceptLearned);
        }
        if (evidenceUpdate.misconceptionRepaired) {
          orchestrator.stats.misconceptionsCleared.push(activeConcept(context));
        }
      },
    },

    coach_teaching_dialogue: {
      async execute(context) {
        const { orchestrator, evidenceUpdate, updatedState } = context;
        context.guideResult = orchestrator.guideOrchestrator.guide?.getTip
          ? await orchestrator.guideOrchestrator.guide.getTip(
              {
                topic: context.topic,
                phase: context.phaseLabels[context.phase],
                currentSubtopic: activeConcept(context),
                humanMessage: context.humanMessage,
                studentResponse: context.studentReply,
                understanding: Math.round(updatedState.cognitive.understanding * 100),
                confusion: Math.round(updatedState.cognitive.confusion * 100),
                history: context.history,
                mustKnowParts: context.mustKnowParts,
                mustKnowIndex: context.mustKnowIndex,
                teachingEvidence: teachingContext(orchestrator),
                dialogue: evidenceUpdate.dialogue,
              },
              context.callbacks.onGuideChunk || null,
            )
          : {
              tip: null,
              nextAction: "DIG_DEEPER",
              nextPhase: null,
              nextMustKnowIndex: context.mustKnowIndex,
              isUrgent: false,
            };
      },
    },

    gate_teaching_progress: {
      async execute(context) {
        const { orchestrator, evidenceUpdate } = context;
        let guideResult = context.guideResult || {};
        context.phaseChanged = false;
        context.phaseLabel = null;
        context.subtopicAdvanced = false;

        // This is deliberately deterministic. Neither the browser nor NaNa's
        // generated recommendation can bypass a missing teaching-evidence gate.
        const hasNextSubtopic = context.mustKnowIndex < Math.max(0, context.mustKnowParts.length - 1);
        const mayAdvance = evidenceUpdate.dialogue.canAdvance;
        const requestedPhase = Object.hasOwn(context.phaseLabels, guideResult.nextPhase)
          ? guideResult.nextPhase
          : null;

        if (mayAdvance && hasNextSubtopic) {
          orchestrator.session.mustKnowIndex = context.mustKnowIndex + 1;
          context.subtopicAdvanced = true;
          guideResult = {
            ...guideResult,
            nextAction: "NEXT_SUBTOPIC",
            nextMustKnowIndex: orchestrator.session.mustKnowIndex,
          };
        } else {
          guideResult = {
            ...guideResult,
            nextAction: context.actionForDialogueMove[evidenceUpdate.dialogue.move] || "DIG_DEEPER",
            nextMustKnowIndex: context.mustKnowIndex,
          };
        }

        const mayEnterMastery = mayAdvance && !hasNextSubtopic && evidenceUpdate.dialogue.allConceptsVerified;
        if (mayEnterMastery && orchestrator.session.phase !== "MASTERY") {
          orchestrator.session.phase = "MASTERY";
          context.phaseChanged = true;
          context.phaseLabel = context.phaseLabels.MASTERY;
          guideResult = { ...guideResult, nextAction: "MASTERY", nextPhase: "MASTERY" };
        } else if (mayAdvance && requestedPhase && requestedPhase !== "MASTERY" && requestedPhase !== context.phase) {
          orchestrator.session.phase = requestedPhase;
          context.phaseChanged = true;
          context.phaseLabel = context.phaseLabels[requestedPhase];
        }

        await updateStudentState(context.agentId, context.topic, context.analysis, {
          phase: orchestrator.session.phase,
          mustKnowIndex: orchestrator.session.mustKnowIndex,
          lastAction: guideResult.nextAction,
        });
        context.guideResult = guideResult;
      },
    },
  });
}
