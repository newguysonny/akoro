"""Domain reasoning objects for adaptive teaching, without provider calls."""
from __future__ import annotations

from dataclasses import dataclass

from agent.adaptive.types import LessonStep


@dataclass(frozen=True, slots=True)
class TeachingPlan:
    topic: str
    subject: str | None
    steps: tuple[LessonStep, ...]

    @property
    def titles(self) -> list[str]:
        return [step.title for step in self.steps]

    def public_map(self) -> list[dict]:
        return [step.public() for step in self.steps]
