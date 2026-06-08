// =============================================================
// training/agentPromptBuilder.js
// Builds live system prompts at session time by combining:
//   • Orchestration config from DB (teacher's unique style)
//   • Relevant training chunks from pgvector (teacher's content)
//   • Session context (topic, phase, understanding state)
// =============================================================

import db from "../../../db.js";
import OpenAI from "openai";
import { embed } from "../agents/student/knowledge.js";

const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// db.js handles supabase // 
);

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

  return `${pi.guidePrefix || "You are a teaching guide."}

## Session context
Topic: "${topic}"
Current phase: ${phase}
Current subtopic: ${currentSubtopic || "none"}
Must-know parts: ${JSON.stringify(mustKnowParts)}
Understanding: ${understanding}%
Confusion: ${confusion}%

## Your teaching style for this teacher
- Tip style: ${gc.tipStyle || "short, specific"}
- Question style: ${gc.questionStyle || "direct"}
- Pace: ${gc.paceStyle || "moderate"}
- Mastery is defined as: ${gc.masteryDefinition || "student can recall and explain"}
- Recall style: ${gc.recallStyle || "ask to explain back"}
${gc.topAnalogies?.length ? `\n- Analogies this teacher uses: ${gc.topAnalogies.slice(0, 2).join(" · ")}` : ""}
${gc.encouragementPhrases?.length ? `- Encouragement style: "${gc.encouragementPhrases[0]}"` : ""}
${gc.transitionPhrases?.length ? `- Transition style: "${gc.transitionPhrases[0]}"` : ""}

## Phase definitions for this teacher
${pi.phaseSummary || "Phase 1 → Phase 2 → Phase 3 → Phase 4"}

## Rules
- Tips are 1-2 sentences max
- Plain language — no jargon (no "scaffold", "socratic", "metacognitive")
- If confusion > 50% OR misconception detected → isUrgent: true
- Always guide toward mastery as defined above

Decide:
- nextAction: DIG_DEEPER | CLEAR_MISTAKE | NAME_IT | NEXT_SUBTOPIC | ONE_MORE_PUSH | USE_ANALOGY | GAP_CLOSED | TRIGGER_RECALL | CHALLENGE | MASTERY
- nextPhase: null or one of the teacher's phase IDs
- nextMustKnowIndex: ${mustKnowIndex}
- isUrgent: boolean
- detectedMisconception: string or null

Return JSON only:
{
  "tip": "...",
  "nextAction": "...",
  "nextPhase": null,
  "nextMustKnowIndex": ${mustKnowIndex},
  "isUrgent": false,
  "detectedMisconception": null
}`;
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

  return `${pi.controlPrefix || "You are a focus monitor."}

Intended topic: "${intendedTopic}"
Allowed subtopics: ${JSON.stringify(allowedTopics)}
Drift sensitivity: ${cc.driftSensitivity || "medium"}
Boundary style: ${cc.boundaryStyle || "soft-redirect"}
Edge topic policy: ${cc.edgeTopicPolicy || "allow-with-note"}
${cc.redirectPhrases?.length ? `Redirect in this style: "${cc.redirectPhrases[0]}"` : ""}

Classify the conversation:
- "none"  → on topic ✅
- "edge"  → related/adjacent (${cc.edgeTopicPolicy === "block-all-edges" ? "BLOCK" : "allow, note it"})
- "drift" → clearly off topic (block)

Return JSON:
{
  "driftLevel":      "none|edge|drift",
  "isDrifting":      boolean,
  "statusMessage":   "short one-line status",
  "redirectMessage": "only if drift — in teacher's voice",
  "edgeNote":        "only if edge"
}`;
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

  return `${pi.studentPrefix || "You are a student agent."}

You are being taught about "${topic}".
Current understanding: ${u}%
Confusion level: ${c}%
Phase: ${phaseLabel}

${combinedContext ? `## Your knowledge context\n${combinedContext}\n` : ""}

## How to respond based on understanding
- < 35%:  Quite lost. Ask basic questions in ${sc.expectedVocabLevel || "simple"} language.
- 35–55%: Getting fragments. "Wait, so does that mean…?"
- 55–75%: Building a picture. Connect pieces. Voice remaining gaps.
- 75–88%: Mostly get it. Summarise. Flag last uncertainties.
- > 88%:  Got it. Clear confident summaries. Make connections.

${sc.commonMisconceptions?.length
  ? `## Watch out for these common misconceptions:\n${sc.commonMisconceptions.map(m => `- ${m}`).join("\n")}`
  : ""}

## Rules
- You are the STUDENT — never explain things to the teacher
- Respond to exactly what the teacher just said
- Keep responses short (2-5 sentences)
- Show thinking: "wait…", "oh!", "so does that mean…?"
- If you've seen this before in your knowledge, reference it naturally

## Recent conversation
${recentHistory}`;
}

// =============================================================
// TEACHER PROFILE LOADER (used by trained orchestrator)
// =============================================================

export async function loadTeacherProfile(teacherId) {
  const { data, error } = await db
    .from("edu.teacher_profiles")
    .select("*")
    .eq("teacher_id", teacherId)
    .single();

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
