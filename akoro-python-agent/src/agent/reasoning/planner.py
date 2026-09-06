"""Compact, inspectable task planning.

The planner intentionally produces a short user-facing task outline rather
than hidden chain-of-thought. The LLM still decides whether a permitted tool is
useful; the outline simply gives the loop a stable objective and guardrails.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Plan:
    objective: str
    steps: tuple[str, ...]

    def prompt_fragment(self) -> str:
        return "\n".join(f"{index + 1}. {step}" for index, step in enumerate(self.steps))


class Planner:
    def create(self, user_message: str) -> Plan:
        objective = user_message.strip()
        if not objective:
            raise ValueError("A user message is required")
        return Plan(
            objective=objective,
            steps=(
                "Understand the request and answer directly.",
                "Use a permitted tool only when it materially improves accuracy.",
                "Explain any uncertainty or missing information plainly.",
            ),
        )
