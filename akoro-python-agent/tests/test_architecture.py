from __future__ import annotations

import unittest

from agent.adaptive.concepts import LearnerConceptState
from agent.adaptive.learner_signals import LearningMeasurement
from agent.memory.session_memory import SessionTranscript
from agent.permissions.internal import InternalServicePolicy
from agent.state.teaching_state import CognitiveProgressState, CognitiveProgressionEngine


class SessionTranscriptTests(unittest.TestCase):
    def test_transcript_validates_roles_and_bounds_live_context(self) -> None:
        transcript = SessionTranscript(max_messages=2)
        transcript.extend([
            {"role": "human_teacher", "content": "one"},
            {"role": "student_agent", "content": "two"},
            {"role": "human_teacher", "content": "three"},
        ])
        self.assertEqual([item["content"] for item in transcript.snapshot()], ["two", "three"])
        with self.assertRaises(ValueError):
            transcript.append({"role": "system", "content": "not a teaching turn"})


class CognitiveProgressionEngineTests(unittest.TestCase):
    def test_high_demonstrated_understanding_advances_one_objective_without_model_phase_input(self) -> None:
        state = CognitiveProgressState()
        transition = CognitiveProgressionEngine().apply(
            state,
            total_objectives=4,
            understanding=0.90,
            confusion=0.10,
            engagement=0.90,
            turn_understanding=0.95,
            agent_level=1,
            knowledge_score=0,
        )
        self.assertTrue(transition.objective_advanced)
        self.assertEqual(transition.current_objective_index, 1)
        self.assertEqual(transition.learning_mode, "advance")
        self.assertEqual(transition.reason, "readiness_threshold_met")
        self.assertFalse(transition.canonical_evidence_used)

    def test_misconception_blocks_advancement_even_if_other_signals_are_high(self) -> None:
        state = CognitiveProgressState()
        transition = CognitiveProgressionEngine().apply(
            state,
            total_objectives=3,
            understanding=0.95,
            confusion=0.05,
            engagement=0.95,
            turn_understanding=0.95,
            agent_level=10,
            knowledge_score=1_000,
            concept_states=[LearnerConceptState(
                "concept-1", mastery=0.9, retention=0.9, evidence_confidence=0.9,
                evidence_count=3, misconception_active=True,
            )],
        )
        self.assertFalse(transition.objective_advanced)
        self.assertEqual(state.objective_index, 0)
        self.assertEqual(transition.learning_mode, "repair")
        self.assertEqual(transition.reason, "active_misconception")

    def test_reviewed_evidence_and_learned_profile_adjust_threshold_transparently(self) -> None:
        novice = CognitiveProgressState()
        experienced = CognitiveProgressState()
        signals = dict(
            total_objectives=2,
            understanding=0.70,
            confusion=0.10,
            engagement=0.80,
            turn_understanding=0.75,
            concept_states=[LearnerConceptState(
                "concept-1", mastery=0.72, retention=0.72, evidence_confidence=0.8, evidence_count=2,
            )],
        )
        engine = CognitiveProgressionEngine()
        novice_transition = engine.apply(novice, agent_level=1, knowledge_score=0, **signals)
        experienced_transition = engine.apply(experienced, agent_level=10, knowledge_score=1_000, **signals)
        self.assertTrue(novice_transition.canonical_evidence_used)
        self.assertLess(experienced_transition.advancement_threshold, novice_transition.advancement_threshold)
        self.assertGreaterEqual(experienced_transition.readiness, novice_transition.readiness)

    def test_low_retention_requests_retrieval_instead_of_advancing(self) -> None:
        state = CognitiveProgressState()
        transition = CognitiveProgressionEngine().apply(
            state,
            total_objectives=3,
            understanding=0.95,
            confusion=0.05,
            engagement=0.95,
            turn_understanding=0.95,
            agent_level=5,
            knowledge_score=300,
            concept_states=[LearnerConceptState(
                "concept-1", mastery=0.95, retention=0.20, evidence_confidence=0.95, evidence_count=3,
            )],
        )
        self.assertFalse(transition.objective_advanced)
        self.assertEqual(transition.learning_mode, "retrieve")
        self.assertEqual(transition.reason, "low_retention")

    def test_a_current_validated_fatigue_signal_holds_progress_for_a_shorter_chunk(self) -> None:
        state = CognitiveProgressState()
        transition = CognitiveProgressionEngine().apply(
            state, total_objectives=3, understanding=.95, confusion=.05, engagement=.95,
            turn_understanding=.95, agent_level=1, knowledge_score=0,
            learner_signal=LearningMeasurement(.90, .80, .85, "causal", "observed"),
        )
        self.assertFalse(transition.objective_advanced)
        self.assertEqual(transition.learning_mode, "clarify")
        self.assertEqual(transition.reason, "fatigue_or_attention_requires_shorter_chunk")
        self.assertTrue(transition.learner_signal_used)
        self.assertEqual(transition.public()["learnerSignalPolicyVersion"], "learner-signals-v1")

    def test_stale_or_not_checked_signal_cannot_change_progress(self) -> None:
        state = CognitiveProgressState()
        transition = CognitiveProgressionEngine().apply(
            state, total_objectives=3, understanding=.95, confusion=.05, engagement=.95,
            turn_understanding=.95, agent_level=1, knowledge_score=0,
            learner_signal=LearningMeasurement(),
        )
        self.assertTrue(transition.objective_advanced)
        self.assertFalse(transition.learner_signal_used)

    def test_mastery_is_recognised_only_at_final_objective_with_high_evidence(self) -> None:
        state = CognitiveProgressState(objective_index=2)
        transition = CognitiveProgressionEngine().apply(
            state,
            total_objectives=3,
            understanding=0.97,
            confusion=0.02,
            engagement=0.95,
            turn_understanding=0.98,
            agent_level=1,
            knowledge_score=0,
            concept_states=[LearnerConceptState(
                "concept-1", mastery=0.98, retention=0.95, evidence_confidence=0.98, evidence_count=4,
            )],
        )
        self.assertTrue(transition.mastery_recognised)
        self.assertTrue(state.mastery_recognised)
        self.assertEqual(transition.learning_mode, "mastery_review")


class InternalServicePolicyTests(unittest.TestCase):
    def test_development_and_production_access_rules(self) -> None:
        self.assertEqual(InternalServicePolicy(None, "development").authorize(None)[0], True)
        denied = InternalServicePolicy(None, "production").authorize(None)
        self.assertEqual(denied[:2], (False, 503))
        self.assertEqual(InternalServicePolicy("secret", "production").authorize("wrong")[:2], (False, 401))
        self.assertEqual(InternalServicePolicy("secret", "production").authorize("secret")[0], True)
