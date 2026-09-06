"""Validated teaching-phase state and transition rules."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

PHASES = ("PHASE_1", "PHASE_2", "PHASE_3", "PHASE_4", "MASTERY")
PHASE_LABELS = {
    "PHASE_1": "Phase 1 — What does Student Agent already know?",
    "PHASE_2": "Phase 2 — Must-know parts",
    "PHASE_3": "Phase 3 — Student Agent teaches it back",
    "PHASE_4": "Phase 4 — Push a little further!",
    "MASTERY": "Mastery",
}


@dataclass(slots=True)
class TeachingState:
    phase: str = "PHASE_1"
    subtopic_index: int = 0

    def label(self) -> str:
        return PHASE_LABELS.get(self.phase, self.phase)


@dataclass(frozen=True, slots=True)
class ProgressTransition:
    phase_changed: bool
    subtopic_advanced: bool
    current_phase: str
    current_subtopic_index: int


class ProgressionPolicy:
    """Prevents a malformed model result from skipping the learning journey."""

    def apply(self, state: TeachingState, *, requested_phase: Any, requested_index: Any,
              total_subtopics: int, understanding: float) -> ProgressTransition:
        old_phase, old_index = state.phase, state.subtopic_index
        try:
            index = int(requested_index)
        except (TypeError, ValueError):
            index = old_index
        final_index = max(0, total_subtopics - 1)
        # One rung at a time, no regression. A model cannot jump the learner
        # from the opening to the final chapter in one persuasive JSON reply.
        state.subtopic_index = min(final_index, max(old_index, min(index, old_index + 1)))

        requested = str(requested_phase or "").upper()
        current_position = PHASES.index(old_phase) if old_phase in PHASES else 0
        requested_position = PHASES.index(requested) if requested in PHASES else current_position
        if requested == "MASTERY":
            # Mastery requires the whole ladder and a substantive understanding
            # signal; it is never a mere model-generated label.
            if state.subtopic_index == final_index and understanding >= 0.75:
                state.phase = "MASTERY"
        elif current_position < len(PHASES) - 1 and requested_position == current_position + 1:
            state.phase = requested

        return ProgressTransition(
            phase_changed=state.phase != old_phase,
            subtopic_advanced=state.subtopic_index != old_index,
            current_phase=state.phase,
            current_subtopic_index=state.subtopic_index,
        )
