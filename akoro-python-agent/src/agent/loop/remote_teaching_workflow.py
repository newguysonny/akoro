"""Session-shaped proxy for the canonical Akoro API teaching workflow."""
from __future__ import annotations

from collections.abc import Callable, Iterator
from copy import deepcopy
from typing import Any

from agent.adaptive.akoro_teaching_workflow import AkoroTeachingWorkflowSession
from agent.adaptive.types import AdaptiveSession


class RemoteTeachingWorkflowProxy:
    """Expose the local loop interface while the Node workflow owns the turn.

    Authority is chosen once in ``AdaptiveServiceRuntime.start``.  A remote
    session is never switched to the local loop after it has started: its Node
    evidence/progress state is authoritative and a mid-session fallback would
    create a divergent lesson record.
    """

    workflow_authority = "akoro_api"
    concept_state_active = False
    learning_insights_active = False

    def __init__(self, session: AdaptiveSession, remote: AkoroTeachingWorkflowSession) -> None:
        self.session = session
        self._remote = remote
        self._ended = False
        self._turn_cache: dict[str, tuple[str, dict[str, Any]]] = {}

    def initialize(self) -> dict[str, Any]:
        mode = {
            "free_teaching": "fresh",
            "continuation": "continuation",
            "decay_review": "decay",
        }[self.session.session_type]
        reference = self.session.reference
        result = self._remote.start(
            topic=self.session.topic,
            subject=self.session.subject,
            teacher_agent_id=self.session.teacher_agent_id,
            mode=mode,
            reference=reference.metadata() | {"text": reference.text} if reference else None,
        )
        return self._with_authority(result)

    def process_teaching_message(self, message: str, turn_id: str | None = None) -> dict[str, Any]:
        if self._ended:
            raise RuntimeError("This session has already ended")
        normalised = message.strip()
        if not normalised:
            raise ValueError("message is required")
        if len(normalised) > 12_000:
            raise ValueError("message is limited to 12,000 characters")
        if turn_id and turn_id in self._turn_cache:
            original, cached = self._turn_cache[turn_id]
            if original != normalised:
                raise ValueError("turnId cannot be reused for a different message")
            return deepcopy(cached)
        result = self._with_authority(self._remote.turn(message=normalised, turn_id=turn_id))
        if turn_id:
            self._turn_cache[turn_id] = (normalised, deepcopy(result))
            if len(self._turn_cache) > 32:
                self._turn_cache.pop(next(iter(self._turn_cache)))
        return result

    def stream_teaching_message(
        self, message: str, should_stop: Callable[[], bool] | None = None,
        turn_id: str | None = None,
    ) -> Iterator[dict[str, Any]]:
        """Provide the existing SSE shape for an atomic remote workflow turn.

        Node owns generation and commits the complete turn before this proxy
        receives it, so it cannot safely expose partial model tokens through a
        second service.  A stop requested before dispatch is honoured; a stop
        after dispatch cannot roll back the already committed canonical turn.
        """
        if should_stop and should_stop():
            yield {"event": "stopped", "data": {"sessionId": self.session.session_id}}
            return
        result = self.process_teaching_message(message, turn_id=turn_id)
        if should_stop and should_stop():
            yield {
                "event": "turn_complete",
                "data": {**result, "streaming": {"mode": "atomic_remote", "stopTooLate": True}},
            }
            return
        answer = str(result.get("studentAgentResponse") or "")
        if answer:
            yield {"event": "student_token", "data": {"text": answer}}
        yield {"event": "turn_complete", "data": {**result, "streaming": {"mode": "atomic_remote"}}}

    def generate_summary(self) -> dict[str, Any]:
        if self._ended:
            raise RuntimeError("This session has already ended")
        return self._with_authority(self._remote.summary())

    def end_session(self) -> dict[str, Any]:
        if self._ended:
            raise RuntimeError("This session has already ended")
        result = self._with_authority(self._remote.end())
        self._ended = True
        return result

    def execute_confirmed_action(self, _confirmation_token: str) -> dict[str, Any]:
        # The canonical Node workflow does not grant the Python model's account
        # action catalogue.  This keeps a confirmation minted for a local tool
        # session from being accidentally redeemed through a remote workflow.
        return {"success": False, "error": "Account actions are unavailable in the canonical teaching workflow"}

    @staticmethod
    def _with_authority(result: dict[str, Any]) -> dict[str, Any]:
        output = dict(result)
        output["workflowAuthority"] = "akoro_api"
        return output
