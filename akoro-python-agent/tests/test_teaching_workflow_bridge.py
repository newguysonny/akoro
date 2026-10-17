from __future__ import annotations

import unittest
from urllib.error import URLError

from agent.adaptive.akoro_teaching_workflow import AkoroTeachingWorkflowClient
from agent.adaptive.repository import InMemoryLearningRepository
from agent.harness.adaptive_service import build_adaptive_service_runtime
from agent.llm.config import LLMConfig
from agent.service.settings import ServiceSettings


class NeverUsedLocalModel:
    def complete_text(self, _messages, temperature=0.4):
        raise AssertionError("The local model must not run for a canonical workflow session")

    def complete_json(self, _messages, temperature=0.0):
        raise AssertionError("The local model must not run for a canonical workflow session")


class CanonicalWorkflowTransport:
    def __init__(self) -> None:
        self.calls = []

    def __call__(self, url, payload, headers, _timeout):
        self.calls.append((url, payload, headers))
        if url.endswith("/teaching-workflow/sessions"):
            return {"success": True, "session": {
                "sessionId": payload["sessionId"], "mustKnowParts": ["Foundation"],
                "workflow": {"type": "adaptive_teaching_turn", "policyVersion": "adaptive-teaching-workflow-v1"},
            }}
        if url.endswith("/turns"):
            return {"success": True, "turn": {
                "type": "teaching_response", "studentAgentResponse": "I need one worked example.",
                "workflow": {"type": "adaptive_teaching_turn", "policyVersion": "adaptive-teaching-workflow-v1", "state": "completed"},
            }}
        if url.endswith("/summary"):
            return {"success": True, "summary": {"teachingScore": 42, "xpEarned": 5}}
        if url.endswith("/end"):
            return {"success": True, "summary": {"totalTurns": 1, "agentGrowth": {"xpEarned": 5}}}
        raise AssertionError(url)


class RecoverableFailureTransport:
    def __call__(self, *_args, **_kwargs):
        raise URLError("canonical workflow offline")


class LocalFallbackModel:
    def __init__(self) -> None:
        self.responses = [
            {"steps": [{"title": "Foundation", "kind": "foundation", "buildsOn": None, "whyNow": "Start here."}]},
        ]

    def complete_text(self, _messages, temperature=0.4):
        return "I understand the foundation but need an example."

    def complete_json(self, _messages, temperature=0.0):
        return self.responses.pop(0) if self.responses else {}


def settings() -> ServiceSettings:
    return ServiceSettings(
        llm=LLMConfig(api_key="test"), environment="development", internal_secret="shared-secret",
        akoro_api_url="https://api.example.test", session_ttl_seconds=600,
        prefer_node_teaching_workflow=True,
    )


class TeachingWorkflowBridgeTests(unittest.TestCase):
    def test_remote_authority_runs_the_canonical_workflow_without_local_model_calls(self) -> None:
        transport = CanonicalWorkflowTransport()
        runtime = build_adaptive_service_runtime(
            settings(), model=NeverUsedLocalModel(), repository=InMemoryLearningRepository(),
            teaching_workflow_client=AkoroTeachingWorkflowClient(
                "https://api.example.test/api/internal/agent-tools/v1", "outbound", transport=transport,
            ),
        )
        from agent.adaptive.types import AdaptiveSession
        ready = runtime.start(AdaptiveSession(
            session_id="canonical-session-1", student_id="untrusted-browser-value", topic="Fractions",
            subject="Mathematics", tool_context="opaque-capability",
        ))
        self.assertEqual(ready["workflowAuthority"], "akoro_api")
        self.assertEqual(ready["workflow"]["type"], "adaptive_teaching_turn")

        with runtime.sessions.session("canonical-session-1") as loop:
            turn = loop.process_teaching_message("A fraction is part of a whole.", turn_id="canonical-turn-1")
            replayed = loop.process_teaching_message("A fraction is part of a whole.", turn_id="canonical-turn-1")
            summary = loop.generate_summary()
        self.assertEqual(turn["workflowAuthority"], "akoro_api")
        self.assertEqual(turn["studentAgentResponse"], "I need one worked example.")
        self.assertEqual(replayed, turn)
        self.assertEqual(summary["teachingScore"], 42)
        self.assertEqual([payload[1]["sessionId"] for payload in transport.calls], [
            "canonical-session-1", "canonical-session-1", "canonical-session-1",
        ])
        self.assertEqual(len([item for item in transport.calls if item[0].endswith("/turns")]), 1)

        ended = runtime.sessions.end("canonical-session-1")
        self.assertEqual(ended["workflowAuthority"], "akoro_api")
        self.assertEqual(ended["totalTurns"], 1)

    def test_an_akoro_outage_at_start_is_an_error_never_a_local_lesson(self) -> None:
        # D42/D43: with the canonical workflow configured, teaching never falls
        # back to the local loop (unsaved, its own progression).
        runtime = build_adaptive_service_runtime(
            settings(), model=NeverUsedLocalModel(), repository=InMemoryLearningRepository(),
            teaching_workflow_client=AkoroTeachingWorkflowClient(
                "https://api.example.test/api/internal/agent-tools/v1", "outbound", transport=RecoverableFailureTransport(),
            ),
        )
        from agent.adaptive.akoro_teaching_workflow import AkoroTeachingWorkflowError
        from agent.adaptive.types import AdaptiveSession
        with self.assertRaises(AkoroTeachingWorkflowError):
            runtime.start(AdaptiveSession(
                session_id="fallback-session-1", student_id="learner-1", topic="Plants", tool_context="opaque-capability",
            ))
        with self.assertRaises(Exception):
            runtime.sessions.end("fallback-session-1")

    def _runtime(self, transport):
        return build_adaptive_service_runtime(
            settings(), model=NeverUsedLocalModel(), repository=InMemoryLearningRepository(),
            teaching_workflow_client=AkoroTeachingWorkflowClient(
                "https://api.example.test/api/internal/agent-tools/v1", "outbound", transport=transport,
            ),
        )

    def test_continuation_and_decay_run_in_akoro_with_their_links(self) -> None:
        from agent.adaptive.types import AdaptiveSession
        transport = CanonicalWorkflowTransport()
        runtime = self._runtime(transport)
        earlier = "0b6f3c2a-1d4e-4f5a-9b6c-2e8d7a1c3f40"
        alert = "7c1e2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b"
        cont = runtime.start(AdaptiveSession(
            session_id="cont-1", student_id="learner-1", topic="Fractions", tool_context="opaque-capability",
            session_type="continuation", previous_session_id=earlier,
        ))
        decay = runtime.start(AdaptiveSession(
            session_id="decay-1", student_id="learner-1", topic="Cells", subject="Biology", tool_context="opaque-capability",
            session_type="decay_review", notification_id=alert,
        ))
        self.assertEqual(cont["workflowAuthority"], "akoro_api")
        self.assertEqual(decay["workflowAuthority"], "akoro_api")
        starts = [payload for url, payload, _ in transport.calls if url.endswith("/teaching-workflow/sessions")]
        self.assertEqual(starts[0]["mode"], "continuation")
        self.assertEqual(starts[0]["previousSessionId"], earlier)
        self.assertNotIn("notificationId", starts[0])
        self.assertEqual(starts[1]["mode"], "decay")
        self.assertEqual(starts[1]["notificationId"], alert)
        # No learner identity is ever sent: Akoro takes it from the capability.
        self.assertTrue(all("studentId" not in p for p in starts))

    def test_a_continuation_without_its_earlier_session_is_refused(self) -> None:
        from agent.adaptive.types import AdaptiveSession
        runtime = self._runtime(CanonicalWorkflowTransport())
        with self.assertRaises(ValueError):
            runtime.start(AdaptiveSession(
                session_id="cont-2", student_id="learner-1", topic="Fractions", tool_context="opaque-capability",
                session_type="continuation",
            ))

    def test_the_saved_record_id_is_kept_for_a_later_continuation(self) -> None:
        from agent.adaptive.types import AdaptiveSession

        class SavingTransport(CanonicalWorkflowTransport):
            def __call__(self, url, payload, headers, timeout):
                out = super().__call__(url, payload, headers, timeout)
                if url.endswith("/teaching-workflow/sessions"):
                    out["session"]["recordId"] = "5d740a93-64f6-4cbd-bd2f-acc3d03f84a8"
                return out

        runtime = self._runtime(SavingTransport())
        ready = runtime.start(AdaptiveSession(
            session_id="saved-1", student_id="learner-1", topic="Fractions", tool_context="opaque-capability",
        ))
        self.assertEqual(ready["recordId"], "5d740a93-64f6-4cbd-bd2f-acc3d03f84a8")
        with runtime.sessions.session("saved-1") as loop:
            self.assertEqual(loop.session.record_id, "5d740a93-64f6-4cbd-bd2f-acc3d03f84a8")
