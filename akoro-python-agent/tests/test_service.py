from __future__ import annotations

import os
import unittest

# api.py exposes an ASGI `app` for Uvicorn, so provide harmless configuration
# before importing it. The test itself uses an injected fake model and never
# contacts a provider.
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("AGENT_SERVICE_ENVIRONMENT", "development")

from fastapi.testclient import TestClient

from agent.adaptive.repository import InMemoryLearningRepository
from agent.harness.adaptive_service import build_adaptive_service_runtime
from agent.llm.client import LLMResponse
from agent.llm.config import LLMConfig
from agent.llm.messages import ToolCall
from agent.service.api import create_app
from agent.service.settings import ServiceSettings
from agent.tools.akoro_api import AkoroToolsClient


class FakeServiceModel:
    def __init__(self) -> None:
        self.json_responses = [
            {"steps": [{"title": "Foundation", "kind": "foundation", "buildsOn": None, "whyNow": "Start here."}]},
            {"goal": "Support the learner with Plants.", "progressSummary": "", "completed": [], "plan": [{"step": "Clarify the learner's need.", "status": "in_progress"}], "nextSteps": ["Clarify the learner's need."], "openQuestions": []},
            {"understanding": 60, "confusion": 20, "engagement": 80, "strengths": ["Named the foundation"]},
            {"shouldSave": False},
            {"tip": "Ask for one concrete example next.", "nextAction": "DIG_DEEPER", "nextPhase": None, "nextMustKnowIndex": 0},
            {"goal": "Support the learner with Plants.", "progressSummary": "Discussed the foundation.", "completed": ["Discussed the foundation."], "plan": [{"step": "Ask for an example.", "status": "pending"}], "nextSteps": ["Ask for an example."], "openQuestions": []},
            {"overallScore": 70, "strengths": ["Clear explanation"], "nextTimeTip": "Use an example.", "nextLesson": "Keep practising."},
            {"overallScore": 70, "strengths": ["Clear explanation"], "nextTimeTip": "Use an example.", "nextLesson": "Keep practising."},
        ]

    def complete_text(self, messages, temperature=0.4):
        return "I understand the foundation, but I would like to see an example."

    def complete_json(self, messages, temperature=0.0):
        return self.json_responses.pop(0)


class StreamingServiceModel(FakeServiceModel):
    def stream_text(self, _messages, temperature=0.4):
        self.asserted_temperature = temperature
        yield "I understand "
        yield "the foundation, but I would like an example."


class ToolEnabledServiceModel(FakeServiceModel):
    def __init__(self) -> None:
        super().__init__()
        self.tool_rounds = 0

    def complete(self, messages, tools):
        self.tool_rounds += 1
        if self.tool_rounds == 1:
            self.asserted_tool_name = tools[0]["function"]["name"]
            return LLMResponse("", (ToolCall("tool-call-1", "check_progress", {}),))
        return LLMResponse("I checked the current progress: it is 61 percent.")


class ToolTransport:
    def __init__(self) -> None:
        self.calls = []

    def __call__(self, url, payload, headers, _timeout):
        self.calls.append((url, payload, headers))
        if url.endswith("/catalog"):
            return {"tools": [{
                "name": "check_progress", "description": "Read current progress.",
                "inputSchema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
            }]}
        return {"success": True, "result": {"completion": 61, "privateIdentifier": "never-return-directly"}}


class ConfirmationTransport(ToolTransport):
    def __call__(self, url, payload, headers, timeout):
        self.calls.append((url, payload, headers))
        if url.endswith("/catalog"):
            return {"tools": [{
                "name": "create_task", "description": "Create a reviewed task.", "sideEffecting": True,
                "inputSchema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
            }]}
        if url.endswith("/execute-confirmed"):
            return {"success": True, "confirmedTool": "create_task", "result": {"created": True, "taskId": "task-1"}}
        raise AssertionError(f"Unexpected transport call: {url}")


class ServiceSettingsTests(unittest.TestCase):
    def test_tools_gateway_variables_are_an_all_or_nothing_secure_pair(self) -> None:
        base = {"OPENAI_API_KEY": "test", "AGENT_SERVICE_ENVIRONMENT": "production", "AKORO_AGENT_SERVICE_SECRET": "inbound"}
        with self.assertRaisesRegex(ValueError, "configured together"):
            ServiceSettings.from_env({**base, "AKORO_AGENT_TOOLS_URL": "https://api.example.test/internal/tools"})
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            ServiceSettings.from_env({**base, "AKORO_AGENT_TOOLS_URL": "http://api.example.test/internal/tools", "AKORO_AGENT_TOOLS_SECRET": "outbound"})
        settings = ServiceSettings.from_env({**base, "AKORO_AGENT_TOOLS_URL": "https://api.example.test/internal/tools", "AKORO_AGENT_TOOLS_SECRET": "outbound"})
        self.assertTrue(settings.tools_configured)


class ServiceContractTests(unittest.TestCase):
    def setUp(self) -> None:
        settings = ServiceSettings(
            llm=LLMConfig(api_key="test"), environment="development", internal_secret="shared-secret",
            akoro_api_url="https://api.example.test", session_ttl_seconds=600,
        )
        self.client = TestClient(create_app(settings, FakeServiceModel(), InMemoryLearningRepository()))
        self.headers = {"X-Akoro-Agent-Secret": "shared-secret"}

    def test_internal_adaptive_lifecycle_and_reference_privacy(self) -> None:
        self.assertEqual(self.client.get("/health").status_code, 200)
        self.assertEqual(self.client.post("/v1/sessions", json={"studentId": "learner-1", "topic": "Plants"}).status_code, 401)

        start = self.client.post("/v1/sessions", headers=self.headers, json={
            "studentId": "learner-1", "topic": "Plants", "subject": "Biology",
            "sessionId": "python-session-1", "reference": {"name": "notes.txt", "text": "private reference"},
        })
        self.assertEqual(start.status_code, 200)
        self.assertEqual(start.json()["sessionId"], "python-session-1")
        self.assertEqual(start.json()["reference"], {"name": "notes.txt", "chars": 17, "truncated": False})
        self.assertNotIn("private reference", start.text)

        turn = self.client.post("/v1/sessions/python-session-1/turns", headers=self.headers, json={"message": "Plants use light."})
        self.assertEqual(turn.status_code, 200)
        self.assertEqual(turn.json()["type"], "teaching_response")

        summary = self.client.get("/v1/sessions/python-session-1/summary", headers=self.headers)
        self.assertEqual(summary.status_code, 200)
        self.assertEqual(summary.json()["summary"]["teachingScore"], 70)

        end = self.client.post("/v1/sessions/python-session-1/end", headers=self.headers)
        self.assertEqual(end.status_code, 200)
        self.assertEqual(end.json()["summary"]["agentGrowth"]["totalSessions"], 1)
        self.assertEqual(self.client.get("/v1/sessions/python-session-1/summary", headers=self.headers).status_code, 404)

    def test_streaming_turn_emits_tokens_then_the_normal_terminal_turn_payload(self) -> None:
        model = StreamingServiceModel()
        runtime = build_adaptive_service_runtime(
            self.client.app.state.settings, model=model, repository=InMemoryLearningRepository(),
        )
        client = TestClient(create_app(self.client.app.state.settings, runtime=runtime))
        start = client.post("/v1/sessions", headers=self.headers, json={
            "studentId": "learner-1", "topic": "Plants", "sessionId": "stream-session-1",
        })
        self.assertEqual(start.status_code, 200)

        stream = client.post("/v1/sessions/stream-session-1/turns/stream", headers=self.headers, json={"message": "Plants use light."})
        self.assertEqual(stream.status_code, 200)
        self.assertTrue(stream.headers["content-type"].startswith("text/event-stream"))
        self.assertIn("event: stream_started", stream.text)
        self.assertIn('event: student_token\ndata: {"text":"I understand "}', stream.text)
        self.assertIn("event: turn_complete", stream.text)
        self.assertIn('"studentAgentResponse":"I understand the foundation, but I would like an example."', stream.text)
        self.assertEqual(runtime.sessions.active_count(), 1)

    def test_stop_endpoint_signals_an_active_stream_and_rejects_a_second_turn(self) -> None:
        start = self.client.post("/v1/sessions", headers=self.headers, json={
            "studentId": "learner-1", "topic": "Plants", "sessionId": "stoppable-stream-session",
        })
        self.assertEqual(start.status_code, 200)
        runtime = self.client.app.state.runtime
        signal = runtime.sessions.begin_stream("stoppable-stream-session")
        self.assertEqual(
            self.client.post("/v1/sessions/stoppable-stream-session/turns", headers=self.headers, json={"message": "Plants use light."}).status_code,
            409,
        )
        stop = self.client.post("/v1/sessions/stoppable-stream-session/turns/stream/stop", headers=self.headers)
        self.assertEqual(stop.status_code, 200)
        self.assertEqual(stop.json(), {"sessionId": "stoppable-stream-session", "stopping": True})
        self.assertTrue(signal.is_set())
        runtime.sessions.finish_stream("stoppable-stream-session")
        self.assertEqual(
            self.client.post("/v1/sessions/stoppable-stream-session/turns/stream/stop", headers=self.headers).status_code,
            409,
        )

    def test_session_uses_only_akoro_catalogue_tools_and_returns_result_free_audit_metadata(self) -> None:
        transport = ToolTransport()
        runtime = build_adaptive_service_runtime(
            self.client.app.state.settings,
            model=ToolEnabledServiceModel(),
            repository=InMemoryLearningRepository(),
            tools_client=AkoroToolsClient("https://api.example.test/internal/tools", "outbound-secret", transport=transport),
        )
        client = TestClient(create_app(self.client.app.state.settings, runtime=runtime))
        start = client.post("/v1/sessions", headers=self.headers, json={
            "studentId": "learner-1", "topic": "Plants", "sessionId": "tool-session-1",
            "toolContext": "opaque-signed-context",
        })
        self.assertEqual(start.status_code, 200)
        self.assertEqual(start.json()["tools"], {
            "enabled": True,
            "available": [{"name": "check_progress", "description": "Read current progress.", "sideEffecting": False}],
        })

        turn = client.post("/v1/sessions/tool-session-1/turns", headers=self.headers, json={"message": "What is my current progress?"})
        self.assertEqual(turn.status_code, 200)
        self.assertEqual(turn.json()["studentAgentResponse"], "I checked the current progress: it is 61 percent.")
        self.assertEqual(turn.json()["toolExecutions"], [{"tool": "check_progress", "success": True, "sideEffecting": False}])
        self.assertNotIn("privateIdentifier", turn.text)
        self.assertEqual(transport.calls[1][1]["toolContext"], "opaque-signed-context")

    def test_confirmed_action_endpoint_only_redeems_the_opaque_review_token(self) -> None:
        transport = ConfirmationTransport()
        settings = ServiceSettings(
            llm=LLMConfig(api_key="test"), environment="development", internal_secret="shared-secret",
            akoro_api_url="https://api.example.test", session_ttl_seconds=600,
            allow_side_effecting_tools=True,
        )
        runtime = build_adaptive_service_runtime(
            settings, model=FakeServiceModel(), repository=InMemoryLearningRepository(),
            tools_client=AkoroToolsClient("https://api.example.test/internal/tools", "outbound-secret", transport=transport),
        )
        client = TestClient(create_app(settings, runtime=runtime))
        start = client.post("/v1/sessions", headers=self.headers, json={
            "studentId": "learner-1", "topic": "Plants", "sessionId": "confirmed-action-session",
            "toolContext": "opaque-signed-context",
        })
        self.assertEqual(start.status_code, 200)

        response = client.post(
            "/v1/sessions/confirmed-action-session/confirmed-actions", headers=self.headers,
            json={"confirmationToken": "opaque-learner-reviewed-token"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["execution"]["success"], True)
        self.assertTrue(transport.calls[1][0].endswith("/execute-confirmed"))
        gateway_payload = transport.calls[1][1]
        self.assertEqual(set(gateway_payload), {"sessionId", "toolContext", "confirmationToken", "idempotencyKey"})
        self.assertEqual(gateway_payload["sessionId"], "confirmed-action-session")
        self.assertEqual(gateway_payload["toolContext"], "opaque-signed-context")
        self.assertEqual(gateway_payload["confirmationToken"], "opaque-learner-reviewed-token")
        self.assertTrue(gateway_payload["idempotencyKey"].startswith("confirmed-"))
        self.assertEqual(len(transport.calls), 2)


class EmptyConceptStateSession:
    """Reviewed-catalogue lookup stub: deliberate no-op scope."""

    def resolve_active_concepts(self):
        return []

    def snapshot(self, _concept_ids):
        return []

    def record(self, _turn_id, _observations):
        return []


class EmptyConceptStateClient:
    def open_session(self, **_kwargs):
        return EmptyConceptStateSession()


class ConceptStateServiceContractTests(unittest.TestCase):
    def test_enabled_slice_requires_trusted_scope_and_is_a_noop_without_reviewed_concepts(self) -> None:
        settings = ServiceSettings(
            llm=LLMConfig(api_key="test"), environment="development", internal_secret="shared-secret",
            akoro_api_url="https://api.example.test", session_ttl_seconds=600,
            enable_concept_state=True,
        )
        runtime = build_adaptive_service_runtime(
            settings, model=FakeServiceModel(), repository=InMemoryLearningRepository(),
            concept_state_client=EmptyConceptStateClient(),
        )
        client = TestClient(create_app(settings, runtime=runtime))
        headers = {"X-Akoro-Agent-Secret": "shared-secret"}

        missing_scope = client.post("/v1/sessions", headers=headers, json={
            "studentId": "learner-1", "topic": "Plants", "subject": "Biology",
        })
        self.assertEqual(missing_scope.status_code, 422)

        start = client.post("/v1/sessions", headers=headers, json={
            "studentId": "learner-1", "sessionId": "concept-noop-session", "topic": "Plants",
            "subject": "Biology", "curriculumKey": "nerdc-jss2-basic-science-v1",
            "topicKey": "plants", "toolContext": "opaque-signed-context",
        })
        self.assertEqual(start.status_code, 200)
        self.assertFalse(start.json()["conceptTracking"]["enabled"])

        # A review-empty scope stays on the existing lifecycle and does not add
        # a new turn-id requirement merely because the deployment flag is on.
        turn = client.post("/v1/sessions/concept-noop-session/turns", headers=headers, json={"message": "Plants use light."})
        self.assertEqual(turn.status_code, 200)
