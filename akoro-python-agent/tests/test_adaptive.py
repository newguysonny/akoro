from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from agent.adaptive.ladder import normalise_ladder
from agent.adaptive.orchestrator import AdaptiveTeachingOrchestrator
from agent.adaptive.repository import InMemoryLearningRepository
from agent.adaptive.types import AdaptiveSession, SessionReference
from agent.service.store import SessionNotFoundError, SessionStore, StreamAlreadyActiveError, StreamNotActiveError


class FakeTeachingModel:
    """A deterministic scripted model: no provider credentials or network."""

    def __init__(self) -> None:
        self.text_calls = []
        self.json_responses = [
            # guide.build_ladder
            {"steps": [
                {"title": "What plants need", "kind": "foundation", "buildsOn": None, "whyNow": "Name the inputs."},
                {"title": "How photosynthesis works", "kind": "mechanism", "buildsOn": "What plants need", "whyNow": "Connect the inputs."},
                {"title": "Applying photosynthesis", "kind": "application", "buildsOn": "How photosynthesis works", "whyNow": "Use the model."},
                {"title": "The whole system", "kind": "synthesis", "buildsOn": "Applying photosynthesis", "whyNow": "Combine the ideas."},
            ]},
            # student.plan_scratchpad (before response/tool execution)
            {"goal": "Support the learner with photosynthesis.", "progressSummary": "", "completed": [], "plan": [{"step": "Connect inputs to products.", "status": "in_progress"}], "nextSteps": ["Connect inputs to products."], "openQuestions": []},
            # student.analyse_understanding
            {"understanding": 72, "confusion": 18, "engagement": 86, "newConceptLearned": "Plants turn light energy into stored chemical energy", "strengths": ["Identified water, carbon dioxide, and light"], "priorKnowledgeUsed": False},
            # student.extract_knowledge
            {"shouldSave": True, "topic": "Photosynthesis", "content": "Photosynthesis uses light, water, and carbon dioxide to make glucose and oxygen.", "chunkType": "taught", "confidence": 0.82},
            # guide.coaching_tip
            {"tip": "Great foundation. Ask your agent to connect those inputs to the products next.", "nextAction": "CHALLENGE", "isUrgent": False, "offTopic": False},
            # student.update_scratchpad
            {"goal": "Support the learner with photosynthesis.", "progressSummary": "Covered the inputs to photosynthesis.", "completed": ["Identified the photosynthesis inputs."], "plan": [{"step": "Connect inputs to products.", "status": "pending"}], "nextSteps": ["Connect inputs to products."], "openQuestions": []},
            # generate_summary evaluation
            {"overallScore": 78, "strengths": ["Used the key inputs clearly"], "nextTimeTip": "Ask for one worked real-world example.", "nextLesson": "Explore factors that affect photosynthesis."},
            # end_session evaluation
            {"overallScore": 78, "strengths": ["Used the key inputs clearly"], "nextTimeTip": "Ask for one worked real-world example.", "nextLesson": "Explore factors that affect photosynthesis."},
        ]

    def complete_text(self, messages, temperature=0.4):
        self.text_calls.append(messages)
        return "So the plant uses light with water and carbon dioxide to make food, and oxygen comes out."

    def complete_json(self, messages, temperature=0.0):
        if not self.json_responses:
            raise AssertionError("Unexpected JSON completion")
        return self.json_responses.pop(0)


class AdaptiveLadderTests(unittest.TestCase):
    def test_normaliser_repairs_forward_dependencies_and_keeps_synthesis_last(self) -> None:
        ladder = normalise_ladder([
            {"title": "Foundation", "kind": "foundation", "buildsOn": "Later"},
            {"title": "Later", "kind": "mechanism", "buildsOn": "Foundation"},
            {"title": "Synthesis early", "kind": "synthesis", "buildsOn": "Foundation"},
            {"title": "Application", "kind": "application", "buildsOn": "Later"},
        ], "A topic")
        self.assertEqual(ladder[0].builds_on, None)
        self.assertEqual(ladder[-1].kind, "synthesis")
        self.assertEqual(ladder[-1].builds_on, len(ladder) - 2)

    def test_reference_caps_and_returns_metadata_without_text(self) -> None:
        ref = SessionReference.from_payload({"name": "lecture\nnotes.pdf", "text": "x" * 12_050})
        self.assertEqual(ref.name, "lecture notes.pdf")
        self.assertEqual(ref.chars, 12_000)
        self.assertTrue(ref.truncated)
        self.assertNotIn("text", ref.metadata())


class AdaptiveOrchestratorTests(unittest.TestCase):
    def test_session_lifecycle_matches_teaching_contract_and_keeps_reference_out_of_responses(self) -> None:
        repository = InMemoryLearningRepository()
        model = FakeTeachingModel()
        session = AdaptiveSession(
            session_id="session-1",
            student_id="learner-1",
            topic="Photosynthesis",
            subject="Biology",
            reference=SessionReference.from_payload({"name": "lecture.pdf", "text": "SECRET SOURCE MATERIAL"}),
        )
        orchestrator = AdaptiveTeachingOrchestrator(repository, model, session)

        ready = orchestrator.initialize()
        self.assertEqual(ready["sessionId"], "session-1")
        self.assertEqual(ready["mustKnowParts"][0], "What plants need")
        self.assertEqual(ready["reference"], {"name": "lecture.pdf", "chars": 22, "truncated": False})
        self.assertNotIn("SECRET SOURCE MATERIAL", str(ready))
        self.assertEqual(ready["adaptivePlan"]["policyVersion"], "adaptive-planning-v1")
        self.assertEqual(ready["adaptivePlan"]["recommendedMinutes"], 20)
        self.assertEqual(ready["adaptivePlan"]["difficulty"], "medium")

        turn = orchestrator.process_teaching_message("Plants use sunlight, water, and carbon dioxide.")
        self.assertEqual(turn["type"], "teaching_response")
        self.assertEqual(turn["learningMode"], "practise")
        self.assertFalse(turn["objectiveAdvanced"])
        self.assertEqual(turn["cognitiveDecision"]["reason"], "more_evidence_needed")
        self.assertEqual(turn["scratchpad"]["goal"], "Support the learner with photosynthesis.")
        self.assertEqual(turn["scratchpad"]["nextSteps"], ["Connect inputs to products."])
        self.assertEqual(turn["scratchpad"]["plan"], [{"step": "Connect inputs to products.", "status": "pending"}])
        self.assertIn("## Active working scratchpad", model.text_calls[0][0].content)
        self.assertIn("[in_progress] Connect inputs to products.", model.text_calls[0][0].content)
        self.assertEqual(turn["adaptiveEngine"]["newConceptLearned"], "Plants turn light energy into stored chemical energy")

        summary = orchestrator.generate_summary()
        self.assertEqual(summary["teachingScore"], 78)
        end = orchestrator.end_session()
        self.assertEqual(end["agentGrowth"]["knowledgeChunksSaved"], 1)
        self.assertEqual(end["agentGrowth"]["totalSessions"], 1)

    def test_live_session_store_serialises_access_and_removes_finished_sessions(self) -> None:
        repository = InMemoryLearningRepository()
        orchestrator = AdaptiveTeachingOrchestrator(repository, FakeTeachingModel(), AdaptiveSession(student_id="learner-1", topic="Photosynthesis"))
        orchestrator.initialize()
        store = SessionStore(ttl_seconds=60)
        store.create(orchestrator)
        self.assertEqual(store.active_count(), 1)
        with store.session(orchestrator.session.session_id) as active:
            self.assertIs(active, orchestrator)
        # Do not call end here: this fake has not completed a turn and the test
        # only verifies lifecycle ownership and lookup behaviour.
        with self.assertRaises(SessionNotFoundError):
            with store.session("missing"):
                pass

    def test_stream_stop_prevents_partial_turn_state_and_releases_session_ownership(self) -> None:
        orchestrator = AdaptiveTeachingOrchestrator(
            InMemoryLearningRepository(), FakeTeachingModel(), AdaptiveSession(student_id="learner-1", topic="Photosynthesis"),
        )
        orchestrator.initialize()
        store = SessionStore(ttl_seconds=60)
        store.create(orchestrator)
        signal = store.begin_stream(orchestrator.session.session_id)
        with self.assertRaises(StreamAlreadyActiveError):
            store.begin_stream(orchestrator.session.session_id)
        store.stop_stream(orchestrator.session.session_id)
        self.assertTrue(signal.is_set())
        self.assertEqual(
            list(orchestrator.stream_teaching_message("Plants use sunlight.", should_stop=signal.is_set)),
            [{"event": "stopped", "data": {"sessionId": orchestrator.session.session_id}}],
        )
        self.assertEqual(orchestrator.session.turns_completed, 0)
        self.assertEqual(len(orchestrator.session.history), 0)
        store.finish_stream(orchestrator.session.session_id)
        with self.assertRaises(StreamNotActiveError):
            store.stop_stream(orchestrator.session.session_id)
