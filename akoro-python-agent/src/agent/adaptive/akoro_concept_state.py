"""Protected Akoro API adapter for canonical learner concept state.

This module is intentionally separate from the model tool catalogue. It uses
the same short-lived capability envelope as the private tools gateway, but the
Akoro API remains responsible for curriculum approval, learner ownership,
immutable evidence, idempotency, and the state transition function.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from agent.tools.akoro_api import Transport

from .concepts import ConceptObservation, CurriculumConcept, LearnerConceptState, canonical_key

_MAX_RESPONSE_BYTES = 96 * 1024


class AkoroConceptStateError(RuntimeError):
    """Raised when the authorised Akoro concept-state resource is unavailable."""


def _post(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: float) -> dict[str, Any]:
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    request = Request(url, data=encoded, method="POST", headers=headers)
    try:
        with urlopen(request, timeout=timeout) as response:  # nosec B310: settings validates the configured endpoint.
            raw = response.read(_MAX_RESPONSE_BYTES + 1)
    except HTTPError as exc:
        raise AkoroConceptStateError(f"Akoro concept-state API returned HTTP {exc.code}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise AkoroConceptStateError("Akoro concept-state API is unavailable") from exc
    if len(raw) > _MAX_RESPONSE_BYTES:
        raise AkoroConceptStateError("Akoro concept-state response exceeded its size limit")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AkoroConceptStateError("Akoro concept-state API returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise AkoroConceptStateError("Akoro concept-state API response must be an object")
    return value


@dataclass(frozen=True, slots=True)
class AkoroConceptStateSession:
    client: "AkoroConceptStateClient"
    session_id: str
    tool_context: str
    curriculum_key: str
    subject: str
    topic_key: str

    def resolve_active_concepts(self) -> list[CurriculumConcept]:
        response = self.client._request("/concept-state/resolve", {
            "sessionId": self.session_id,
            "toolContext": self.tool_context,
            "curriculumKey": self.curriculum_key,
            "subject": self.subject,
            "topicKey": self.topic_key,
        })
        raw = response.get("concepts")
        return [concept for item in raw[:8] if isinstance(item, Mapping) if (concept := CurriculumConcept.from_wire(item))] if isinstance(raw, list) else []

    def snapshot(self, concept_ids: Iterable[str]) -> list[LearnerConceptState]:
        ids = list(dict.fromkeys(str(item) for item in concept_ids))[:8]
        if not ids:
            return []
        response = self.client._request("/concept-state/snapshot", {
            "sessionId": self.session_id, "toolContext": self.tool_context, "conceptIds": ids,
        })
        raw = response.get("states")
        states: list[LearnerConceptState] = []
        if isinstance(raw, list):
            for item in raw[:len(ids)]:
                if isinstance(item, Mapping):
                    state = LearnerConceptState.from_wire(item)
                    if state and state.concept_id in ids:
                        states.append(state)
        return states

    def record(self, turn_id: str, observations: Iterable[ConceptObservation]) -> list[LearnerConceptState]:
        payload = [
            {
                "conceptId": item.concept_id,
                "kind": item.kind,
                "responseQuality": item.response_quality,
                "claimValidity": item.claim_validity,
                "modelConfidence": item.model_confidence,
                "claimStatus": item.claim_status,
                "evidenceSummary": item.evidence_summary,
            }
            for item in observations
        ][:4]
        if not payload:
            return []
        response = self.client._request("/concept-state/observations", {
            "sessionId": self.session_id, "toolContext": self.tool_context,
            "turnId": turn_id, "observations": payload,
        })
        raw = response.get("states")
        states: list[LearnerConceptState] = []
        if isinstance(raw, list):
            for item in raw[:len(payload)]:
                if isinstance(item, Mapping):
                    state = LearnerConceptState.from_wire(item)
                    if state:
                        states.append(state)
        if len(states) != len(payload):
            raise AkoroConceptStateError("Akoro concept-state API did not return every updated state")
        return states


class AkoroConceptStateClient:
    def __init__(self, base_url: str, secret: str, timeout_seconds: float = 12,
                 transport: Transport | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout = timeout_seconds
        self._transport = transport or _post

    def open_session(self, *, session_id: str, tool_context: str, curriculum_key: str | None,
                     subject: str | None, topic_key: str | None) -> AkoroConceptStateSession:
        curriculum = canonical_key(curriculum_key)
        clean_subject = " ".join(str(subject or "").split())[:180]
        topic = canonical_key(topic_key)
        if not tool_context or not curriculum or not clean_subject or not topic:
            raise AkoroConceptStateError("Concept state needs an Akoro capability, curriculumKey, subject, and topicKey")
        return AkoroConceptStateSession(self, session_id, tool_context, curriculum, clean_subject, topic)

    def _request(self, suffix: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self._transport(
                f"{self._base_url}{suffix}", payload,
                {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "X-Akoro-Tools-Secret": self._secret,
                    "User-Agent": "Akoro-Python-Agent/Concept-State-v1",
                }, self._timeout,
            )
        except AkoroConceptStateError:
            raise
        except Exception as exc:
            raise AkoroConceptStateError("Akoro concept-state API is unavailable") from exc
        if not isinstance(response, Mapping):
            raise AkoroConceptStateError("Akoro concept-state API response must be an object")
        if not response.get("success", False):
            message = str(response.get("error") or "Akoro concept-state API is unavailable").strip()[:500]
            raise AkoroConceptStateError(message)
        return dict(response)
