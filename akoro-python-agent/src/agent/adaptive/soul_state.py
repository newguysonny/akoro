"""Learner-selected, bounded interaction layer for the adaptive agent.

The so-called Soul Stack is deliberately separated from cognitive truth: this
module has no scores for emotion, identity, relationship, ability, or loyalty.
It carries only explicit controls, a short-lived learner check-in, and compact
server-generated episode cues. It can shape wording/pacing in a prompt but
cannot authorise an action or change curriculum state.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping


_STYLES = {"balanced", "collaborative", "independent", "socratic"}
_TONES = {"calm", "curious", "direct", "celebratory"}
_CHALLENGES = {"gentle", "adaptive", "stretch"}
_ENCOURAGEMENT = {"minimal", "balanced", "frequent"}
_FEELINGS = {"steady", "energised", "tired", "stuck", "celebrating"}
_CONTEXTS = {"unknown", "quiet", "distracted", "rushed"}
_INTENTS = {"explore", "practise", "prepare", "recover"}
_SUPPORTS = {"none", "slower_steps", "more_examples", "challenge_me", "celebrate_progress"}


def _choice(value: Any, allowed: set[str], fallback: str) -> str:
    choice = str(value or "").strip().lower()
    return choice if choice in allowed else fallback


def _text(value: Any, maximum: int) -> str:
    return str(value or "").replace("\x00", "").replace("\r", " ").replace("\n", " ").strip()[:maximum]


@dataclass(frozen=True, slots=True)
class SoulPreferences:
    interaction_style: str = "balanced"
    response_tone: str = "calm"
    challenge_level: str = "adaptive"
    encouragement_level: str = "balanced"
    policy_version: str = "learner-soul-v1"

    @classmethod
    def from_wire(cls, value: Mapping[str, Any] | None) -> "SoulPreferences | None":
        if not isinstance(value, Mapping):
            return None
        return cls(
            interaction_style=_choice(value.get("interactionStyle"), _STYLES, "balanced"),
            response_tone=_choice(value.get("responseTone"), _TONES, "calm"),
            challenge_level=_choice(value.get("challengeLevel"), _CHALLENGES, "adaptive"),
            encouragement_level=_choice(value.get("encouragementLevel"), _ENCOURAGEMENT, "balanced"),
            policy_version=_text(value.get("policyVersion"), 80) or "learner-soul-v1",
        )


@dataclass(frozen=True, slots=True)
class LearnerCheckIn:
    feeling: str
    study_context: str
    study_intent: str
    requested_support: str
    expires_at: str | None = None
    policy_version: str = "learner-soul-v1"

    @classmethod
    def from_wire(cls, value: Mapping[str, Any] | None) -> "LearnerCheckIn | None":
        if not isinstance(value, Mapping):
            return None
        return cls(
            feeling=_choice(value.get("feeling"), _FEELINGS, "steady"),
            study_context=_choice(value.get("studyContext"), _CONTEXTS, "unknown"),
            study_intent=_choice(value.get("studyIntent"), _INTENTS, "practise"),
            requested_support=_choice(value.get("requestedSupport"), _SUPPORTS, "none"),
            expires_at=_text(value.get("expiresAt"), 64) or None,
            policy_version=_text(value.get("policyVersion"), 80) or "learner-soul-v1",
        )


@dataclass(frozen=True, slots=True)
class SoulState:
    preferences: SoulPreferences | None = None
    check_in: LearnerCheckIn | None = None
    narrative_episodes: tuple[dict[str, str], ...] = ()
    policy_version: str = "learner-soul-v1"

    @classmethod
    def from_wire(cls, value: Mapping[str, Any] | None) -> "SoulState":
        if not isinstance(value, Mapping):
            return cls()
        items: list[dict[str, str]] = []
        raw = value.get("episodes")
        if isinstance(raw, list):
            for entry in raw[:4]:
                if not isinstance(entry, Mapping):
                    continue
                summary = _text(entry.get("summary"), 420)
                kind = _text(entry.get("kind"), 60)
                # Gateway supplies only server-generated compact summaries.
                if summary and kind:
                    items.append({"kind": kind, "summary": summary})
        preferences = SoulPreferences.from_wire(value.get("preferences"))
        check_in = LearnerCheckIn.from_wire(value.get("checkIn"))
        return cls(preferences, check_in, tuple(items))

    def prompt_condition(self) -> str:
        lines = [
            "Learner interaction boundary: these are explicit preferences and a temporary self-report, not inferred emotions, identity, or ability. Do not claim feelings on the learner's behalf, create dependency, guilt them, or pretend to have a relationship memory outside these bounded cues.",
        ]
        if self.preferences:
            lines.append(
                "Learner-selected presentation preferences: "
                f"interaction={self.preferences.interaction_style}; tone={self.preferences.response_tone}; "
                f"challenge={self.preferences.challenge_level}; encouragement={self.preferences.encouragement_level}."
            )
        if self.check_in:
            lines.append(
                "Current learner self-report: "
                f"feeling={self.check_in.feeling}; context={self.check_in.study_context}; "
                f"intent={self.check_in.study_intent}; requested support={self.check_in.requested_support}. "
                "Acknowledge only when helpful; honour the requested presentation support without diagnosing or making promises."
            )
        if self.narrative_episodes:
            lines.append("Recent verified learning-thread cues (not a transcript): " + " ".join(item["summary"] for item in self.narrative_episodes))
        return "\n".join(lines)

    def public(self) -> dict[str, object]:
        return {
            "enabled": True,
            "preferences": {
                "interactionStyle": self.preferences.interaction_style,
                "responseTone": self.preferences.response_tone,
                "challengeLevel": self.preferences.challenge_level,
                "encouragementLevel": self.preferences.encouragement_level,
            } if self.preferences else None,
            "checkIn": {
                "feeling": self.check_in.feeling,
                "studyContext": self.check_in.study_context,
                "studyIntent": self.check_in.study_intent,
                "requestedSupport": self.check_in.requested_support,
                "expiresAt": self.check_in.expires_at,
            } if self.check_in else None,
            "narrativeEpisodeCount": len(self.narrative_episodes),
            "policyVersion": self.policy_version,
        }
