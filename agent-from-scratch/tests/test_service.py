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
from agent.llm.config import LLMConfig
from agent.service.api import create_app
from agent.service.settings import ServiceSettings


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
