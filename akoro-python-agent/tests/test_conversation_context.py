from __future__ import annotations

import os
import unittest

os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("AGENT_SERVICE_ENVIRONMENT", "development")

from agent.adaptive.repository import InMemoryLearningRepository
from agent.adaptive.student import StudentAgent
from agent.adaptive.types import AgentProfile
from agent.harness.adaptive_service import build_adaptive_service_runtime
from agent.llm.config import LLMConfig
from agent.memory.akoro_conversation import AkoroConversationClient
from agent.memory.conversation import LearnerConversationContext, RetrievedLearnerMemory
from agent.memory.scratchpad import WorkingScratchpad
from agent.service.api import create_app
from agent.service.settings import ServiceSettings
from fastapi.testclient import TestClient


class CaptureModel:
    def __init__(self) -> None:
        self.calls = []
        self.json_calls = []
        self.json_responses = [
            {"steps": [{"title": "Foundation", "kind": "foundation", "buildsOn": None, "whyNow": "Start here."}]},
            {"goal": "Understand how plants use light.", "progressSummary": "", "completed": [], "plan": [{"step": "Connect light to glucose production.", "status": "in_progress"}], "nextSteps": ["Connect light to glucose production."], "openQuestions": []},
            {"understanding": 70, "confusion": 10, "engagement": 80, "newConceptLearned": "Plants use light energy", "strengths": []},
            {"shouldSave": True, "topic": "Plants", "content": "Plants use light energy to make glucose.", "chunkType": "taught", "confidence": 0.8},
            {"tip": "Ask for one example.", "nextAction": "DIG_DEEPER"},
            {"goal": "Understand how plants use light.", "progressSummary": "Reviewed the role of light.", "completed": ["Reviewed light energy."], "plan": [{"step": "Connect light to glucose production.", "status": "pending"}], "nextSteps": ["Connect light to glucose production."], "openQuestions": []},
        ]

    def complete_text(self, messages, temperature=0.4):
        self.calls.append(messages)
        return "I remember we were discussing how plants use light energy."

    def complete_json(self, messages, temperature=0.0):
        self.json_calls.append(messages)
        return self.json_responses.pop(0)


class ContextTransport:
    def __init__(self) -> None:
        self.calls = []

    def __call__(self, url, payload, headers, _timeout):
        self.calls.append((url, payload, headers))
        if url.endswith("/conversations/context"):
            return {
                "success": True,
                "conversation": {
                    "conversationId": "8ca0532e-20be-49c2-b4df-566d87f0e0e4",
                    "title": "Plant revision",
                    "summary": "Earlier study focused on photosynthesis inputs.",
                    "scratchpad": {
                        "goal": "Continue the learner's photosynthesis revision.",
                        "progressSummary": "Earlier work covered the inputs.",
                        "completed": ["Reviewed photosynthesis inputs."],
                        "plan": [{"step": "Explain the role of light.", "status": "pending"}],
                        "nextSteps": ["Explain the role of light."],
                        "openQuestions": [],
                        "toolState": [],
                    },
                    "messages": [
                        {"role": "user", "content": "Can we continue plants?"},
                        {"role": "assistant", "content": "Yes, let us continue photosynthesis."},
                    ],
                    "memories": [{
                        "id": "memory-1", "kind": "learning_summary",
                        "content": "The learner identified water and carbon dioxide as inputs.",
                        "topic": "Photosynthesis", "subject": "Biology",
                    }],
                },
            }
        if url.endswith("/conversations/relevant-memory"):
            return {
                "success": True,
                "retrieval": "hybrid",
                "memories": [{
                    "id": "memory-older", "source": "memory", "kind": "learning_summary",
                    "content": "Chlorophyll is the pigment that captures light energy.",
                    "topic": "Photosynthesis", "subject": "Biology",
                }],
            }
        if url.endswith("/conversations/turns"):
            return {"success": True, "persistence": {"saved": True, "replayed": False, "assistantMessageId": "message-2"}}
        raise AssertionError(f"unexpected URL {url}")


class FlakyContextTransport(ContextTransport):
    def __init__(self) -> None:
        super().__init__()
        self.persistence_attempts = 0

    def __call__(self, url, payload, headers, timeout):
        if url.endswith("/conversations/turns"):
            self.calls.append((url, payload, headers))
            self.persistence_attempts += 1
            if self.persistence_attempts == 1:
                return {"success": False, "error": "temporary outage"}
            return {"success": True, "persistence": {"saved": True, "replayed": True}}
        return super().__call__(url, payload, headers, timeout)


class ConversationContextTests(unittest.TestCase):
    def test_restored_history_keeps_native_roles_and_total_prompt_budget(self) -> None:
        context = LearnerConversationContext.from_wire({
            "conversationId": "conversation-1",
            "messages": [
                {"role": "user", "text": "first question"},
                {"role": "agent", "text": "first answer"},
            ],
            "summary": "Keep working on the foundations.",
            "memories": [{"id": "1", "kind": "learner_goal", "content": "Prepare for a biology test."}],
        }, "conversation-1")
        history = context.history_for_llm()
        self.assertEqual([(item.role, item.content) for item in history], [
            ("user", "first question"), ("assistant", "first answer"),
        ])
        self.assertIn("Learner goal", context.memory_for_prompt())
        context.append_turn("next question", "next answer")
        self.assertEqual(len(context.messages), 4)
        large = LearnerConversationContext.from_wire({
            "conversationId": "conversation-large",
            "messages": [{"role": "user", "content": str(index) + ("x" * 12_000)} for index in range(40)],
        }, "conversation-large")
        bounded = large.history_for_llm()
        self.assertLessEqual(len(bounded), 24)
        self.assertLessEqual(sum(len(message.content) for message in bounded), 24_000)
        self.assertTrue(bounded[-1].content.startswith("39"))

    def test_scratchpad_compresses_evicted_completed_steps_and_keeps_a_bounded_plan(self) -> None:
        previous = WorkingScratchpad.from_wire({
            "goal": "Revise plants.", "progressSummary": "Started photosynthesis revision.",
            "completed": ["Identified water.", "Identified carbon dioxide."],
            "plan": [{"step": "Explain light.", "status": "in_progress"}],
            "nextSteps": ["Explain light."], "openQuestions": [], "toolState": [],
        }, topic="Plants")
        updated = WorkingScratchpad.from_model({
            "goal": "Revise plants.", "completed": ["Explained light."],
            "plan": [{"step": "Connect light to glucose.", "status": "pending"}],
            "nextSteps": ["Connect light to glucose."], "openQuestions": [],
        }, previous=previous, topic="Plants", tool_state=[])
        self.assertIn("Identified water.", updated.progress_summary)
        self.assertIn("Identified carbon dioxide.", updated.progress_summary)
        self.assertEqual([item.wire() for item in updated.plan], [
            {"step": "Connect light to glucose.", "status": "pending"},
        ])
        self.assertIn("[pending] Connect light to glucose.", updated.prompt())

    def test_llm_gets_summary_memory_prior_user_assistant_and_current_prompt_in_order(self) -> None:
        model = CaptureModel()
        context = LearnerConversationContext.from_wire({
            "conversationId": "conversation-2",
            "summary": "Earlier study focused on photosynthesis inputs.",
            "scratchpad": {"goal": "Answer the learner's light question.", "progressSummary": "Reviewed inputs.", "completed": ["Recalled inputs."], "plan": [{"step": "Explain light.", "status": "pending"}], "nextSteps": ["Explain light."], "openQuestions": []},
            "messages": [
                {"role": "user", "content": "Can we continue plants?"},
                {"role": "assistant", "content": "Yes, let us continue photosynthesis."},
            ],
            "memories": [{"id": "memory-1", "kind": "learning_summary", "content": "Water and carbon dioxide are inputs."}],
        }, "conversation-2")
        context.set_relevant_memories([RetrievedLearnerMemory(
            id="older-memory", source="memory", kind="learning_summary",
            content="Chlorophyll captures light energy for photosynthesis.", topic="Photosynthesis", subject="Biology",
        )])
        student = StudentAgent(
            AgentProfile(id="agent-1", student_id="learner-1"), InMemoryLearningRepository(), model,
            conversation=context,
        )
        student.reply("What does light do?", "Plants", {"understanding": 20, "confusion": 30, "engagement": 60}, [], "Foundation")
        messages = model.calls[0]
        self.assertIn("Earlier study focused", messages[0].content)
        self.assertIn("Water and carbon dioxide", messages[0].content)
        self.assertIn("Chlorophyll captures light", messages[0].content)
        self.assertIn("Semantically retrieved older learner context", messages[0].content)
        self.assertIn("## Active working scratchpad", messages[0].content)
        self.assertIn("Answer the learner's light question.", messages[0].content)
        self.assertEqual([(message.role, message.content) for message in messages[1:]], [
            ("user", "Can we continue plants?"),
            ("assistant", "Yes, let us continue photosynthesis."),
            ("user", "What does light do?"),
        ])

    def test_service_hydrates_authorised_context_and_persists_completed_turn(self) -> None:
        transport = ContextTransport()
        model = CaptureModel()
        settings = ServiceSettings(
            llm=LLMConfig(api_key="test"), environment="development", internal_secret="shared-secret",
            akoro_api_url="https://api.example.test", session_ttl_seconds=600,
        )
        conversation_client = AkoroConversationClient(
            "https://api.example.test/api/internal/agent-tools/v1", "outbound-secret", transport=transport,
        )
        runtime = build_adaptive_service_runtime(
            settings, model=model, repository=InMemoryLearningRepository(), conversation_client=conversation_client,
        )
        client = TestClient(create_app(settings, runtime=runtime))
        headers = {"X-Akoro-Agent-Secret": "shared-secret"}
        started = client.post("/v1/sessions", headers=headers, json={
            "studentId": "learner-1", "topic": "Plants", "subject": "Biology",
            "sessionId": "python-session-1", "toolContext": "opaque-capability",
            "conversationId": "8ca0532e-20be-49c2-b4df-566d87f0e0e4",
        })
        self.assertEqual(started.status_code, 200)
        self.assertEqual(started.json()["conversation"], {
            "conversationId": "8ca0532e-20be-49c2-b4df-566d87f0e0e4", "title": "Plant revision",
            "restoredMessages": 2, "savedMemoryNotes": 1, "hasSummary": True, "hasScratchpad": True, "persistence": "active",
        })
        missing_turn_id = client.post("/v1/sessions/python-session-1/turns", headers=headers, json={
            "message": "This must not be generated without durable turn identity.",
        })
        self.assertEqual(missing_turn_id.status_code, 422)
        completed = client.post("/v1/sessions/python-session-1/turns", headers=headers, json={
            "message": "Light helps plants make food.", "turnId": "turn_context_0001",
        })
        self.assertEqual(completed.status_code, 200)
        self.assertTrue(completed.json()["conversationPersistence"]["saved"])
        self.assertEqual(completed.json()["memoryRetrieval"], {"attempted": True, "mode": "hybrid", "matches": 1})
        self.assertEqual(completed.json()["scratchpad"]["goal"], "Understand how plants use light.")
        self.assertTrue(transport.calls[1][0].endswith("/conversations/relevant-memory"))
        self.assertEqual(transport.calls[1][1]["query"], "Light helps plants make food.")
        self.assertIn("Chlorophyll is the pigment", model.json_calls[1][1].content)
        self.assertTrue(transport.calls[2][0].endswith("/conversations/turns"))
        saved = transport.calls[2][1]
        self.assertEqual(saved["conversationId"], "8ca0532e-20be-49c2-b4df-566d87f0e0e4")
        self.assertEqual(saved["turnId"], "turn_context_0001")
        self.assertEqual(saved["userMessage"], "Light helps plants make food.")
        self.assertIn("Plants use light energy", saved["summary"])
        self.assertEqual(saved["scratchpad"]["goal"], "Understand how plants use light.")
        self.assertEqual(saved["scratchpad"]["plan"], [{"step": "Connect light to glucose production.", "status": "pending"}])
        self.assertEqual(saved["scratchpad"]["nextSteps"], ["Connect light to glucose production."])
        self.assertEqual(saved["memories"][0]["kind"], "learning_summary")

    def test_same_turn_id_retries_persistence_without_generating_a_second_answer(self) -> None:
        transport = FlakyContextTransport()
        model = CaptureModel()
        settings = ServiceSettings(
            llm=LLMConfig(api_key="test"), environment="development", internal_secret="shared-secret",
            akoro_api_url="https://api.example.test", session_ttl_seconds=600,
        )
        runtime = build_adaptive_service_runtime(
            settings, model=model, repository=InMemoryLearningRepository(),
            conversation_client=AkoroConversationClient("https://api.example.test/api/internal/agent-tools/v1", "outbound-secret", transport=transport),
        )
        client = TestClient(create_app(settings, runtime=runtime))
        headers = {"X-Akoro-Agent-Secret": "shared-secret"}
        start = client.post("/v1/sessions", headers=headers, json={
            "studentId": "learner-1", "topic": "Plants", "sessionId": "python-session-3",
            "toolContext": "opaque-capability", "conversationId": "8ca0532e-20be-49c2-b4df-566d87f0e0e4",
        })
        self.assertEqual(start.status_code, 200)
        first = client.post("/v1/sessions/python-session-3/turns", headers=headers, json={
            "message": "Light helps plants make food.", "turnId": "turn_context_retry_1",
        })
        self.assertEqual(first.status_code, 200)
        self.assertFalse(first.json()["conversationPersistence"]["saved"])
        retry = client.post("/v1/sessions/python-session-3/turns", headers=headers, json={
            "message": "Light helps plants make food.", "turnId": "turn_context_retry_1",
        })
        self.assertEqual(retry.status_code, 200)
        self.assertTrue(retry.json()["conversationPersistence"]["saved"])
        self.assertEqual(len(model.calls), 1)
        self.assertEqual(transport.persistence_attempts, 2)
        mismatch = client.post("/v1/sessions/python-session-3/turns", headers=headers, json={
            "message": "A different prompt", "turnId": "turn_context_retry_1",
        })
        self.assertEqual(mismatch.status_code, 422)
        self.assertEqual(len(model.calls), 1)

    def test_durable_conversation_requires_configured_authorised_context(self) -> None:
        settings = ServiceSettings(
            llm=LLMConfig(api_key="test"), environment="development", internal_secret="shared-secret",
            akoro_api_url=None, session_ttl_seconds=600,
        )
        client = TestClient(create_app(settings, CaptureModel(), InMemoryLearningRepository()))
        response = client.post("/v1/sessions", headers={"X-Akoro-Agent-Secret": "shared-secret"}, json={
            "studentId": "learner-1", "topic": "Plants", "sessionId": "python-session-2",
            "toolContext": "opaque-capability", "conversationId": "8ca0532e-20be-49c2-b4df-566d87f0e0e4",
        })
        self.assertEqual(response.status_code, 503)
        self.assertIn("Durable conversation context is not configured", response.text)
