"""Bounded, learner-scoped conversation context for the Python agent.

Akoro API remains the durable owner of these records.  This module only holds
an already-authorised snapshot for the lifetime of one Python session and
turns it into correctly-role-labelled LLM input.  Conversation text and memory
are data, not system instructions.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping

from agent.llm.messages import Message
from agent.memory.scratchpad import WorkingScratchpad

ConversationRole = Literal["user", "assistant"]
MemoryKind = Literal["learning_summary", "study_preference", "learner_goal"]

MAX_CONVERSATION_MESSAGES = 40
MAX_CONVERSATION_MESSAGE_CHARS = 12_000
MAX_LLM_HISTORY_MESSAGES = 24
MAX_LLM_HISTORY_CHARS = 24_000
MAX_CONVERSATION_SUMMARY_CHARS = 4_000
MAX_MEMORY_ITEMS = 8
MAX_MEMORY_CHARS = 1_500


def _text(value: Any, maximum: int) -> str:
    return str(value or "").replace("\x00", "").replace("\r\n", "\n").strip()[:maximum]


@dataclass(frozen=True, slots=True)
class ConversationMessage:
    """One durable user/assistant exchange, normalised for a model transcript."""

    role: ConversationRole
    content: str
    created_at: str | None = None

    @classmethod
    def from_wire(cls, value: Mapping[str, Any]) -> "ConversationMessage | None":
        role = str(value.get("role") or "").strip().lower()
        # The current public Akoro chat schema calls assistant messages `agent`.
        if role == "agent":
            role = "assistant"
        if role not in {"user", "assistant"}:
            return None
        content = _text(value.get("content", value.get("text")), MAX_CONVERSATION_MESSAGE_CHARS)
        if not content:
            return None
        created_at = _text(value.get("createdAt", value.get("created_at")), 64) or None
        return cls(role=role, content=content, created_at=created_at)  # type: ignore[arg-type]

    def as_llm_message(self) -> Message:
        return Message.user(self.content) if self.role == "user" else Message.assistant(self.content)


@dataclass(frozen=True, slots=True)
class LearnerMemory:
    """A compact, user-clearable study note; never a substitute for raw history."""

    id: str
    kind: MemoryKind
    content: str
    topic: str | None = None
    subject: str | None = None

    @classmethod
    def from_wire(cls, value: Mapping[str, Any]) -> "LearnerMemory | None":
        kind = str(value.get("kind") or "").strip()
        if kind not in {"learning_summary", "study_preference", "learner_goal"}:
            return None
        content = _text(value.get("content"), MAX_MEMORY_CHARS)
        if not content:
            return None
        return cls(
            id=_text(value.get("id"), 80),
            kind=kind,  # type: ignore[arg-type]
            content=content,
            topic=_text(value.get("topic"), 180) or None,
            subject=_text(value.get("subject"), 180) or None,
        )

    def prompt_line(self) -> str:
        labels = {
            "learning_summary": "Study note",
            "study_preference": "Learner preference",
            "learner_goal": "Learner goal",
        }
        scope = ", ".join(part for part in [self.subject, self.topic] if part)
        return f"- {labels[self.kind]}{f' ({scope})' if scope else ''}: {self.content}"


@dataclass(slots=True)
class LearnerConversationContext:
    """A bounded durable-context snapshot attached to an active Python session."""

    conversation_id: str
    title: str | None = None
    summary: str | None = None
    messages: list[ConversationMessage] = field(default_factory=list)
    memories: list[LearnerMemory] = field(default_factory=list)
    scratchpad: WorkingScratchpad | None = None
    restored_message_count: int = 0

    @classmethod
    def from_wire(cls, value: Mapping[str, Any], expected_conversation_id: str) -> "LearnerConversationContext":
        conversation_id = _text(value.get("conversationId", value.get("conversation_id")), 80)
        if not conversation_id or conversation_id != expected_conversation_id:
            raise ValueError("Akoro conversation context did not match the requested conversation")
        raw_messages = value.get("messages")
        messages: list[ConversationMessage] = []
        if isinstance(raw_messages, list):
            for item in raw_messages[-MAX_CONVERSATION_MESSAGES:]:
                if isinstance(item, Mapping):
                    parsed = ConversationMessage.from_wire(item)
                    if parsed:
                        messages.append(parsed)
        raw_memories = value.get("memories", value.get("memory", []))
        memories: list[LearnerMemory] = []
        if isinstance(raw_memories, list):
            for item in raw_memories[:MAX_MEMORY_ITEMS]:
                if isinstance(item, Mapping):
                    parsed = LearnerMemory.from_wire(item)
                    if parsed:
                        memories.append(parsed)
        summary = _text(value.get("summary"), MAX_CONVERSATION_SUMMARY_CHARS) or None
        # Topic is not part of the wire envelope deliberately; the session
        # creates a topic-aware initial scratchpad after hydration when none
        # has previously been stored for this conversation.
        raw_scratchpad = value.get("scratchpad")
        scratchpad = WorkingScratchpad.from_wire(raw_scratchpad, topic="the current learning goal") if isinstance(raw_scratchpad, Mapping) else None
        return cls(
            conversation_id=conversation_id,
            title=_text(value.get("title"), 180) or None,
            summary=summary,
            messages=messages,
            memories=memories,
            scratchpad=scratchpad,
            restored_message_count=len(messages),
        )

    def append_turn(self, user_message: str, assistant_message: str) -> None:
        self.messages.extend((
            ConversationMessage("user", _text(user_message, MAX_CONVERSATION_MESSAGE_CHARS)),
            ConversationMessage("assistant", _text(assistant_message, MAX_CONVERSATION_MESSAGE_CHARS)),
        ))
        if len(self.messages) > MAX_CONVERSATION_MESSAGES:
            del self.messages[:len(self.messages) - MAX_CONVERSATION_MESSAGES]

    def history_for_llm(self) -> list[Message]:
        """Return role-correct history within one explicit total character budget."""
        chosen: list[ConversationMessage] = []
        remaining = MAX_LLM_HISTORY_CHARS
        for item in reversed(self.messages[-MAX_LLM_HISTORY_MESSAGES:]):
            if remaining <= 0:
                break
            content = item.content[-min(len(item.content), remaining):]
            if content:
                chosen.append(ConversationMessage(item.role, content, item.created_at))
                remaining -= len(content)
        return [item.as_llm_message() for item in reversed(chosen)]

    def memory_for_prompt(self) -> str:
        if not self.memories:
            return "No saved learner study notes are available."
        return "\n".join(memory.prompt_line() for memory in self.memories)

    def public_metadata(self, *, persistence: str = "active") -> dict[str, Any]:
        return {
            "conversationId": self.conversation_id,
            "title": self.title,
            "restoredMessages": self.restored_message_count,
            "savedMemoryNotes": len(self.memories),
            "hasSummary": bool(self.summary),
            "hasScratchpad": self.scratchpad is not None,
            "persistence": persistence,
        }


@dataclass(frozen=True, slots=True)
class ConversationMemoryUpdate:
    """Bounded non-raw context emitted after one completed teaching turn."""

    summary: str
    scratchpad: WorkingScratchpad
    memories: tuple[dict[str, str], ...] = ()

    def wire(self) -> dict[str, Any]:
        return {
            "summary": self.summary,
            "scratchpad": self.scratchpad.wire(),
            "memories": [dict(item) for item in self.memories],
        }
