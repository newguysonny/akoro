/**
 * teaching-session/blocks.js — a teaching turn's result as typed blocks
 * (BlockRenderer-compatible). Shared by the socket transport and the agent
 * bridge, so both save and show a turn the same way.
 */
// =============================================================
// TYPED BLOCK CONVERTERS
// Maps orchestrator result → BlockRenderer-compatible typed blocks
// (same format as teachingSession.js REST endpoint)
// =============================================================

import { guideIdeas, shortConcept } from "./guideIdeas.js";

const NANA_RENDER_STYLE = {
  bubbleBg:     "rgba(124,58,237,0.10)",
  bubbleBorder: "#7C3AED",
  labelColor:   "#7C3AED",
  ttsVoice:     "alloy",
  assessStyle:  "gentle",
};

export function resultToTypedBlocks(result, agentPairId) {
  const blocks     = [];
  const guideName  = result.guideName  || "NaNa Esumai";
  const guideEmoji = result.guideEmoji || "🧠";
  const renderStyle = result.guideRenderStyle || NANA_RENDER_STYLE;
  const agentName  = result.studentAgentName || "Agent";
  // These labels are already shaped by the server-side evidence workflow.
  // They are safe learner-facing direction, not raw evaluation values.
  const learningState = result.publicLearningState || {};

  // No drift block. A wandering learner is steered inside NaNa's own tip now,
  // as part of a turn that still teaches — rather than by a red alarm from a
  // second agent that replaced the whole turn with a scolding. Sargeant still
  // appears below for the assessment gate, which is a different job.

  const advancedObjectiveHeader = result.subtopicAdvanced && result.currentSubtopic
    ? {
        type:    "subtopic-hdr",
        subtopic: result.currentSubtopic,
        idx:     result.subtopicIdx     ?? 0,
        items:   result.subtopicObjectives ?? [],
        total:   result.totalSubtopics  ?? 1,
        topic:   result.topic    ?? "",
        subject: result.subject  ?? "",
      }
    : null;

  // Sargeant assessment gate
  if (result.wardenHolding && result.wardenHoldMessage) {
    blocks.push({
      type:        "sargeant",
      phase:       `Assessment gate — ${result.currentSubtopic || ""}`,
      text:        result.wardenHoldMessage,
      renderStyle,
    });
  }

  // Student Agent response. The current idea and short explanation of the
  // prompt's purpose are deterministic server-owned UI copy—never an inferred
  // browser state and never a claim that the agent has mastered the concept.
  // The guide doesn't speak in the conversation (it's the human and their
  // protégé): its help rides on the reply as 2-3 "say this next" ideas, shown
  // as pills under the latest reply (guideIdeas.js).
  if (result.studentAgentResponse) {
    blocks.push({
      type:            "student-agent",
      agent:           agentName,
      emoji:           "🤖",
      currentIdea:     learningState.currentIdea || null,
      whyThisResponse: learningState.whyThisResponse || null,
      text:            result.studentAgentResponse,
      guide: { name: guideName, emoji: guideEmoji,
        ideas: guideIdeas(result.guideSuggestions, { nextAction: result.guideNextAction, concept: result.topic || shortConcept(result.currentSubtopic) }) },
    });
  }

  // No protégé reply this turn (rare): the guide's tip is still a message, so the learner isn't left with nothing.
  if (result.guideMessage && !result.studentAgentResponse) {
    blocks.push({
      type:             "guide",
      agent:            guideName,
      emoji:            guideEmoji,
      learningState:    learningState.learningState || null,
      nextLearningMove: learningState.nextLearningMove || null,
      text:             result.guideMessage,
      renderStyle,
    });
  }

  // When this turn unlocks a new objective, introduce it only after the
  // responses about the just-completed idea. This keeps each response context
  // truthful and leaves the familiar objective tracker ready for the next turn.
  if (advancedObjectiveHeader) blocks.push(advancedObjectiveHeader);

  // Sargeant assessment result
  if (result.assessmentResult) {
    const confPct = Math.round((result.assessmentResult.score ?? 0.7) * 100);
    blocks.push({
      type:         "assess-result",
      subtopic:     result.currentSubtopic,
      agentName,
      confidence:   confPct,
      passed:       result.assessmentResult.passed ?? confPct >= 70,
      nextSubtopic: result.nextSubtopic ?? null,
      renderStyle,
    });
  }

  // Session complete
  if (result.sessionComplete || result.currentPhase === "complete") {
    blocks.push({
      type:    "session-complete",
      text:    `${agentName} has completed the session on ${result.topic || "this topic"}. +${result.turnXP ?? 0} XP earned.`,
      isDecay: result.sessionType === "decay_review",
    });
  }

  return blocks;
}
