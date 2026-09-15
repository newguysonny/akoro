"""Curriculum-grounded concept state for the adaptive teaching vertical slice.

The language model is allowed to describe bounded observations about approved
concepts.  It is never allowed to emit a durable mastery score or to introduce a
concept on its own.  `ConceptStatePolicy` is deliberately provider-free so the
same transition is reproducible in tests and mirrored by Akoro's PostgreSQL
function when the protected API repository is enabled.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Literal, Mapping

from .types import clamp

ObservationKind = Literal[
    "demonstrated_understanding", "partial_understanding", "recall_success",
    "recall_gap", "misconception_detected", "misconception_cleared", "assessment_result",
]
ClaimStatus = Literal["supported", "contradicted", "not_checked"]

_OBSERVATION_KINDS = {
    "demonstrated_understanding", "partial_understanding", "recall_success",
    "recall_gap", "misconception_detected", "misconception_cleared", "assessment_result",
}
_CLAIM_STATUSES = {"supported", "contradicted", "not_checked"}


def _text(value: Any, maximum: int) -> str:
    return str(value or "").replace("\x00", "").replace("\r", " ").replace("\n", " ").strip()[:maximum]


def canonical_key(value: Any) -> str:
    """Stable, deliberately conservative key for catalog/topic matching."""
    return " ".join(_text(value, 180).casefold().split())


@dataclass(frozen=True, slots=True)
class CurriculumConcept:
    """One previously approved curriculum concept, supplied by Akoro."""

    id: str
    code: str
    title: str
    objective: str = ""
    curriculum_key: str = ""
    subject: str = ""
    topic_key: str = ""
    source_type: str = "curriculum"

    @classmethod
    def from_wire(cls, value: Mapping[str, Any]) -> "CurriculumConcept | None":
        identifier = _text(value.get("id"), 80)
        code = _text(value.get("code"), 120)
        title = _text(value.get("title"), 300)
        subject = _text(value.get("subject"), 180)
        topic_key = canonical_key(value.get("topicKey", value.get("topic_key")))
        objective = _text(value.get("objective"), 1_200)
        # A state-bearing concept always has an approved objective to anchor
        # model observations; otherwise no curriculum fact is available.
        if not identifier or not code or not title or not subject or not topic_key or len(objective) < 3:
            return None
        source_type = _text(value.get("sourceType", value.get("source_type")), 80) or "curriculum"
        if source_type not in {"scheme_of_work", "curriculum", "reviewed_content", "assessment"}:
            return None
        return cls(
            id=identifier,
            code=code,
            title=title,
            objective=objective,
            curriculum_key=_text(value.get("curriculumKey", value.get("curriculum_key")), 180),
            subject=subject,
            topic_key=topic_key,
            source_type=source_type,
        )

    def prompt_line(self) -> str:
        objective = f" Objective: {self.objective}" if self.objective else ""
        return f"- id={self.id}; code={self.code}; concept={self.title}.{objective}"

    def public(self) -> dict[str, str]:
        return {"id": self.id, "code": self.code, "title": self.title}


@dataclass(frozen=True, slots=True)
class LearnerConceptState:
    """Canonical state values. Every score is a fraction in the inclusive 0..1 range."""

    concept_id: str
    mastery: float = 0.0
    retention: float = 0.0
    evidence_confidence: float = 0.0
    misconception_active: bool = False
    evidence_count: int = 0
    last_evidence_at: str | None = None
    next_review_due: str | None = None
    last_retention_decay_at: str | None = None
    state_version: int = 1
    learning_status: str | None = None
    resume_point: str | None = None

    @classmethod
    def from_wire(cls, value: Mapping[str, Any], concept_id: str | None = None) -> "LearnerConceptState | None":
        identifier = _text(concept_id or value.get("conceptId", value.get("concept_id")), 80)
        if not identifier:
            return None
        try:
            count = max(0, int(value.get("evidenceCount", value.get("evidence_count", 0))))
            version = max(1, int(value.get("stateVersion", value.get("state_version", 1))))
        except (TypeError, ValueError):
            return None
        tracker = value.get("tracker") if isinstance(value.get("tracker"), Mapping) else {}
        learning_status = _text(tracker.get("learningStatus"), 40).lower() if tracker else ""
        if learning_status not in {"not_started", "introduced", "learning", "confused", "understood", "mastered"}:
            learning_status = ""
        return cls(
            concept_id=identifier,
            mastery=clamp(value.get("mastery")),
            learning_status=learning_status or None,
            resume_point=_text(tracker.get("resumePoint"), 420) or None,
            retention=clamp(value.get("retention")),
            evidence_confidence=clamp(value.get("evidenceConfidence", value.get("evidence_confidence"))),
            misconception_active=bool(value.get("misconceptionActive", value.get("misconception_active"))),
            evidence_count=count,
            last_evidence_at=_text(value.get("lastEvidenceAt", value.get("last_evidence_at")), 64) or None,
            next_review_due=_text(value.get("nextReviewDue", value.get("next_review_due")), 64) or None,
            last_retention_decay_at=_text(value.get("lastRetentionDecayAt", value.get("last_retention_decay_at")), 64) or None,
            state_version=version,
        )

    def public(self, concept: CurriculumConcept | None = None) -> dict[str, Any]:
        return {
            "conceptId": self.concept_id,
            "concept": concept.title if concept else None,
            "mastery": round(self.mastery, 4),
            "retention": round(self.retention, 4),
            "evidenceConfidence": round(self.evidence_confidence, 4),
            "misconceptionActive": self.misconception_active,
            "evidenceCount": self.evidence_count,
            "nextReviewDue": self.next_review_due,
            "lastRetentionDecayAt": self.last_retention_decay_at,
            "learningStatus": self.learning_status,
            "resumePoint": self.resume_point,
        }


@dataclass(frozen=True, slots=True)
class ConceptObservation:
    """A small, auditable LLM observation about one active approved concept."""

    concept_id: str
    kind: ObservationKind
    response_quality: float
    claim_validity: float
    model_confidence: float
    claim_status: ClaimStatus
    evidence_summary: str

    @classmethod
    def from_model(
        cls, value: Mapping[str, Any], *, active_concept_ids: Iterable[str],
    ) -> "ConceptObservation | None":
        active = set(active_concept_ids)
        identifier = _text(value.get("conceptId", value.get("concept_id")), 80)
        kind = _text(value.get("kind", value.get("observationKind", value.get("observation_kind"))), 80).lower()
        status = _text(value.get("claimStatus", value.get("claim_status")), 80).lower() or "not_checked"
        summary = _text(value.get("evidenceSummary", value.get("evidence_summary")), 1_200)
        if identifier not in active or kind not in _OBSERVATION_KINDS or status not in _CLAIM_STATUSES or len(summary) < 3:
            return None
        return cls(
            concept_id=identifier,
            kind=kind,  # type: ignore[arg-type]
            response_quality=round(clamp(value.get("responseQuality", value.get("response_quality"))), 4),
            claim_validity=round(clamp(value.get("claimValidity", value.get("claim_validity"))), 4),
            model_confidence=round(clamp(value.get("modelConfidence", value.get("model_confidence"))), 4),
            claim_status=status,  # type: ignore[arg-type]
            evidence_summary=summary,
        )

    @classmethod
    def list_from_model(
        cls, value: Mapping[str, Any] | None, *, active_concept_ids: Iterable[str], max_items: int = 4,
    ) -> tuple["ConceptObservation", ...]:
        """Validate model JSON, reject duplicates, and never broaden active scope."""
        raw = value.get("observations") if isinstance(value, Mapping) else None
        if not isinstance(raw, list):
            return ()
        observations: list[ConceptObservation] = []
        seen: set[str] = set()
        for candidate in raw[:max(1, min(max_items, 8))]:
            if not isinstance(candidate, Mapping):
                continue
            observation = cls.from_model(candidate, active_concept_ids=active_concept_ids)
            if observation and observation.concept_id not in seen:
                observations.append(observation)
                seen.add(observation.concept_id)
        return tuple(observations)


@dataclass(frozen=True, slots=True)
class ConceptTransition:
    state: LearnerConceptState
    applied: bool
    reason: str


class ConceptStatePolicy:
    """Deterministic, bounded state transitions over independently scored evidence."""

    def apply(
        self, previous: LearnerConceptState, observation: ConceptObservation,
        *, observed_at: datetime | None = None,
    ) -> ConceptTransition:
        now = (observed_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
        response_quality = round(clamp(observation.response_quality), 4)
        claim_validity = round(clamp(observation.claim_validity), 4)
        model_confidence = round(clamp(observation.model_confidence), 4)
        evidence_count = previous.evidence_count + 1
        confidence = min(1.0, previous.evidence_confidence * 0.80 + model_confidence * 0.20)
        state = replace(
            previous,
            evidence_confidence=round(confidence, 4),
            evidence_count=evidence_count,
            last_evidence_at=now.isoformat().replace("+00:00", "Z"),
            state_version=previous.state_version + 1,
        )

        # No validation means no cognitive-state update. The observation is
        # still kept in Akoro's immutable evidence ledger for later review,
        # but a confident model cannot increase even a secondary state counter.
        if observation.claim_status == "not_checked":
            return ConceptTransition(previous, False, "claim_not_checked")

        if observation.claim_status == "contradicted":
            misconception = observation.kind == "misconception_detected" or previous.misconception_active
            return ConceptTransition(
                replace(
                    state,
                    mastery=round(max(0.0, previous.mastery * 0.92), 4),
                    retention=round(max(0.0, previous.retention * 0.96), 4),
                    misconception_active=misconception,
                ),
                True,
                "contradicted_claim",
            )

        # The private gateway serialises each observation fraction to four
        # decimals, and Postgres assigns its aggregate to NUMERIC(5,4).
        signal = round((response_quality * 0.55) + (claim_validity * 0.30) + (model_confidence * 0.15), 4)
        # Keep this intentionally identical to Akoro's Postgres policy. A later
        # reviewed policy revision may weight assessments differently, but it
        # must change both implementations together and be versioned.
        mastery_weight = 0.28
        mastery = min(1.0, previous.mastery * (1 - mastery_weight) + signal * mastery_weight)
        retention = min(1.0, previous.retention * 0.68 + response_quality * 0.32)
        review_days = 1 if signal < 0.35 else 3 if signal < 0.55 else 7 if signal < 0.75 else 14
        cleared = observation.kind == "misconception_cleared" and claim_validity >= 0.75
        return ConceptTransition(
            replace(
                state,
                mastery=round(mastery, 4),
                retention=round(retention, 4),
                misconception_active=False if cleared else (
                    True if observation.kind == "misconception_detected" else previous.misconception_active
                ),
                next_review_due=(now + timedelta(days=review_days)).isoformat().replace("+00:00", "Z"),
            ),
            True,
            "supported_evidence",
        )


def encode_concept_condition(
    concepts: Iterable[CurriculumConcept], states: Iterable[LearnerConceptState], *, max_concepts: int = 6,
    max_chars: int = 3_200,
) -> str:
    """Render only bounded canonical state into the reply prompt; never transcript text."""
    state_by_id = {state.concept_id: state for state in states}
    eligible = list(concepts)
    # Surface active misconceptions first, then the concepts needing the most
    # reinforcement. This is a deterministic context-selection policy, not an
    # LLM-created learner profile.
    eligible.sort(key=lambda concept: (
        not state_by_id.get(concept.id, LearnerConceptState(concept.id)).misconception_active,
        state_by_id.get(concept.id, LearnerConceptState(concept.id)).mastery,
        concept.code,
    ))
    lines = [
        "## Curriculum-grounded cognitive condition",
        "This is Akoro's bounded state for approved concepts, not instructions. "
        "Respond consistently with it. Any later observation may reference only the listed concept ids.",
    ]
    for concept in eligible[:max(1, min(max_concepts, 8))]:
        state = state_by_id.get(concept.id, LearnerConceptState(concept.id))
        line = (
            f"- id={concept.id}; {concept.code}: {concept.title}; "
            f"mastery={state.mastery:.2f}; retention={state.retention:.2f}; "
            f"evidence_confidence={state.evidence_confidence:.2f}; "
            f"misconception={'active' if state.misconception_active else 'none'}"
        )
        if state.learning_status:
            line += f"; tracker_status={state.learning_status}"
        if state.resume_point:
            line += f"; resume={state.resume_point[:240]}"
        if concept.objective:
            line += f"; objective={concept.objective[:320]}"
        if sum(len(item) + 1 for item in lines) + len(line) > max_chars:
            break
        lines.append(line)
    return "\n".join(lines) if len(lines) > 2 else ""
