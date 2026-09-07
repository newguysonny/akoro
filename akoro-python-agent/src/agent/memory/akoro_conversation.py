"""Private Akoro API adapter for durable conversation context and study memory.

Python never opens the Akoro database and never receives a browser credential.
Each request carries the same short-lived, session-bound capability used by the
private tools gateway, so Akoro derives the learner from its signed claim.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .conversation import ConversationMemoryUpdate, LearnerConversationContext
from agent.tools.akoro_api import Transport

_MAX_CONTEXT_RESPONSE_BYTES = 192 * 1024


def _https_conversation_post(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: float) -> dict[str, Any]:
    """POST the bounded history snapshot without inheriting tool-result limits."""
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    request = Request(url, data=encoded, method="POST", headers=headers)
    try:
        with urlopen(request, timeout=timeout) as response:  # nosec B310: configured HTTPS URL is validated by settings.
            raw = response.read(_MAX_CONTEXT_RESPONSE_BYTES + 1)
    except HTTPError as exc:
        raise AkoroConversationError(f"Akoro conversation API returned HTTP {exc.code}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise AkoroConversationError("Akoro conversation context is unavailable") from exc
    if len(raw) > _MAX_CONTEXT_RESPONSE_BYTES:
        raise AkoroConversationError("Akoro conversation context response exceeded its size limit")
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AkoroConversationError("Akoro conversation API returned invalid JSON") from exc
    if not isinstance(body, dict):
        raise AkoroConversationError("Akoro conversation API response must be an object")
    return body


class AkoroConversationError(RuntimeError):
    """The authorised Akoro conversation gateway could not fulfil a request."""


@dataclass(slots=True)
class AkoroConversationSession:
    """Bound persistence handle for one authorised Python conversation session."""

    client: "AkoroConversationClient"
    session_id: str
    tool_context: str
    context: LearnerConversationContext

    def persist_turn(
        self,
        *,
        turn_id: str,
        user_message: str,
        assistant_message: str,
        update: ConversationMemoryUpdate,
    ) -> dict[str, Any]:
        return self.client.persist_turn(
            session_id=self.session_id,
            tool_context=self.tool_context,
            conversation_id=self.context.conversation_id,
            turn_id=turn_id,
            user_message=user_message,
            assistant_message=assistant_message,
            update=update,
        )


class AkoroConversationClient:
    """Bounded transport client for the private conversation-context contract."""

    def __init__(self, base_url: str, secret: str, timeout_seconds: float = 12,
                 transport: Transport | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout = timeout_seconds
        self._transport = transport or _https_conversation_post

    def open_session(self, *, session_id: str, tool_context: str,
                     conversation_id: str) -> AkoroConversationSession:
        if not tool_context:
            raise AkoroConversationError("No Akoro conversation capability was supplied")
        response = self._post("/conversations/context", {
            "sessionId": session_id,
            "toolContext": tool_context,
            "conversationId": conversation_id,
        })
        if not bool(response.get("success", False)) or not isinstance(response.get("conversation"), Mapping):
            raise AkoroConversationError(self._error(response, "Akoro conversation context is unavailable"))
        try:
            context = LearnerConversationContext.from_wire(response["conversation"], conversation_id)
        except ValueError as exc:
            raise AkoroConversationError(str(exc)) from exc
        return AkoroConversationSession(self, session_id, tool_context, context)

    def persist_turn(
        self,
        *,
        session_id: str,
        tool_context: str,
        conversation_id: str,
        turn_id: str,
        user_message: str,
        assistant_message: str,
        update: ConversationMemoryUpdate,
    ) -> dict[str, Any]:
        response = self._post("/conversations/turns", {
            "sessionId": session_id,
            "toolContext": tool_context,
            "conversationId": conversation_id,
            "turnId": turn_id,
            "userMessage": user_message,
            "assistantMessage": assistant_message,
            **update.wire(),
        })
        if not bool(response.get("success", False)):
            raise AkoroConversationError(self._error(response, "Akoro conversation turn could not be saved"))
        result = response.get("persistence")
        return dict(result) if isinstance(result, Mapping) else {"saved": True}

    def _post(self, suffix: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self._transport(
                f"{self._base_url}{suffix}",
                payload,
                {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "X-Akoro-Tools-Secret": self._secret,
                    "User-Agent": "Akoro-Python-Agent/0.6",
                },
                self._timeout,
            )
        except Exception as exc:
            raise AkoroConversationError("Akoro conversation context is unavailable") from exc
        if not isinstance(response, Mapping):
            raise AkoroConversationError("Akoro conversation API response must be an object")
        return dict(response)

    @staticmethod
    def _error(response: Mapping[str, Any], fallback: str) -> str:
        value = str(response.get("error") or response.get("message") or "").strip()
        return value[:500] or fallback
