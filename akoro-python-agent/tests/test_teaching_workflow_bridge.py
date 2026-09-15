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

    def test_recoverable_start_failure_selects_local_authority_before_any_turn(self) -> None:
        runtime = build_adaptive_service_runtime(
            settings(), model=LocalFallbackModel(), repository=InMemoryLearningRepository(),
            teaching_workflow_client=AkoroTeachingWorkflowClient(
                "https://api.example.test/api/internal/agent-tools/v1", "outbound", transport=RecoverableFailureTransport(),
            ),
        )
        from agent.adaptive.types import AdaptiveSession
        ready = runtime.start(AdaptiveSession(
            session_id="fallback-session-1", student_id="learner-1", topic="Plants", tool_context="opaque-capability",
        ))
        self.assertEqual(ready["workflowAuthority"], "python_local")
        self.assertEqual(ready["workflowFallback"], "canonical_workflow_unavailable")
