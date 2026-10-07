"""Learning repository decorator that moves canonical concept state to Akoro API."""
from __future__ import annotations

from typing import Iterable

from .akoro_concept_state import AkoroConceptStateSession
from .concepts import ConceptObservation, CurriculumConcept, LearnerConceptState
from .repository import LearningRepository
from .types import AgentProfile, CognitiveState, KnowledgeChunk, LearningAnalysis


class AkoroConceptLearningRepository:
    """Delegate legacy evaluation seams, but make concept state Akoro-owned.

    This is intentionally a decorator instead of a broad database port. The
    pre-existing Python service can retain its isolated evaluation repository
    while this one bounded vertical slice uses the authenticated Akoro API.
    """

    def __init__(self, fallback: LearningRepository, concept_session: AkoroConceptStateSession) -> None:
        self._fallback = fallback
        self._concept_session = concept_session

    def get_or_create_agent(self, student_id: str) -> AgentProfile:
        return self._fallback.get_or_create_agent(student_id)

    def get_cognitive_state(self, agent_id: str, topic: str) -> CognitiveState:
        return self._fallback.get_cognitive_state(agent_id, topic)

    def update_cognitive_state(self, agent_id: str, topic: str, analysis: LearningAnalysis) -> CognitiveState:
        return self._fallback.update_cognitive_state(agent_id, topic, analysis)

    def retrieve_context(self, agent_id: str, student_id: str, topic: str, subject: str | None, query: str, limit: int = 8) -> list[KnowledgeChunk]:
        return self._fallback.retrieve_context(agent_id, student_id, topic, subject, query, limit)

    def save_agent_knowledge(self, chunks: list[KnowledgeChunk]) -> int:
        return self._fallback.save_agent_knowledge(chunks)

    def save_student_strengths(self, agent_id: str, student_id: str, topic: str, subject: str | None, strengths: tuple[str, ...]) -> int:
        return self._fallback.save_student_strengths(agent_id, student_id, topic, subject, strengths)

    def finish_session(self, agent_id: str, turns: int, xp_earned: int, knowledge_added: int) -> AgentProfile:
        return self._fallback.finish_session(agent_id, turns, xp_earned, knowledge_added)

    def resolve_active_concepts(self, student_id: str, subject: str | None, topic: str, limit: int = 8) -> list[CurriculumConcept]:
        # Scope was already fixed in the session-bound capability and explicit
        # curriculum/topic keys when this decorator was constructed.
        return self._concept_session.resolve_active_concepts()[:max(0, min(limit, 8))]

    def get_learner_concept_states(self, student_id: str, concept_ids: Iterable[str]) -> list[LearnerConceptState]:
        return self._concept_session.snapshot(concept_ids)

    def record_concept_observations(
        self, student_id: str, session_id: str, turn_id: str, observations: Iterable[ConceptObservation],
    ) -> list[LearnerConceptState]:
        # Akoro checks the capability-bound learner and source session itself.
        # Do not forward a claimed browser/student identity to the gateway.
        return self._concept_session.record(turn_id, observations)
