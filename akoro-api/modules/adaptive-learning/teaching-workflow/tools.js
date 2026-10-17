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
import { applyTeachingProgress } from "../teaching-session/state-machine.js";

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
          activeConcept(context),   // the concept this turn taught (D44)
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
        // generated recommendation can bypass a missing teaching-evidence
        // gate. The transition table lives in teaching-session/state-machine.js
        // (pure, unit-tested); this tool only applies its decision.
        const requestedPhase = Object.hasOwn(context.phaseLabels, guideResult.nextPhase)
          ? guideResult.nextPhase
          : null;

        const progress = applyTeachingProgress({
          phase: orchestrator.session.phase,
          mustKnowIndex: context.mustKnowIndex,
          mustKnowCount: context.mustKnowParts.length,
          canAdvance: evidenceUpdate.dialogue.canAdvance,
          allConceptsVerified: evidenceUpdate.dialogue.allConceptsVerified,
          requestedPhase,
          dialogueMove: evidenceUpdate.dialogue.move,
          actionForDialogueMove: context.actionForDialogueMove,
        });

        orchestrator.session.mustKnowIndex = progress.mustKnowIndex;
        orchestrator.session.phase = progress.phase;
        context.subtopicAdvanced = progress.subtopicAdvanced;
        context.phaseChanged = progress.phaseChanged;
        context.phaseLabel = progress.phaseChanged ? context.phaseLabels[progress.phase] : null;
        guideResult = {
          ...guideResult,
          nextAction: progress.nextAction,
          nextMustKnowIndex: progress.nextMustKnowIndex,
          ...(progress.enteredMastery ? { nextPhase: "MASTERY" } : {}),
        };

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
