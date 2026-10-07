/**
 * Server-owned evidence model for the "learner teaches a protege" experience.
 *
 * A delivered explanation is exposure, not mastery. This module stores only
 * compact scores and states; it deliberately never stores the learner's words,
 * model rationale, or a guessed claim about whether text was copied.
 */

export const TEACHING_EVIDENCE_POLICY_VERSION = "teaching-evidence-v1";

export const LEARNER_PACE_MODES = Object.freeze({
  SUPPORTED: "supported",
  STANDARD: "standard",
  ACCELERATED: "accelerated",
});

export const DIALOGUE_MOVES = Object.freeze({
  CLARIFY_CORE: "clarify_core",
  REPAIR_MISCONCEPTION: "repair_misconception",
  APPLY_IN_CONTEXT: "apply_in_context",
  CONNECT_AND_EXPLAIN: "connect_and_explain",
  STRETCH_TRANSFER: "stretch_transfer",
  CONSOLIDATE_AND_ADVANCE: "consolidate_and_advance",
  SYNTHESISE: "synthesise",
});

const PACE_SET = new Set(Object.values(LEARNER_PACE_MODES));
const STYLE_SET = new Set(["not_observed", "recall", "procedural", "causal", "comparative", "transfer", "mixed"]);
const STATUS_SET = new Set(["introduced", "developing", "verified"]);
const MOVE_SET = new Set(Object.values(DIALOGUE_MOVES));
const MAX_CONCEPTS = 12;

function clamp(value, lower = 0, upper = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(upper, Math.max(lower, number)) : lower;
}

function round(value) {
  return Math.round(clamp(value) * 100) / 100;
}

function quality(value) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["clear", "strong", "complete"].includes(normalized)) return 1;
    if (["partial", "emerging", "some"].includes(normalized)) return 0.5;
    return 0;
  }
  return round(value);
}

function emptyConcept(index) {
  return {
    index,
    attempts: 0,
    coreExplanation: 0,
    application: 0,
    reasoning: 0,
    correction: 0,
    unresolvedMisconception: false,
    learnerMastery: 0,
    protegeUnderstanding: 0,
    teachingSkill: 0,
    masteryStatus: "introduced",
    lastDialogueMove: DIALOGUE_MOVES.CLARIFY_CORE,
  };
}

function compactConcept(raw, index) {
  const concept = emptyConcept(index);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return concept;
  concept.attempts = Math.min(50, Math.max(0, Math.floor(Number(raw.attempts) || 0)));
  concept.coreExplanation = quality(raw.coreExplanation);
  concept.application = quality(raw.application);
  concept.reasoning = quality(raw.reasoning);
  concept.correction = quality(raw.correction);
  concept.unresolvedMisconception = raw.unresolvedMisconception === true;
  concept.learnerMastery = round(raw.learnerMastery);
  concept.protegeUnderstanding = round(raw.protegeUnderstanding);
  concept.teachingSkill = round(raw.teachingSkill);
  concept.masteryStatus = STATUS_SET.has(raw.masteryStatus) ? raw.masteryStatus : "introduced";
  concept.lastDialogueMove = MOVE_SET.has(raw.lastDialogueMove)
    ? raw.lastDialogueMove
    : DIALOGUE_MOVES.CLARIFY_CORE;
  return concept;
}

function explicitProfileIsUsable(profile) {
  if (!profile || typeof profile !== "object") return false;
  const expiry = profile.expires_at || profile.expiresAt;
  const expiresAt = expiry ? new Date(expiry).getTime() : NaN;
  const evidenceCount = Number(profile.evidence_count ?? profile.evidenceCount ?? 0);
  const confidence = Number(profile.profile_confidence ?? profile.profileConfidence ?? 0);
  return Number.isFinite(expiresAt) && expiresAt > Date.now() && evidenceCount >= 3 && confidence >= 0.5;
}

/**
 * Resolve an initial pace from an expiry-aware learner profile. We do not infer
 * a pace from age, class, country, or a single message. Sparse/expired signals
 * deliberately fall back to the neutral standard pace.
 */
export function resolveLearnerPace(profile = null) {
  const recommendation = String(profile?.pacing_recommendation ?? profile?.pacingRecommendation ?? "unknown").toLowerCase();
  if (!explicitProfileIsUsable(profile)) {
    return { mode: LEARNER_PACE_MODES.STANDARD, source: "default", recommendation: "unknown" };
  }
  if (recommendation === "shorter_chunks") {
    return { mode: LEARNER_PACE_MODES.SUPPORTED, source: "learner_profile", recommendation };
  }
  if (recommendation === "stretch") {
    return { mode: LEARNER_PACE_MODES.ACCELERATED, source: "learner_profile", recommendation };
  }
  return { mode: LEARNER_PACE_MODES.STANDARD, source: "learner_profile", recommendation: "steady" };
}

export function normaliseTeachingObservation(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const style = String(source.reasoningStyle || source.reasoning_style || "not_observed").toLowerCase();
  return {
    coreExplanation: quality(source.coreExplanation ?? source.core_explanation),
    application: quality(source.application),
    reasoning: quality(source.reasoning),
    correction: quality(source.correction),
    misconceptionPresent: source.misconceptionPresent === true || source.misconception_present === true,
    reasoningStyle: STYLE_SET.has(style) ? style : "not_observed",
  };
}

function isVerified(concept) {
  // Proper mastery rule: one clear core explanation PLUS one different form of
  // evidence (application, reasoning, or a repaired misconception), with no
  // unresolved misconception. A pasted definition alone cannot meet it.
  const hasCoreExplanation = concept.coreExplanation >= 0.75;
  const hasTransferOrReasoning = Math.max(concept.application, concept.reasoning, concept.correction) >= 0.75;
  return hasCoreExplanation && hasTransferOrReasoning && !concept.unresolvedMisconception;
}

function applyScores(concept) {
  const elaboration = Math.max(concept.application, concept.reasoning, concept.correction);
  const verified = isVerified(concept);
  concept.masteryStatus = verified
    ? "verified"
    : (concept.coreExplanation >= 0.5 || elaboration >= 0.5 ? "developing" : "introduced");

  const evidenceScore = (concept.coreExplanation * 0.5) + (elaboration * 0.35) + (concept.correction * 0.15);
  concept.learnerMastery = round(verified ? Math.max(0.8, evidenceScore) : Math.min(0.69, evidenceScore));
  // The protege may be exposed to an accurate explanation before it is safe to
  // call the idea understood. Keep unverified learning visibly capped.
  concept.protegeUnderstanding = round(verified ? Math.max(0.8, evidenceScore) : Math.min(0.6, evidenceScore * 0.8));
  concept.teachingSkill = round((concept.coreExplanation * 0.5) + (elaboration * 0.35) + (concept.correction * 0.15));
  return concept;
}

function chooseDialogueMove(concept, pace) {
  if (concept.unresolvedMisconception) return DIALOGUE_MOVES.REPAIR_MISCONCEPTION;
  if (concept.coreExplanation < 0.75) return DIALOGUE_MOVES.CLARIFY_CORE;
  if (Math.max(concept.application, concept.reasoning, concept.correction) < 0.75) {
    return pace.mode === LEARNER_PACE_MODES.ACCELERATED
      ? DIALOGUE_MOVES.STRETCH_TRANSFER
      : DIALOGUE_MOVES.APPLY_IN_CONTEXT;
  }
  return DIALOGUE_MOVES.CONSOLIDATE_AND_ADVANCE;
}

function adaptPace(pace, concept) {
  // Temporary support comes from repeated evidence gaps in THIS session, not a
  // permanent "slow learner" label. We do not auto-promote to accelerated from
  // a single good response; that requires the expiry-aware learner profile.
  if (pace.mode !== LEARNER_PACE_MODES.SUPPORTED && concept.attempts >= 2 &&
      (concept.coreExplanation < 0.5 || concept.unresolvedMisconception)) {
    return { mode: LEARNER_PACE_MODES.SUPPORTED, source: "live_session", recommendation: "shorter_chunks" };
  }
  return pace;
}

export function createTeachingEvidenceState({ paceProfile = null, persisted = null, conceptCount = 1 } = {}) {
  const maxConcepts = Math.max(1, Math.min(MAX_CONCEPTS, Number(conceptCount) || 1));
  const resolvedPace = resolveLearnerPace(paceProfile);
  const prior = persisted && typeof persisted === "object" && !Array.isArray(persisted) ? persisted : null;
  const priorPace = prior?.pace && PACE_SET.has(prior.pace.mode) ? {
    mode: prior.pace.mode,
    source: typeof prior.pace.source === "string" ? prior.pace.source.slice(0, 40) : resolvedPace.source,
    recommendation: typeof prior.pace.recommendation === "string" ? prior.pace.recommendation.slice(0, 40) : resolvedPace.recommendation,
  } : resolvedPace;
  const rawConcepts = Array.isArray(prior?.concepts) ? prior.concepts : [];

  return {
    policyVersion: TEACHING_EVIDENCE_POLICY_VERSION,
    pace: priorPace,
    concepts: Array.from({ length: maxConcepts }, (_, index) => compactConcept(rawConcepts[index], index)),
  };
}

export function applyTeachingObservation(state, index, rawObservation) {
  const safeState = state && typeof state === "object" ? state : createTeachingEvidenceState();
  const currentIndex = Math.max(0, Math.min(safeState.concepts.length - 1, Number(index) || 0));
  const observation = normaliseTeachingObservation(rawObservation);
  const concept = safeState.concepts[currentIndex] || emptyConcept(currentIndex);

  // An unavailable evaluator means no observation, not weak learner evidence.
  // Keep the existing support level and fail closed on advancement.
  if (rawObservation?.notChecked === true) {
    return {
      state: safeState,
      observation,
      current: concept,
      misconceptionRepaired: false,
      dialogue: buildDialoguePlan(safeState, currentIndex),
    };
  }

  const hadUnresolvedMisconception = concept.unresolvedMisconception;
  concept.attempts = Math.min(50, concept.attempts + 1);
  concept.coreExplanation = Math.max(concept.coreExplanation, observation.coreExplanation);
  concept.application = Math.max(concept.application, observation.application);
  concept.reasoning = Math.max(concept.reasoning, observation.reasoning);
  concept.correction = Math.max(concept.correction, observation.correction);
  if (observation.misconceptionPresent) concept.unresolvedMisconception = true;
  // A clear correction after a clean response resolves a prior misconception.
  if (!observation.misconceptionPresent && hadUnresolvedMisconception && observation.correction >= 0.75) {
    concept.unresolvedMisconception = false;
  }
  applyScores(concept);

  safeState.concepts[currentIndex] = concept;
  safeState.pace = adaptPace(safeState.pace, concept);
  concept.lastDialogueMove = chooseDialogueMove(concept, safeState.pace);

  return {
    state: safeState,
    observation,
    current: concept,
    misconceptionRepaired: hadUnresolvedMisconception && !concept.unresolvedMisconception,
    dialogue: buildDialoguePlan(safeState, currentIndex),
  };
}

export function buildDialoguePlan(state, index) {
  const currentIndex = Math.max(0, Math.min((state?.concepts?.length || 1) - 1, Number(index) || 0));
  const concept = state?.concepts?.[currentIndex] || emptyConcept(currentIndex);
  const pace = state?.pace && PACE_SET.has(state.pace.mode)
    ? state.pace
    : resolveLearnerPace();
  const move = MOVE_SET.has(concept.lastDialogueMove)
    ? concept.lastDialogueMove
    : chooseDialogueMove(concept, pace);
  const verifiedConcepts = (state?.concepts || []).filter((entry) => entry.masteryStatus === "verified").length;
  const allConceptsVerified = (state?.concepts || []).length > 0 && verifiedConcepts === state.concepts.length;

  return {
    move,
    pace: pace.mode,
    masteryVerified: concept.masteryStatus === "verified",
    canAdvance: concept.masteryStatus === "verified",
    allConceptsVerified,
    missingEvidence: {
      coreExplanation: concept.coreExplanation < 0.75,
      elaboration: Math.max(concept.application, concept.reasoning, concept.correction) < 0.75,
      misconceptionRepair: concept.unresolvedMisconception,
    },
  };
}

/** A compact, persistence-safe and client-safe snapshot with no transcript text. */
export function publicTeachingEvidence(state, index = 0) {
  const concepts = Array.isArray(state?.concepts) ? state.concepts : [];
  const currentIndex = Math.max(0, Math.min(Math.max(0, concepts.length - 1), Number(index) || 0));
  const current = concepts[currentIndex] || emptyConcept(currentIndex);
  const dialogue = buildDialoguePlan({ ...state, concepts: concepts.length ? concepts : [current] }, currentIndex);
  return {
    policyVersion: TEACHING_EVIDENCE_POLICY_VERSION,
    pace: {
      mode: dialogue.pace,
      source: typeof state?.pace?.source === "string" ? state.pace.source : "default",
    },
    currentConcept: {
      index: currentIndex,
      attempts: current.attempts,
      masteryStatus: current.masteryStatus,
      learnerMastery: current.learnerMastery,
      protegeUnderstanding: current.protegeUnderstanding,
      teachingSkill: current.teachingSkill,
      unresolvedMisconception: current.unresolvedMisconception,
      evidence: {
        coreExplanation: current.coreExplanation,
        application: current.application,
        reasoning: current.reasoning,
        correction: current.correction,
      },
    },
    verifiedConcepts: concepts.filter((entry) => entry.masteryStatus === "verified").length,
    totalConcepts: concepts.length || 1,
    dialogue,
  };
}

/** Same bounded shape is safe to store in adaptive_sessions.teaching_evidence. */
export function serialiseTeachingEvidence(state) {
  const snapshot = publicTeachingEvidence(state, 0);
  return {
    policyVersion: snapshot.policyVersion,
    pace: {
      mode: snapshot.pace.mode,
      source: snapshot.pace.source,
      recommendation: typeof state?.pace?.recommendation === "string" ? state.pace.recommendation : "unknown",
    },
    concepts: (state?.concepts || []).slice(0, MAX_CONCEPTS).map((entry, index) => compactConcept(entry, index)),
  };
}

/** Prevent the protege's generated reply from being treated as independent proof. */
export function capProtegeAnalysis(agentAnalysis = {}, evidenceCurrent = {}) {
  const readiness = clamp(evidenceCurrent.protegeUnderstanding);
  return {
    ...agentAnalysis,
    understanding: Math.min(clamp(agentAnalysis.understanding, 0, 100), Math.round(readiness * 100)),
    // A single received definition is not a reason to show zero confusion.
    confusion: Math.max(clamp(agentAnalysis.confusion, 0, 100), Math.round((1 - readiness) * 35)),
  };
}
