// =============================================================
// training/agentPromptBuilder.js
// Builds live system prompts at session time by combining:
//   • Orchestration config from DB (teacher's unique style)
//   • Relevant training chunks from pgvector (teacher's content)
//   • Session context (topic, phase, understanding state)
// =============================================================

import db from "../../../db.js";
import { embed } from "../agents/student/knowledge.js";
import {
  trainedShell, buildTrainedGuideTipPrompt, buildTrainedControlDriftPrompt, buildTrainedStudentReplyPrompt,
} from "../../agent-context/personas/trained.js";

import { openai } from "../../../lib/aiModel.js";
// db.js handles supabase //

// =============================================================
// BUILD GUIDE PROMPT
// For the trained teacher's guide agent
// =============================================================

export async function buildGuidePrompt({
  config,
  topic,
  phase,
  currentSubtopic,
  understanding,
  confusion,
  mustKnowParts,
  mustKnowIndex,
}) {
  const gc  = config.guide_config   || {};
  const pi  = config.prompt_injections || {};

  // P2b TRAINED_SHELL: platform doctrine FIRST, then the teacher's own
  // DB-configured style — the layer composes around the teacher, never
  // replaces them. Template: akoro-agent/agents/trained/GUIDE_TIP.md.
  return (await trainedShell()) + "\n\n" + await buildTrainedGuideTipPrompt({
    guidePrefix: pi.guidePrefix || "You are a teaching guide.",
    topic, phase,
    currentSubtopic: currentSubtopic || "none",
    mustKnowJson: JSON.stringify(mustKnowParts),
    understanding, confusion,
    tipStyle: gc.tipStyle || "short, specific",
    questionStyle: gc.questionStyle || "direct",
    paceStyle: gc.paceStyle || "moderate",
    masteryDefinition: gc.masteryDefinition || "student can recall and explain",
    recallStyle: gc.recallStyle || "ask to explain back",
    analogiesLine: gc.topAnalogies?.length ? `\n- Analogies this teacher uses: ${gc.topAnalogies.slice(0, 2).join(" \u00b7 ")}` : "",
    encouragementLine: gc.encouragementPhrases?.length ? `- Encouragement style: "${gc.encouragementPhrases[0]}"` : "",
    transitionLine: gc.transitionPhrases?.length ? `- Transition style: "${gc.transitionPhrases[0]}"` : "",
    phaseSummary: pi.phaseSummary || "Phase 1 \u2192 Phase 2 \u2192 Phase 3 \u2192 Phase 4",
    mustKnowIndex,
  });
}

// =============================================================
// BUILD CONTROL PROMPT
// For the trained teacher's control agent
// =============================================================

export async function buildControlPrompt({
  config,
  intendedTopic,
  allowedTopics,
}) {
  const cc = config.control_config   || {};
  const pi = config.prompt_injections || {};

  // P2b TRAINED_SHELL: shell first, then the teacher's drift settings.
  // Template: akoro-agent/agents/trained/CONTROL_DRIFT.md.
  return (await trainedShell()) + "\n\n" + await buildTrainedControlDriftPrompt({
    controlPrefix: pi.controlPrefix || "You are a focus monitor.",
    intendedTopic,
    allowedTopicsJson: JSON.stringify(allowedTopics),
    driftSensitivity: cc.driftSensitivity || "medium",
    boundaryStyle: cc.boundaryStyle || "soft-redirect",
    edgeTopicPolicy: cc.edgeTopicPolicy || "allow-with-note",
    redirectLine: cc.redirectPhrases?.length ? `Redirect in this style: "${cc.redirectPhrases[0]}"` : "",
    edgePolicyLabel: cc.edgeTopicPolicy === "block-all-edges" ? "BLOCK" : "allow, note it",
  });
}

// =============================================================
// BUILD STUDENT AGENT PROMPT (trained teacher context)
// =============================================================

export async function buildStudentAgentPrompt({
  config,
  topic,
  understanding,
  confusion,
  phaseLabel,
  combinedContext,
  recentHistory,
}) {
  const sc = config.student_config    || {};
  const pi = config.prompt_injections || {};

  const u = Math.round(understanding * 100);
  const c = Math.round(confusion     * 100);

  // P2b TRAINED_SHELL: shell first, then the trained student persona.
  // Template: akoro-agent/agents/trained/STUDENT_REPLY.md.
  return (await trainedShell()) + "\n\n" + await buildTrainedStudentReplyPrompt({
    studentPrefix: pi.studentPrefix || "You are a student agent.",
    topic, u, c, phaseLabel,
    contextBlock: combinedContext ? `## Your knowledge context\n${combinedContext}\n` : "",
    vocabLevel: sc.expectedVocabLevel || "simple",
    misconceptionsBlock: sc.commonMisconceptions?.length
      ? `## Watch out for these common misconceptions:\n${sc.commonMisconceptions.map(m => `- ${m}`).join("\n")}`
      : "",
    recentHistory,
  });
}

// =============================================================
// TEACHER PROFILE LOADER (used by trained orchestrator)
// =============================================================

export async function loadTeacherProfile(teacherId) {
  const { data, error } = await db
    .schema("edu").from("teacher_profiles")
    .select("*")
    .eq("teacher_id", teacherId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

export async function loadTeacherChunks(teacherId, query, limit = 6) {
  try {
    const embedding = await embed(query);
    const { data, error } = await db.rpc("match_training_chunks", {
      p_teacher_id:      teacherId,
      p_query_embedding: embedding,
      p_match_count:     limit,
    });
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}
