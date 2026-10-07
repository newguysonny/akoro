"""Lesson-ladder normalisation mirroring the JavaScript adaptive path."""
from __future__ import annotations

from typing import Any

from .types import LessonStep

_ALLOWED_KINDS = {"foundation", "mechanism", "application", "synthesis"}


def normalise_ladder(raw_steps: Any, topic: str) -> list[LessonStep]:
    """Repair a model ladder into an ordered dependency-safe knowledge map."""
    steps = [step for step in raw_steps if isinstance(step, dict) and str(step.get("title") or "").strip()] if isinstance(raw_steps, list) else []
    normalised: list[LessonStep] = []
    for index, step in enumerate(steps[:8]):
        title = str(step["title"]).strip()[:180]
        kind = str(step.get("kind") or "mechanism").lower()
        if kind not in _ALLOWED_KINDS:
            kind = "mechanism"
        requested = str(step.get("buildsOn") or "").strip()
        source_index = next((i for i, item in enumerate(steps) if str(item.get("title") or "").strip() == requested), -1)
        # A rung may only build on an earlier rung; repair a forward/unknown
        # dependency to the immediately preceding valid step.
        builds_on = None if index == 0 else source_index if 0 <= source_index < index else index - 1
        normalised.append(LessonStep(title=title, kind=kind, builds_on=builds_on, why_now=str(step.get("whyNow") or "").strip()[:300]))

    if not normalised:
        clean_topic = topic.strip()[:180] or "the topic"
        normalised = [LessonStep(title=clean_topic, kind="foundation", builds_on=None, why_now="Establish the core idea before extending it.")]
    # One synthesis step maximum, and it is last. Model output can otherwise
    # look coherent but create an impossible lesson order.
    synthesis = [step for step in normalised if step.kind == "synthesis"]
    non_synthesis = [step for step in normalised if step.kind != "synthesis"]
    if synthesis:
        final = synthesis[-1]
        normalised = [*non_synthesis, LessonStep(final.title, "synthesis", len(non_synthesis) - 1 if non_synthesis else None, final.why_now)]
    return normalised
