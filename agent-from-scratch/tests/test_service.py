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
            {"understanding": 60, "confusion": 20, "engagement": 80, "strengths": ["Named the foundation"]},
            {"shouldSave": False},
            {"tip": "Ask for one concrete example next.", "nextAction": "DIG_DEEPER", "nextPhase": None, "nextMustKnowIndex": 0},
            {"overallScore": 70, "strengths": ["Clear explanation"], "nextTimeTip": "Use an example.", "nextLesson": "Keep practising."},
            {"overallScore": 70, "strengths": ["Clear explanation"], "nextTimeTip": "Use an example.", "nextLesson": "Keep practising."},
        ]

    def complete_text(self, messages, temperature=0.4):
        return "I understand the foundation, but I would like to see an example."

    def complete_json(self, messages, temperature=0.0):
        return self.json_responses.pop(0)


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
