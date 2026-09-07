"""Typed, provider-independent values for an adaptive teaching session."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal
from uuid import uuid4

from agent.memory.conversation import LearnerConversationContext
from agent.memory.scratchpad import WorkingScratchpad
from agent.memory.session_memory import SessionTranscript
from agent.state.teaching_state import CognitiveProgressState

MAX_REFERENCE_CHARS = 12_000


def clamp(value: Any, low: float = 0.0, high: float = 1.0, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    # Models commonly return 0–100 despite a requested 0–1. Accept it safely.
    if number > 1 and high == 1:
        number /= 100
    return max(low, min(high, number))


@dataclass(frozen=True, slots=True)
class SessionReference:
    """Prompt-capped source material; raw text stays in the live session only."""

    name: str
    text: str
    chars: int
    truncated: bool

    @classmethod
    def from_payload(cls, value: dict[str, Any] | None) -> "SessionReference | None":
        if not isinstance(value, dict):
            return None
        original = str(value.get("text") or "").replace("\x00", "").replace("\r\n", "\n").strip()
        if not original:
            return None
        text = original[:MAX_REFERENCE_CHARS]
        name = str(value.get("name") or "reference").replace("\r", " ").replace("\n", " ").strip()[:180] or "reference"
        return cls(name=name, text=text, chars=len(text), truncated=bool(value.get("truncated")) or len(original) > len(text))

    def metadata(self) -> dict[str, Any]:
        return {"name": self.name, "chars": self.chars, "truncated": self.truncated}


@dataclass(slots=True)
class CognitiveState:
    understanding: float = 0.15
    confusion: float = 0.30
    engagement: float = 0.60

    def as_percentages(self) -> dict[str, int]:
        return {
            "understanding": round(self.understanding * 100),
            "confusion": round(self.confusion * 100),
            "engagement": round(self.engagement * 100),
        }


@dataclass(frozen=True, slots=True)
class LearningAnalysis:
    understanding: float
    confusion: float
    engagement: float
    misconception_detected: str | None = None
    misconception_cleared: bool = False
    new_concept_learned: str | None = None
    prior_knowledge_used: bool = False
    strengths: tuple[str, ...] = ()

    @classmethod
    def from_model(cls, value: dict[str, Any]) -> "LearningAnalysis":
        misconception = value.get("misconceptionDetected") or value.get("misconception_detected")
        concept = value.get("newConceptLearned") or value.get("new_concept_learned")
        strengths = value.get("strengths") if isinstance(value.get("strengths"), list) else []
        return cls(
            understanding=clamp(value.get("understanding"), default=0.15),
            confusion=clamp(value.get("confusion"), default=0.30),
            engagement=clamp(value.get("engagement"), default=0.60),
            misconception_detected=str(misconception).strip()[:300] if misconception else None,
            misconception_cleared=bool(value.get("misconceptionCleared") or value.get("misconception_cleared")),
            new_concept_learned=str(concept).strip()[:300] if concept else None,
            prior_knowledge_used=bool(value.get("priorKnowledgeUsed") or value.get("prior_knowledge_used")),
            strengths=tuple(str(item).strip()[:300] for item in strengths if str(item).strip())[:5],
        )


@dataclass(slots=True)
class AgentProfile:
    id: str
    student_id: str
    name: str = "Student Agent"
    level: int = 1
    total_sessions: int = 0
    knowledge_score: float = 0.0


@dataclass(frozen=True, slots=True)
class KnowledgeChunk:
    agent_id: str
    student_id: str
    topic: str
    subject: str | None
    content: str
    chunk_type: str
    confidence: float
    session_id: str


@dataclass(frozen=True, slots=True)
class LessonStep:
    title: str
    kind: Literal["foundation", "mechanism", "application", "synthesis"]
    builds_on: int | None
    why_now: str = ""

    def public(self) -> dict[str, Any]:
        return {"title": self.title, "kind": self.kind, "buildsOn": self.builds_on, "whyNow": self.why_now}


@dataclass(slots=True)
class AdaptiveSession:
    session_id: str = field(default_factory=lambda: str(uuid4()))
    student_id: str = ""
    topic: str = ""
    subject: str | None = None
    session_type: Literal["free_teaching", "continuation", "decay_review"] = "free_teaching"
    teacher_agent_id: str | None = None
    # Canonical concept tracking is available only for an explicit reviewed
    # curriculum/topic scope supplied by Akoro's trusted bridge. Free text is
    # not enough to select a durable curriculum catalogue.
    curriculum_key: str | None = None
    topic_key: str | None = None
    # Opaque, signed-by-Akoro context. Python stores and relays this only; it
    # never treats browser-provided identity fields as tool authority.
    tool_context: str | None = None
    progress: CognitiveProgressState = field(default_factory=CognitiveProgressState)
    must_know_parts: list[str] = field(default_factory=list)
    knowledge_map: list[LessonStep] = field(default_factory=list)
    # The adaptive transcript records this service's teaching exchanges. A
    # separate user/assistant transcript is restored from Akoro API when a
    # trusted bridge attaches a durable learner conversation to this session.
    history: SessionTranscript = field(default_factory=SessionTranscript)
    # Working state is deliberately structured, compact, and separate from the
    # raw user/assistant transcript. It persists per conversation only through
    # the authorised Akoro API gateway.
    scratchpad: WorkingScratchpad | None = None
    conversation_id: str | None = None
    conversation: LearnerConversationContext | None = None
    reference: SessionReference | None = None
    knowledge_buffer: list[KnowledgeChunk] = field(default_factory=list)
    turns_completed: int = 0
    xp_earned: int = 0
    concepts_learned: list[str] = field(default_factory=list)
    misconceptions_cleared: list[str] = field(default_factory=list)
