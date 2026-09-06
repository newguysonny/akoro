"""Bounded live-session transcript for the adaptive teaching loop."""
from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from typing import Literal

TranscriptRole = Literal["human_teacher", "student_agent"]


@dataclass(slots=True)
class SessionTranscript:
    """Stores only a bounded conversation window; not durable learner memory."""

    max_messages: int = 120
    _items: list[dict[str, str]] = field(default_factory=list)

    def append(self, item: Mapping[str, str]) -> None:
        role = str(item.get("role") or "")
        content = str(item.get("content") or "").strip()
        if role not in {"human_teacher", "student_agent"} or not content:
            raise ValueError("Transcript entries require a teaching role and non-empty content")
        self._items.append({"role": role, "content": content})
        if len(self._items) > self.max_messages:
            del self._items[:len(self._items) - self.max_messages]

    def extend(self, items: Iterable[Mapping[str, str]]) -> None:
        for item in items:
            self.append(item)

    def recent(self, count: int) -> list[dict[str, str]]:
        return [dict(item) for item in self._items[-max(0, count):]]

    def snapshot(self) -> list[dict[str, str]]:
        return self.recent(self.max_messages)

    # Slice support keeps role prompts concise and makes the boundary explicit
    # when adapters need a transient list instead of a mutable session object.
    def __getitem__(self, item: int | slice):
        if isinstance(item, slice):
            return [dict(row) for row in self._items[item]]
        return dict(self._items[item])

    def __iter__(self) -> Iterator[dict[str, str]]:
        return iter(self.snapshot())

    def __len__(self) -> int:
        return len(self._items)
