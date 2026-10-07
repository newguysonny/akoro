"""In-process conversation memory with a bounded context window."""
from __future__ import annotations

from collections import deque
from typing import Iterable

from agent.llm.messages import Message


class ShortTermMemory:
    def __init__(self, max_messages: int = 16) -> None:
        if max_messages < 2:
            raise ValueError("max_messages must be at least 2")
        self._messages: deque[Message] = deque(maxlen=max_messages)

    def add(self, message: Message) -> None:
        # System prompts are supplied fresh by the loop and must not be retained.
        if message.role != "system":
            self._messages.append(message)

    def extend(self, messages: Iterable[Message]) -> None:
        for message in messages:
            self.add(message)

    def messages(self) -> tuple[Message, ...]:
        return tuple(self._messages)

    def clear(self) -> None:
        self._messages.clear()
