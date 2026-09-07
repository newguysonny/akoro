"""Persistence seam for the adaptive agent service.

The local implementation is deliberately evaluation-only.  It models the
canonical concept/evidence contract in memory so its deterministic transition
policy can be tested before an Akoro API-backed repository is introduced.
Python never needs direct database credentials.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from typing import Iterable, Protocol
from uuid import uuid4

from .concepts import (
    ConceptObservation,
    ConceptStatePolicy,
    CurriculumConcept,
    LearnerConceptState,
    canonical_key,
)
from .types import AgentProfile, CognitiveState, KnowledgeChunk, LearningAnalysis


class LearningRepository(Protocol):
    def get_or_create_agent(self, student_id: str) -> AgentProfile: ...
    def get_cognitive_state(self, agent_id: str, topic: str) -> CognitiveState: ...
    def update_cognitive_state(self, agent_id: str, topic: str, analysis: LearningAnalysis) -> CognitiveState: ...
    def retrieve_context(self, agent_id: str, student_id: str, topic: str, subject: str | None, query: str, limit: int = 8) -> list[KnowledgeChunk]: ...
    def save_agent_knowledge(self, chunks: list[KnowledgeChunk]) -> int: ...
    def save_student_strengths(self, agent_id: str, student_id: str, topic: str, subject: str | None, strengths: tuple[str, ...]) -> int: ...
    def finish_session(self, agent_id: str, turns: int, xp_earned: int, knowledge_added: int) -> AgentProfile: ...

    # Canonical concept-state vertical slice. Implementations must return only
    # approved, curriculum-scoped concepts. A model cannot create a concept by
    # mentioning a title in chat.
    def resolve_active_concepts(self, student_id: str, subject: str | None, topic: str, limit: int = 8) -> list[CurriculumConcept]: ...
    def get_learner_concept_states(self, student_id: str, concept_ids: Iterable[str]) -> list[LearnerConceptState]: ...
    def record_concept_observations(
        self, student_id: str, session_id: str, turn_id: str, observations: Iterable[ConceptObservation],
    ) -> list[LearnerConceptState]: ...


class InMemoryLearningRepository:
    """Evaluation/dev implementation. All data disappears when the process stops.

    It intentionally mirrors only the *policy* of the canonical contract.
    Production storage belongs to the Akoro API/Postgres gateway, including the
    immutable evidence ledger and durable idempotency constraints.
    """

    def __init__(self, concepts: Iterable[CurriculumConcept] = ()) -> None:
        self._agents_by_student: dict[str, AgentProfile] = {}
        self._states: dict[tuple[str, str], CognitiveState] = {}
        self._agent_knowledge: list[KnowledgeChunk] = []
        self._student_strengths: dict[tuple[str, str], list[str]] = defaultdict(list)
        self._concept_catalog = {concept.id: deepcopy(concept) for concept in concepts}
        self._concept_states: dict[tuple[str, str], LearnerConceptState] = {}
        self._concept_evidence_keys: set[tuple[str, str, str, str]] = set()
        self._concept_policy = ConceptStatePolicy()

    def get_or_create_agent(self, student_id: str) -> AgentProfile:
        profile = self._agents_by_student.get(student_id)
        if profile is None:
            profile = AgentProfile(id=str(uuid4()), student_id=student_id)
            self._agents_by_student[student_id] = profile
        return deepcopy(profile)

    def get_cognitive_state(self, agent_id: str, topic: str) -> CognitiveState:
        return deepcopy(self._states.get((agent_id, topic), CognitiveState()))

    def update_cognitive_state(self, agent_id: str, topic: str, analysis: LearningAnalysis) -> CognitiveState:
        # Legacy compatibility for the current standalone teaching surface. The
        # canonical concept condition, when available, is kept separately and
        # never translates the historic percentage fields silently.
        previous = self.get_cognitive_state(agent_id, topic)
        current = CognitiveState(
            understanding=round(previous.understanding * 0.45 + analysis.understanding * 0.55, 4),
            confusion=round(previous.confusion * 0.45 + analysis.confusion * 0.55, 4),
            engagement=round(previous.engagement * 0.45 + analysis.engagement * 0.55, 4),
        )
        self._states[(agent_id, topic)] = current
        return deepcopy(current)

    def retrieve_context(self, agent_id: str, student_id: str, topic: str, subject: str | None, query: str, limit: int = 8) -> list[KnowledgeChunk]:
        tokens = {token.lower() for token in f"{topic} {query}".split() if len(token) > 2}
        candidates = [chunk for chunk in self._agent_knowledge if chunk.agent_id == agent_id and (not subject or not chunk.subject or chunk.subject == subject)]
        scored = sorted(candidates, key=lambda chunk: len(tokens.intersection(chunk.content.lower().split())), reverse=True)
        return deepcopy(scored[:max(0, min(limit, 12))])

    def save_agent_knowledge(self, chunks: list[KnowledgeChunk]) -> int:
        self._agent_knowledge.extend(deepcopy(chunks))
        return len(chunks)

    def save_student_strengths(self, agent_id: str, student_id: str, topic: str, subject: str | None, strengths: tuple[str, ...]) -> int:
        key = (student_id, topic)
        existing = self._student_strengths[key]
        for strength in strengths:
            if strength not in existing:
                existing.append(strength)
        return len(strengths)

    def finish_session(self, agent_id: str, turns: int, xp_earned: int, knowledge_added: int) -> AgentProfile:
        for _student_id, profile in self._agents_by_student.items():
            if profile.id == agent_id:
                profile.total_sessions += 1
                profile.knowledge_score += knowledge_added * 5
                profile.level = max(1, min(10, 1 + int(profile.knowledge_score // 100)))
                return deepcopy(profile)
        raise KeyError(f"Agent {agent_id} does not exist")

    def resolve_active_concepts(self, student_id: str, subject: str | None, topic: str, limit: int = 8) -> list[CurriculumConcept]:
        """Return only seeded reviewed concepts matching the exact study scope."""
        subject_key, topic_key = canonical_key(subject), canonical_key(topic)
        concepts = [
            concept for concept in self._concept_catalog.values()
            if (not subject_key or canonical_key(concept.subject) == subject_key)
            and canonical_key(concept.topic_key) == topic_key
        ]
        return deepcopy(sorted(concepts, key=lambda item: (item.code, item.id))[:max(0, min(limit, 8))])

    def get_learner_concept_states(self, student_id: str, concept_ids: Iterable[str]) -> list[LearnerConceptState]:
        states = [self._concept_states.get((student_id, str(identifier)), LearnerConceptState(str(identifier))) for identifier in concept_ids]
        return deepcopy(states)

    def record_concept_observations(
        self, student_id: str, session_id: str, turn_id: str, observations: Iterable[ConceptObservation],
    ) -> list[LearnerConceptState]:
        """Apply at most one valid observation per active concept and turn.

        The key mirrors Postgres' `(learner, session, turn, concept)` unique
        constraint. Replaying a completed turn returns the same current state
        rather than compounding a model score.
        """
        changed: list[LearnerConceptState] = []
        now = datetime.now(timezone.utc)
        for observation in observations:
            if observation.concept_id not in self._concept_catalog:
                continue
            key = (student_id, session_id, turn_id, observation.concept_id)
            previous = self._concept_states.get((student_id, observation.concept_id), LearnerConceptState(observation.concept_id))
            if key in self._concept_evidence_keys:
                changed.append(previous)
                continue
            self._concept_evidence_keys.add(key)
            transition = self._concept_policy.apply(previous, observation, observed_at=now)
            # `not_checked` evidence is ledger-only in Postgres. Mirror that
            # here: do not materialise even a zero local projection.
            if transition.applied:
                self._concept_states[(student_id, observation.concept_id)] = transition.state
            changed.append(transition.state)
        return deepcopy(changed)
