// =============================================================
// training/agentOrchestration.js
// Derives a unique agent orchestration config from a teacher's
// style profile and saves it to edu.agent_orchestration_config.
//
// Called at the end of every training pipeline run.
// Each teacher gets their own flow, phases, voice, and control style.
// =============================================================

import db from "../../../db.js";
import OpenAI from "openai";

const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// db.js handles supabase // 
);

// ── Flow type mapping from pedagogical pattern ────────────────
function deriveFlowType(pedagogicalPattern) {
  const map = {
    "concept-first":   "phase-based",
    "problem-first":   "challenge-first",
    "socratic":        "phase-based",
    "example-first":   "lecture-drill",
    "mixed":           "phase-based",
  };
  return map[pedagogicalPattern] || "phase-based";
}

// ── Derive drift sensitivity from teaching style ──────────────
function deriveDriftSensitivity(styleProfile) {
  const tone = styleProfile.tone || "";
  if (["strict", "authoritative"].includes(tone)) return "high";
  if (["casual"].includes(tone))                  return "low";
  return "medium";
}

// ── Derive boundary style from correction phrases ─────────────
function deriveBoundaryStyle(styleProfile) {
  const phrases = styleProfile.correction_phrases || [];
  const isStrict = phrases.some(p =>
    /stop|focus|not now|wrong track|off topic/i.test(p)
  );
  return isStrict ? "hard-block" : "soft-redirect";
}

// =============================================================
// MAIN: Extract and save orchestration config
// =============================================================

/**
 * After training completes, derive the orchestration config.
 * Returns the saved config.
 */
export async function deriveAndSaveOrchestrationConfig({
  teacherId,
  agentId,
  runId,
  subject,
  styleProfile,
  transcript,
}) {
  // Step 1: Derive custom phases from this teacher's style
  const phaseDefinitions = await deriveCustomPhases(styleProfile, subject, transcript);

  // Step 2: Build guide config (teacher's voice + coaching tips style)
  const guideConfig = buildGuideConfig(styleProfile, phaseDefinitions);

  // Step 3: Build control config (teacher's boundary style)
  const controlConfig = buildControlConfig(styleProfile);

  // Step 4: Build student agent config (how this teacher calibrates students)
  const studentConfig = buildStudentConfig(styleProfile);

  // Step 5: Build prompt injections (fragments used in every LLM call)
  const promptInjections = buildPromptInjections(styleProfile, phaseDefinitions);

  // Step 6: Build renderer style (visual identity for BlockRenderer)
  const renderStyle = buildRenderStyle(styleProfile);

  const flowType = deriveFlowType(styleProfile.pedagogical_pattern);

  const config = {
    agent_id:           agentId,
    teacher_id:         teacherId,
    flow_type:          flowType,
    phase_definitions:  phaseDefinitions,
    guide_config:       guideConfig,
    control_config:     controlConfig,
    student_config:     studentConfig,
    prompt_injections:  promptInjections,
    derived_from_run:   runId,
    training_version:   1,
    is_active:          true,
    tts_voice:          renderStyle.ttsVoice || "alloy",
    updated_at:         new Date(),
  };

  // Upsert orchestration config
  const { error } = await db
    .from("edu.agent_orchestration_config")
    .upsert(config, { onConflict: "agent_id" });

  if (error) throw new Error(`Orchestration config save failed: ${error.message}`);

  // Also store render_style on teacher_profiles for fast lookup
  await db.schema("edu").from("teacher_profiles")
    .update({ render_style: renderStyle, updated_at: new Date() })
    .eq("agent_id", agentId)
    .catch(() => {});

  return { ...config, render_style: renderStyle };
}

// =============================================================
// DERIVE CUSTOM PHASES
// GPT-4o reads the style profile and generates unique phases
// =============================================================

async function deriveCustomPhases(styleProfile, subject, transcript) {
  const res = await openai.chat.completions.create({
    model:           "gpt-4o",
    temperature:     0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert in pedagogical design.
Based on a teacher's extracted style profile, design their unique teaching phases.
These phases replace generic Phase 1/2/3/4 — they should reflect how THIS teacher ACTUALLY teaches.
Return JSON only.`,
      },
      {
        role: "user",
        content: `Teacher style profile for ${subject}:
${JSON.stringify(styleProfile, null, 2)}

Design 3-5 teaching phases that match this teacher's exact style.
Each phase should have a label the STUDENT sees (plain English, no jargon).

Return JSON:
{
  "phases": [
    {
      "id": "PHASE_ID",
      "label": "What student sees, e.g. 'What do you already know?'",
      "description": "Internal description of what happens in this phase",
      "triggerConditions": "When to move to this phase",
      "guideAction": "What the guide should do in this phase",
      "controlAction": "What the control should monitor",
      "masteryThreshold": 0-100
    }
  ],
  "masteryDefinition": "How this teacher defines mastery",
  "recallStyle": "How this teacher checks recall"
}`,
      },
    ],
  });

  return JSON.parse(res.choices[0].message.content);
}

// =============================================================
// BUILD GUIDE CONFIG
// =============================================================

function buildGuideConfig(styleProfile, phaseDefinitions) {
  return {
    name:              "Teaching Guide",
    personality:       buildGuidePersonality(styleProfile),
    tipStyle:          deriveTipStyle(styleProfile),
    vocabLevel:        styleProfile.vocabulary_level || "conversational",
    tone:              styleProfile.tone             || "encouraging",
    phaseCount:        phaseDefinitions?.phases?.length || 4,

    // Teacher's actual phrases — injected into guide prompts
    encouragementPhrases: (styleProfile.encouragement_phrases || []).slice(0, 4),
    transitionPhrases:    (styleProfile.transition_phrases    || []).slice(0, 4),
    confusionPhrases:     (styleProfile.confusion_handling_phrases || []).slice(0, 3),
    correctionPhrases:    (styleProfile.correction_phrases    || []).slice(0, 3),
    questionStyle:        styleProfile.question_style         || "direct",
    analogyCount:         (styleProfile.analogies             || []).length,
    topAnalogies:         (styleProfile.analogies             || []).slice(0, 3),

    // How guide gives tips
    mustKnowDetection:   "strict",
    paceStyle:           styleProfile.pacing_style || "moderate",
    masteryDefinition:   phaseDefinitions?.masteryDefinition || "student can recall and explain",
    recallStyle:         phaseDefinitions?.recallStyle       || "ask to explain back",
  };
}

function buildGuidePersonality(styleProfile) {
  const tone     = styleProfile.tone || "encouraging";
  const pattern  = styleProfile.pedagogical_pattern || "mixed";
  const vocab    = styleProfile.vocabulary_level || "conversational";
  const summary  = styleProfile.overall_summary || "";

  return `${tone.charAt(0).toUpperCase() + tone.slice(1)} teaching guide with a ${pattern} approach.
Uses ${vocab} language. ${summary}
Always whispers short, specific, actionable tips to the student teacher.
Never uses jargon. Tips are 1-2 sentences maximum.`;
}

function deriveTipStyle(styleProfile) {
  const pattern = styleProfile.pedagogical_pattern || "mixed";
  const map = {
    "concept-first":  "confirm concept understood before examples",
    "problem-first":  "let student struggle first, then guide",
    "socratic":       "always respond with a guiding question",
    "example-first":  "push for a worked example immediately",
    "mixed":          "flexible — read the student's response",
  };
  return map[pattern] || map["mixed"];
}

// =============================================================
// BUILD CONTROL CONFIG
// =============================================================

function buildControlConfig(styleProfile) {
  return {
    name:             "Focus Monitor",
    driftSensitivity: deriveDriftSensitivity(styleProfile),
    boundaryStyle:    deriveBoundaryStyle(styleProfile),
    allowEdgeTopics:  styleProfile.pacing_style !== "fast", // fast teachers stay strict
    redirectPhrases:  (styleProfile.correction_phrases || []).slice(0, 3),
    tone:             styleProfile.tone || "encouraging",

    // What counts as "edge" vs "drift" for this teacher
    edgeTopicPolicy:  styleProfile.tone === "strict"
      ? "block-all-edges"
      : "allow-with-note",
  };
}

// =============================================================
// BUILD STUDENT CONFIG
// =============================================================

function buildStudentConfig(styleProfile) {
  return {
    // How students of this teacher typically respond
    expectedVocabLevel:   styleProfile.vocabulary_level || "conversational",
    expectedPace:         styleProfile.pacing_style     || "moderate",
    commonMisconceptions: (styleProfile.misconceptions_flagged || []).slice(0, 5),

    // How the student agent should behave with this teacher's material
    confusionSignals:     styleProfile.confusion_handling_phrases || [],
    encouragementStyle:   styleProfile.tone === "warm"
      ? "show enthusiasm when correct"
      : "confirm understanding directly",

    // When to show being stuck vs making progress
    confusionThreshold:   0.45,
    progressThreshold:    0.65,
  };
}

// =============================================================
// BUILD PROMPT INJECTIONS
// Fragments injected into every LLM call at runtime
// =============================================================

function buildPromptInjections(styleProfile, phaseDefinitions) {
  const sp = styleProfile;

  const guidePrefix = [
    `You are a teaching guide embodying the style of a real teacher.`,
    `Teaching pattern: ${sp.pedagogical_pattern || "mixed"}.`,
    `Tone: ${sp.tone || "encouraging"}.`,
    `Vocabulary level: ${sp.vocabulary_level || "conversational"}.`,
    sp.overall_summary ? `Style: ${sp.overall_summary}` : "",
    sp.encouragement_phrases?.length
      ? `Encouragement style: "${sp.encouragement_phrases[0]}"` : "",
    sp.transition_phrases?.length
      ? `Transition style: "${sp.transition_phrases[0]}"` : "",
    `Your tips are 1-2 sentences, plain language, no jargon.`,
  ].filter(Boolean).join(" ");

  const controlPrefix = [
    `You are a focus monitor for a teacher who is ${sp.tone || "encouraging"}.`,
    `Drift sensitivity: ${deriveDriftSensitivity(sp)}.`,
    `Boundary style: ${deriveBoundaryStyle(sp)}.`,
    sp.correction_phrases?.length
      ? `When redirecting, mirror this style: "${sp.correction_phrases[0]}"` : "",
  ].filter(Boolean).join(" ");

  const studentPrefix = [
    `You are learning from a teacher who uses a ${sp.pedagogical_pattern || "mixed"} approach.`,
    `Match the vocabulary level: ${sp.vocabulary_level || "conversational"}.`,
    sp.misconceptions_flagged?.length
      ? `Watch out for these common misconceptions: ${sp.misconceptions_flagged.slice(0, 3).join(", ")}`
      : "",
  ].filter(Boolean).join(" ");

  return {
    guidePrefix,
    controlPrefix,
    studentPrefix,
    phaseSummary: phaseDefinitions?.phases?.map(p => `${p.id}: ${p.label}`).join(" → ") || "",
  };
}

// =============================================================
// BUILD RENDER STYLE — visual identity for BlockRenderer
// Derived from the teacher's style_profile extracted during training.
// Stored in teacher_profiles.render_style for fast frontend lookup.
// =============================================================

export function buildRenderStyle(styleProfile) {
  const tone = styleProfile.tone || "encouraging";

  // Map tone → visual identity
  const TONE_STYLES = {
    strict: {
      bubbleBg:     "rgba(239,68,68,0.08)",
      bubbleBorder: "#DC2626",
      labelColor:   "#DC2626",
      ttsVoice:     "onyx",      // deep, authoritative
      assessStyle:  "harsh",
    },
    authoritative: {
      bubbleBg:     "rgba(30,64,175,0.10)",
      bubbleBorder: "#1D4ED8",
      labelColor:   "#1D4ED8",
      ttsVoice:     "echo",      // clear, confident
      assessStyle:  "strict",
    },
    warm: {
      bubbleBg:     "rgba(236,72,153,0.08)",
      bubbleBorder: "#DB2777",
      labelColor:   "#DB2777",
      ttsVoice:     "shimmer",   // warm, expressive
      assessStyle:  "gentle",
    },
    casual: {
      bubbleBg:     "rgba(16,185,129,0.08)",
      bubbleBorder: "#059669",
      labelColor:   "#059669",
      ttsVoice:     "fable",     // friendly, relaxed
      assessStyle:  "gentle",
    },
    encouraging: {
      bubbleBg:     "rgba(124,58,237,0.10)",
      bubbleBorder: "#7C3AED",
      labelColor:   "#7C3AED",
      ttsVoice:     "nova",      // clear, upbeat
      assessStyle:  "gentle",
    },
    socratic: {
      bubbleBg:     "rgba(245,158,11,0.08)",
      bubbleBorder: "#D97706",
      labelColor:   "#D97706",
      ttsVoice:     "alloy",     // neutral, questioning
      assessStyle:  "strict",
    },
  };

  const base = TONE_STYLES[tone] || TONE_STYLES.encouraging;

  return {
    ...base,
    tone,
    pedagogicalPattern: styleProfile.pedagogical_pattern || "phase-based",
    phaseCount:         styleProfile.phase_count || 4,
    // Always fallback to alloy if ttsVoice is unrecognised
    ttsVoice: ["alloy","echo","fable","onyx","nova","shimmer"].includes(base.ttsVoice)
      ? base.ttsVoice
      : "alloy",
  };
}

// =============================================================
// LOAD CONFIG AT RUNTIME (used by registry + orchestrator)
// =============================================================

export async function loadOrchestrationConfig(agentId) {
  const { data, error } = await db
    .from("edu.agent_orchestration_config")
    .select("*")
    .eq("agent_id", agentId)
    .eq("is_active", true)
    .single();

  if (error || !data) return null;
  return data;
}

export async function loadOrchestrationConfigByTeacher(teacherId) {
  const { data, error } = await db
    .from("edu.agent_orchestration_config")
    .select("*")
    .eq("teacher_id", teacherId)
    .eq("is_active", true)
    .single();

  if (error || !data) return null;
  return data;
}
