"""Private Akoro API adapter for bounded learner study signals and episodes."""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from agent.tools.akoro_api import Transport

from .akoro_concept_state import _post
from .learner_signals import LearnerTeachingProfile, LearningEpisode, LearningMeasurement


class AkoroLearningInsightsError(RuntimeError):
    """Raised when the optional Akoro-owned insights resource is unavailable."""


@dataclass(frozen=True, slots=True)
class AkoroLearningInsightsSession:
    client: "AkoroLearningInsightsClient"
    session_id: str
    tool_context: str

    def snapshot(self) -> tuple[LearnerTeachingProfile | None, tuple[dict[str, object], ...]]:
        response = self.client._request("/learning-insights/snapshot", {
            "sessionId": self.session_id, "toolContext": self.tool_context,
        })
        profile = LearnerTeachingProfile.from_wire(response.get("profile"))
        raw_episodes = response.get("episodes")
        episodes: list[dict[str, object]] = []
        if isinstance(raw_episodes, list):
            for item in raw_episodes[:6]:
                if not isinstance(item, Mapping):
                    continue
                summary = str(item.get("summary") or "").replace("\n", " ").strip()[:420]
                kind = str(item.get("kind") or "").strip()[:60]
                if summary and kind:
                    episodes.append({"kind": kind, "summary": summary, "occurredAt": item.get("occurredAt")})
        return profile, tuple(episodes)

    def record(self, turn_id: str, measurement: LearningMeasurement, episode: LearningEpisode | None) -> LearnerTeachingProfile | None:
        response = self.client._request("/learning-insights/measurements", {
            "sessionId": self.session_id,
            "toolContext": self.tool_context,
            "turnId": turn_id,
            "measurement": measurement.wire(episode),
        })
        return LearnerTeachingProfile.from_wire(response.get("profile"))


class AkoroLearningInsightsClient:
    """Uses the agent gateway secret, never a browser token or database URL."""

    def __init__(self, base_url: str, secret: str, timeout_seconds: float = 12,
                 transport: Transport | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout = timeout_seconds
        self._transport = transport or _post

    def open_session(self, *, session_id: str, tool_context: str) -> AkoroLearningInsightsSession:
        if not session_id or not tool_context:
            raise AkoroLearningInsightsError("Learning insights need an Akoro capability and session id")
        return AkoroLearningInsightsSession(self, session_id, tool_context)

    def _request(self, suffix: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self._transport(
                f"{self._base_url}{suffix}", payload,
                {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "X-Akoro-Tools-Secret": self._secret,
                    "User-Agent": "Akoro-Python-Agent/Learner-Signals-v1",
                }, self._timeout,
            )
        except Exception as exc:
            raise AkoroLearningInsightsError("Akoro learning-insights API is unavailable") from exc
        if not isinstance(response, Mapping):
            raise AkoroLearningInsightsError("Akoro learning-insights API response must be an object")
        if not response.get("success", False):
            raise AkoroLearningInsightsError(str(response.get("error") or "Akoro learning-insights API is unavailable")[:500])
        return dict(response)
