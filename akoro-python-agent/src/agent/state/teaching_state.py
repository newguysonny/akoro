"""Evidence-led cognitive progression without a fixed stage sequence.

The prior fixed-stage ladder made advancement depend on a model's requested
label.  This module instead owns one deterministic decision after
each completed turn.  It may hold, repair a misconception, request retrieval,
advance one objective, or recognise topic mastery from the learner-agent's
state, reviewed concept evidence, and its accumulated profile.

Named learning modes describe the current recommendation to the UI and prompt;
they are *not* ordered gates.  The score thresholds are explicitly versioned
policy parameters so they can be measured and calibrated rather than hidden in
an LLM prompt.
"""
from __future__ import annotations

from dataclasses import dataclass
from statistics import fmean
from typing import Iterable, Protocol


class ConceptEvidence(Protocol):
    mastery: float
    retention: float
    evidence_confidence: float
    misconception_active: bool
    evidence_count: int


@dataclass(frozen=True, slots=True)
class CognitivePolicy:
    """Auditable thresholds for the initial measured advancement policy."""

    version: str = "cognitive-progression-v1"
    advance_threshold: float = 0.72
    mastery_margin: float = 0.12
    high_confusion: float = 0.45
    low_retention: float = 0.45
    minimum_canonical_evidence: int = 1
    maximum_profile_adjustment: float = 0.08


@dataclass(slots=True)
class CognitiveProgressState:
    """Small mutable session projection of the cognitive engine's last decision."""

    objective_index: int = 0
    learning_mode: str = "orient"
    readiness: float = 0.0
    advancement_threshold: float = 0.72
    mastery_recognised: bool = False
    decision_reason: str = "session_started"

    def label(self) -> str:
        labels = {
            "orient": "Build a shared starting point",
            "clarify": "Clarify the current idea",
            "repair": "Repair a misconception",
            "retrieve": "Strengthen recall before moving on",
            "practise": "Practise and check understanding",
            "challenge": "Apply the idea in a new way",
            "advance": "Ready to connect the next objective",
            "mastery_review": "Consolidate and verify mastery",
        }
        return labels.get(self.learning_mode, "Adapt to current evidence")


@dataclass(frozen=True, slots=True)
class CognitiveTransition:
    learning_mode_changed: bool
    objective_advanced: bool
    mastery_recognised: bool
    current_objective_index: int
    learning_mode: str
    readiness: float
    advancement_threshold: float
    reason: str
    policy_version: str
    canonical_evidence_used: bool
    cognitive_signal: float
    canonical_signal: float | None
    profile_adjustment: float

    def public(self) -> dict[str, object]:
        return {
            "policyVersion": self.policy_version,
            "learningMode": self.learning_mode,
            "readiness": round(self.readiness, 4),
            "advanceThreshold": round(self.advancement_threshold, 4),
            "objectiveAdvanced": self.objective_advanced,
            "masteryRecognised": self.mastery_recognised,
            "reason": self.reason,
            "canonicalEvidenceUsed": self.canonical_evidence_used,
            "cognitiveSignal": round(self.cognitive_signal, 4),
            "canonicalSignal": round(self.canonical_signal, 4) if self.canonical_signal is not None else None,
            "profileAdjustment": round(self.profile_adjustment, 4),
        }


class CognitiveProgressionEngine:
    """Chooses progression from bounded signals, never an LLM stage request.

    ``understanding``, ``confusion``, and ``engagement`` are the smoothed
    cognitive state after the turn.  The direct per-turn understanding signal
    stops one stale aggregate from advancing a learner on its own.  ``level``
    and ``knowledge_score`` are the learner-agent's accumulated profile and
    make a bounded, transparent threshold adjustment rather than inventing a
    separate personality score.
    """

    def __init__(self, policy: CognitivePolicy | None = None) -> None:
        self.policy = policy or CognitivePolicy()

    def apply(
        self,
        state: CognitiveProgressState,
        *,
        total_objectives: int,
        understanding: float,
        confusion: float,
        engagement: float,
        turn_understanding: float,
        agent_level: int,
        knowledge_score: float,
        concept_states: Iterable[ConceptEvidence] = (),
    ) -> CognitiveTransition:
        previous_mode = state.learning_mode
        old_index = state.objective_index
        final_index = max(0, total_objectives - 1)
        # Defensive normalisation keeps malformed/model-generated signals from
        # becoming a state transition. Inputs are normally fractions already.
        understanding = _fraction(understanding)
        confusion = _fraction(confusion)
        engagement = _fraction(engagement)
        turn_understanding = _fraction(turn_understanding)
        evidence = list(concept_states)
        canonical_evidence_used = bool(evidence)

        cognitive_score = (
            understanding * 0.52
            + turn_understanding * 0.20
            + (1.0 - confusion) * 0.20
            + engagement * 0.08
        )
        active_misconception = any(bool(item.misconception_active) for item in evidence)
        evidence_count = [max(0, int(item.evidence_count)) for item in evidence]
        canonical_score: float | None = None
        if evidence:
            canonical_score = fmean(
                _fraction(item.mastery) * 0.50
                + _fraction(item.retention) * 0.25
                + _fraction(item.evidence_confidence) * 0.25
                for item in evidence
            )
            # The reviewable state weighs more than a self-reported model
            # signal but does not erase the current turn's demonstrated
            # understanding.
            readiness = cognitive_score * 0.45 + canonical_score * 0.55
        else:
            readiness = cognitive_score
        readiness = round(_fraction(readiness), 4)

        level_adjustment = max(0, min(10, int(agent_level or 0)) - 1) * 0.008
        try:
            bounded_knowledge_score = max(0.0, min(float(knowledge_score or 0.0), 1_000.0))
        except (TypeError, ValueError):
            bounded_knowledge_score = 0.0
        knowledge_adjustment = bounded_knowledge_score / 25_000.0
        profile_adjustment = min(self.policy.maximum_profile_adjustment, level_adjustment + knowledge_adjustment)
        threshold = round(max(0.55, self.policy.advance_threshold - profile_adjustment), 4)
        mastery_threshold = min(0.98, threshold + self.policy.mastery_margin)
        needs_more_canonical_evidence = bool(evidence) and any(
            count < self.policy.minimum_canonical_evidence for count in evidence_count
        )
        low_retention = bool(evidence) and min(_fraction(item.retention) for item in evidence) < self.policy.low_retention
        blocked = active_misconception or confusion >= self.policy.high_confusion or needs_more_canonical_evidence or low_retention
        ready = readiness >= threshold and not blocked
        objective_advanced = ready and old_index < final_index
        mastery_recognised = ready and old_index >= final_index and readiness >= mastery_threshold

        if active_misconception:
            learning_mode, reason = "repair", "active_misconception"
        elif confusion >= self.policy.high_confusion:
            learning_mode, reason = "clarify", "high_confusion"
        elif needs_more_canonical_evidence:
            learning_mode, reason = "retrieve", "insufficient_reviewed_evidence"
        elif low_retention:
            learning_mode, reason = "retrieve", "low_retention"
        elif mastery_recognised:
            learning_mode, reason = "mastery_review", "mastery_threshold_met"
        elif objective_advanced:
            learning_mode, reason = "advance", "readiness_threshold_met"
        elif readiness >= threshold * 0.88:
            learning_mode, reason = "challenge", "near_advancement_threshold"
        else:
            learning_mode, reason = "practise", "more_evidence_needed"

        state.objective_index = min(final_index, old_index + (1 if objective_advanced else 0))
        state.learning_mode = learning_mode
        state.readiness = readiness
        state.advancement_threshold = threshold
        state.mastery_recognised = state.mastery_recognised or mastery_recognised
        state.decision_reason = reason
        return CognitiveTransition(
            learning_mode_changed=learning_mode != previous_mode,
            objective_advanced=objective_advanced,
            mastery_recognised=mastery_recognised,
            current_objective_index=state.objective_index,
            learning_mode=learning_mode,
            readiness=readiness,
            advancement_threshold=threshold,
            reason=reason,
            policy_version=self.policy.version,
            canonical_evidence_used=canonical_evidence_used,
            cognitive_signal=round(_fraction(cognitive_score), 4),
            canonical_signal=round(_fraction(canonical_score), 4) if canonical_score is not None else None,
            profile_adjustment=profile_adjustment,
        )


def _fraction(value: object) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if number > 1:
        number /= 100.0
    return max(0.0, min(1.0, number))
