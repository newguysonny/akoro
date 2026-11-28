/**
 * Server-only tools used by the fixed adaptive-teaching turn workflow.
 *
 * These are procedural capabilities, not model-advertised function tools. Each
 * tool has one bounded responsibility and shares one private in-memory context;
 * only the runner's public step labels may cross the WebSocket boundary.
 */
import { getStudentState, updateStudentState } from "../../learner-state/index.js";
import {
  applyTeachingObservation,
  capProtegeAnalysis,
  createTeachingEvidenceState,
} from "../learner/teaching-evidence.js";
import { TEACHING_TURN_TOOL_CATALOG } from "./catalog.js";
import { applyTeachingProgress } from "../teaching-session/state-machine.js";
import { normaliseMode } from "../teaching-session/policy.js";
import { getStrategy } from "../strategies/library.js";

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
/** The misconception moments of one observed turn → the learner model (never throws). */
export async function recordTeachingEvidence(orchestrator, context) {
  const update = context?.evidenceUpdate;
  const learnerId = orchestrator?.sessionMeta?.studentId || orchestrator?.studentId;
  if (!update || !learnerId || update.observation?.notChecked) return [];
  const { recordLearningEvent } = await import("../learner/learning-events.js");
  const part = String(activeConcept(context) || "").trim();
  const topic = orchestrator?.sessionMeta?.topic || context.topic;
  const subject = orchestrator?.sessionMeta?.subject || orchestrator?.subject || null;
  const sessionRef = orchestrator?.dbSessionId ? `teaching:${orchestrator.dbSessionId}` : null;
  if (!sessionRef) return [];
  const turn = `p${context.mustKnowIndex ?? 0}:a${update.current?.attempts ?? 0}`;
  const kinds = [];
  if (update.observation?.misconceptionPresent) kinds.push("misconception_detected");
  if (update.misconceptionRepaired) kinds.push("misconception_cleared");
  const strategy = currentTeachingStrategy(orchestrator);
  const out = [];
  for (const kind of kinds) {
    // The must-know part first (finer), then the session's topic. A repair
    // names the strategy in use: it is what worked (the breakthrough's what_worked_strategy).
    const base = { learnerId, subject, kind, source: "teaching", sessionRef, turnRef: `${turn}:${kind}`,
      summary: kind === "misconception_detected" ? `Teaching: a misconception about ${part || topic}` : `Teaching: the misconception about ${part || topic} was repaired`,
      details: { part: part || null, mustKnowIndex: context.mustKnowIndex ?? 0, ...(kind === "misconception_cleared" && strategy ? { strategy } : {}) } };
    let r = part ? await recordLearningEvent({ ...base, topic: part }) : { recorded: false };
    if (!r.recorded) r = await recordLearningEvent({ ...base, topic });
    out.push({ kind, ...r });
    if (kind === "misconception_cleared" && strategy) {
      const outcome = await recordTeachingStrategyOutcome(orchestrator, { strategy, outcome: "worked", turnRef: `${turn}:${kind}`,
        conceptId: r.conceptId || null, topic: part || topic, struggleType: "misconception" });
      out.push({ kind: "strategy_outcome", strategy, ...outcome });
    }
  }
  return out;
}

/** The strategy a teaching session is running: the one chosen, else teach_back when the learner teaches the agent. */
export function currentTeachingStrategy(orchestrator) {
  const session = orchestrator?.session || {};
  const chosen = getStrategy(session.strategy);
  if (chosen) return chosen.id;
  return normaliseMode(session.teachingMode) === "teach_agent" ? "teach_back" : null;
}

/**
 * PURE: how the session's strategy turned out when it ends → outcome | null
 * (nothing taught). Every part verified (or the objective met) → worked;
 * some progress → partial; none → did_not_work.
 */
export function teachingSessionOutcome({ endedBy = null, totalTurns = 0, teachingEvidence = null } = {}) {
  if (!(Number(totalTurns) > 0)) return null;
  const concepts = Array.isArray(teachingEvidence?.concepts) ? teachingEvidence.concepts.filter((c) => (c?.attempts || 0) > 0) : [];
  if (endedBy === "objective_met" || (concepts.length && concepts.every((c) => c.masteryStatus === "verified"))) return "worked";
  if (concepts.some((c) => c.masteryStatus === "verified" || c.masteryStatus === "developing")) return "partial";
  return "did_not_work";
}

/** A teaching strategy's result → recordStrategyOutcome (never throws; no session row → nothing). */
export async function recordTeachingStrategyOutcome(orchestrator, { strategy, outcome, turnRef, conceptId = null, topic = null, struggleType = null, details = {} }) {
  const learnerId = orchestrator?.sessionMeta?.studentId || orchestrator?.studentId;
  const sessionRef = orchestrator?.dbSessionId ? `teaching:${orchestrator.dbSessionId}` : null;
  if (!learnerId || !sessionRef || !strategy) return { recorded: false, reason: "no_reference" };
  try {
    const { recordStrategyOutcome } = await import("../strategies/outcomes.js");
    return await recordStrategyOutcome({ learnerId, strategyId: strategy, outcome, workflow: "teaching", sessionRef, turnRef,
      conceptId, subject: orchestrator?.sessionMeta?.subject || orchestrator?.subject || null,
      topic: conceptId ? null : (topic || orchestrator?.sessionMeta?.topic || null), struggleType, details });
  } catch (e) {
    console.warn("[teaching] strategy outcome:", e?.message || e);
    return { recorded: false, reason: "error" };
  }
}

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
          // The protégé's previous message, for the pending-question
          // checkpoint: the judge rules whether this message answers it.
          const protegeLastMessage = [...context.history].reverse()
            .find((h) => h?.role === "student_agent" && String(h.content || "").trim())?.content?.slice(0, 500) || null;
          observation = await orchestrator.studentAgent.assessTeachingEvidence({
            humanMessage: context.humanMessage,
            topic: context.topic,
            currentSubtopic: activeConcept(context),
            history: context.history,
            protegeLastMessage,
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
        // Phase 4a (D37): a misconception found, or repaired, goes to the learner
        // model — not only into this session's JSON. Fire-and-forget: a lesson
        // never waits on, or fails because of, the evidence write.
        void recordTeachingEvidence(orchestrator, context);
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
                // The document's passages for this turn (documentGrounding.js) — the tip cites them.
                reference: orchestrator.studentAgent?.referenceMaterial || null,
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
