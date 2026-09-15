"""Capability-bound client for Akoro's canonical teaching-turn workflow.

The Python service never chooses individual workflow tools.  When this optional
bridge is available it relays the whole session to the Node implementation,
which owns the evidence-first tool sequence and deterministic progress gate.
"""
from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from agent.tools.akoro_api import Transport

_MAX_RESPONSE_BYTES = 256 * 1024


class AkoroTeachingWorkflowError(RuntimeError):
    """A rejected or unavailable canonical teaching-workflow request."""

    def __init__(self, message: str, *, recoverable: bool = False) -> None:
        super().__init__(message)
        self.recoverable = recoverable


def _request(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: float) -> dict[str, Any]:
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    request = Request(url, data=encoded, headers=headers, method="POST")
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read(_MAX_RESPONSE_BYTES + 1)
    except HTTPError as exc:
        # Do not silently switch authority after an authentication, validation,
        # ownership, or conflict rejection.  Only an unavailable canonical
        # service may select the local fallback at *session start*.
        raise AkoroTeachingWorkflowError(
            f"Akoro teaching workflow returned HTTP {exc.code}", recoverable=exc.code >= 500,
        ) from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise AkoroTeachingWorkflowError("Akoro teaching workflow is unavailable", recoverable=True) from exc
    if len(raw) > _MAX_RESPONSE_BYTES:
        raise AkoroTeachingWorkflowError("Akoro teaching workflow response exceeded its size limit", recoverable=True)
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AkoroTeachingWorkflowError("Akoro teaching workflow returned invalid JSON", recoverable=True) from exc
    if not isinstance(parsed, dict):
        raise AkoroTeachingWorkflowError("Akoro teaching workflow response must be an object", recoverable=True)
    return parsed


@dataclass(frozen=True, slots=True)
class AkoroTeachingWorkflowSession:
    client: "AkoroTeachingWorkflowClient"
    session_id: str
    tool_context: str

    def start(self, *, topic: str, subject: str | None, teacher_agent_id: str | None,
              mode: str, reference: dict[str, object] | None) -> dict[str, Any]:
        response = self.client._post("/teaching-workflow/sessions", {
            "sessionId": self.session_id,
            "toolContext": self.tool_context,
            "topic": topic,
            "subject": subject,
            "teacherAgentId": teacher_agent_id,
            "mode": mode,
            "reference": reference,
        })
        return _object(response, "session")

    def turn(self, *, message: str, turn_id: str | None) -> dict[str, Any]:
        response = self.client._post(f"/teaching-workflow/sessions/{self.session_id}/turns", {
            "sessionId": self.session_id,
            "toolContext": self.tool_context,
            "message": message,
            "turnId": turn_id,
        })
        return _object(response, "turn")

    def summary(self) -> dict[str, Any]:
        response = self.client._post(f"/teaching-workflow/sessions/{self.session_id}/summary", {
            "sessionId": self.session_id,
            "toolContext": self.tool_context,
        })
        return _object(response, "summary")

    def end(self) -> dict[str, Any]:
        response = self.client._post(f"/teaching-workflow/sessions/{self.session_id}/end", {
            "sessionId": self.session_id,
            "toolContext": self.tool_context,
        })
        return _object(response, "summary")


def _object(response: Mapping[str, Any], field: str) -> dict[str, Any]:
    if not response.get("success", False):
        raise AkoroTeachingWorkflowError(
            str(response.get("error") or "Akoro teaching workflow is unavailable")[:500], recoverable=True,
        )
    value = response.get(field)
    if not isinstance(value, Mapping):
        raise AkoroTeachingWorkflowError(f"Akoro teaching workflow did not return {field}", recoverable=True)
    return dict(value)


class AkoroTeachingWorkflowClient:
    """Uses the existing private tools credential and learner capability."""

    def __init__(self, base_url: str, secret: str, timeout_seconds: float = 45,
                 transport: Transport | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout = timeout_seconds
        self._transport = transport or _request

    def open_session(self, *, session_id: str, tool_context: str) -> AkoroTeachingWorkflowSession:
        if not session_id or not tool_context:
            raise AkoroTeachingWorkflowError("Teaching workflow needs an Akoro capability and session id")
        return AkoroTeachingWorkflowSession(self, session_id, tool_context)

    def _post(self, suffix: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self._transport(
                f"{self._base_url}{suffix}", payload,
                {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "X-Akoro-Tools-Secret": self._secret,
                    "User-Agent": "Akoro-Python-Agent/Teaching-Workflow-v1",
                }, self._timeout,
            )
        except AkoroTeachingWorkflowError:
            raise
        except Exception as exc:
            raise AkoroTeachingWorkflowError("Akoro teaching workflow is unavailable", recoverable=True) from exc
        if not isinstance(response, Mapping):
            raise AkoroTeachingWorkflowError("Akoro teaching workflow response must be an object", recoverable=True)
        return dict(response)
