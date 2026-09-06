"""Persistence seam for the adaptive agent service.

The local implementation makes the service runnable and testable without
sharing database credentials. The protocol is the stable boundary an Akoro API
adapter will implement later: Python never needs direct Supabase access.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from typing import Protocol
from uuid import uuid4

from .types import AgentProfile, CognitiveState, KnowledgeChunk, LearningAnalysis


class LearningRepository(Protocol):
    def get_or_create_agent(self, student_id: str) -> AgentProfile: ...
    def get_cognitive_state(self, agent_id: str, topic: str) -> CognitiveState: ...
    def update_cognitive_state(self, agent_id: str, topic: str, analysis: LearningAnalysis) -> CognitiveState: ...
    def retrieve_context(self, agent_id: str, student_id: str, topic: str, subject: str | None, query: str, limit: int = 8) -> list[KnowledgeChunk]: ...
    def save_agent_knowledge(self, chunks: list[KnowledgeChunk]) -> int: ...
    def save_student_strengths(self, agent_id: str, student_id: str, topic: str, subject: str | None, strengths: tuple[str, ...]) -> int: ...
    def finish_session(self, agent_id: str, turns: int, xp_earned: int, knowledge_added: int) -> AgentProfile: ...


class InMemoryLearningRepository:
    """Evaluation/dev implementation. All data disappears when the process stops."""

    def __init__(self) -> None:
        self._agents_by_student: dict[str, AgentProfile] = {}
        self._states: dict[tuple[str, str], CognitiveState] = {}
        self._agent_knowledge: list[KnowledgeChunk] = []
        self._student_strengths: dict[tuple[str, str], list[str]] = defaultdict(list)

    def get_or_create_agent(self, student_id: str) -> AgentProfile:
        profile = self._agents_by_student.get(student_id)
        if profile is None:
            profile = AgentProfile(id=str(uuid4()), student_id=student_id)
            self._agents_by_student[student_id] = profile
        return deepcopy(profile)

    def get_cognitive_state(self, agent_id: str, topic: str) -> CognitiveState:
        return deepcopy(self._states.get((agent_id, topic), CognitiveState()))

    def update_cognitive_state(self, agent_id: str, topic: str, analysis: LearningAnalysis) -> CognitiveState:
        # Smooth rather than replace scores: one unusually terse turn should not
        # make a learner's durable learning state jump from 80% to 10%.
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
        for student_id, profile in self._agents_by_student.items():
            if profile.id == agent_id:
                profile.total_sessions += 1
                profile.knowledge_score += knowledge_added * 5
                profile.level = max(1, min(10, 1 + int(profile.knowledge_score // 100)))
                return deepcopy(profile)
        raise KeyError(f"Agent {agent_id} does not exist")
