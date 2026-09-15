"""Private, read-only Akoro adapter for learner-selected soul-state context."""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from agent.tools.akoro_api import Transport

from .akoro_concept_state import _post
from .soul_state import SoulState


class AkoroSoulStateError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class AkoroSoulStateSession:
    client: "AkoroSoulStateClient"
    session_id: str
    tool_context: str

    def snapshot(self) -> SoulState:
        return SoulState.from_wire(self.client._request("/soul-state/snapshot", {
            "sessionId": self.session_id, "toolContext": self.tool_context,
        }))


class AkoroSoulStateClient:
    def __init__(self, base_url: str, secret: str, timeout_seconds: float = 12,
                 transport: Transport | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout = timeout_seconds
        self._transport = transport or _post

    def open_session(self, *, session_id: str, tool_context: str) -> AkoroSoulStateSession:
        if not session_id or not tool_context:
            raise AkoroSoulStateError("Soul-state context needs an Akoro capability and session id")
        return AkoroSoulStateSession(self, session_id, tool_context)

    def _request(self, suffix: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self._transport(
                f"{self._base_url}{suffix}", payload,
                {
                    "Content-Type": "application/json", "Accept": "application/json",
                    "X-Akoro-Tools-Secret": self._secret,
                    "User-Agent": "Akoro-Python-Agent/Soul-State-v1",
                }, self._timeout,
            )
        except Exception as exc:
            raise AkoroSoulStateError("Akoro soul-state API is unavailable") from exc
        if not isinstance(response, Mapping):
            raise AkoroSoulStateError("Akoro soul-state API response must be an object")
        if not response.get("success", False):
            raise AkoroSoulStateError(str(response.get("error") or "Akoro soul-state API is unavailable")[:500])
        return dict(response)
