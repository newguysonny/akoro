from __future__ import annotations

import unittest

from agent.memory.session_memory import SessionTranscript
from agent.permissions.internal import InternalServicePolicy
from agent.state.teaching_state import ProgressionPolicy, TeachingState


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


class ProgressionPolicyTests(unittest.TestCase):
    def test_policy_allows_one_rung_and_one_phase_at_a_time(self) -> None:
        state = TeachingState()
        transition = ProgressionPolicy().apply(
            state, requested_phase="PHASE_4", requested_index=99, total_subtopics=4, understanding=0.9,
        )
        self.assertEqual(state.phase, "PHASE_1")
        self.assertEqual(state.subtopic_index, 1)
        self.assertFalse(transition.phase_changed)
        self.assertTrue(transition.subtopic_advanced)

    def test_mastery_needs_final_rung_and_sufficient_evidence(self) -> None:
        state = TeachingState(phase="PHASE_4", subtopic_index=2)
        policy = ProgressionPolicy()
        policy.apply(state, requested_phase="MASTERY", requested_index=3, total_subtopics=4, understanding=0.5)
        self.assertEqual(state.phase, "PHASE_4")
        policy.apply(state, requested_phase="MASTERY", requested_index=3, total_subtopics=4, understanding=0.8)
        self.assertEqual(state.phase, "MASTERY")


class InternalServicePolicyTests(unittest.TestCase):
    def test_development_and_production_access_rules(self) -> None:
        self.assertEqual(InternalServicePolicy(None, "development").authorize(None)[0], True)
        denied = InternalServicePolicy(None, "production").authorize(None)
        self.assertEqual(denied[:2], (False, 503))
        self.assertEqual(InternalServicePolicy("secret", "production").authorize("wrong")[:2], (False, 401))
        self.assertEqual(InternalServicePolicy("secret", "production").authorize("secret")[0], True)
