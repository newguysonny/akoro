from __future__ import annotations

import unittest

from agent.adaptive.akoro_learning_insights import AkoroLearningInsightsClient
from agent.adaptive.concepts import ConceptObservation
from agent.adaptive.learner_signals import (
    LearnerTeachingProfile,
    LearningMeasurement,
    LearningSignalJudge,
    episode_from_observations,
)


class JudgeModel:
    def __init__(self, payload):
        self.payload = payload
        self.messages = []

    def complete_json(self, messages, temperature=0):
        self.messages.append(messages)
        return self.payload


class InsightsTransport:
    def __init__(self):
        self.calls = []

    def __call__(self, url, payload, headers, _timeout):
        self.calls.append((url, payload, headers))
        if url.endswith("/snapshot"):
            return {
                "success": True,
                "profile": {
                    "evidenceCount": 4, "profileConfidence": 0.6667,
                    "meanAttention": 0.71, "meanFatigue": 0.22,
                    "meanReasoningQuality": 0.70, "reasoningStyle": "causal",
                    "pacingRecommendation": "steady", "policyVersion": "learner-signals-v1",
                },
                "episodes": [{"kind": "verified_progress", "summary": "Verified progress recorded for Inputs.", "occurredAt": "2026-09-07T12:00:00Z"}],
            }
        assert url.endswith("/measurements")
        return {"success": True, "profile": {"evidenceCount": 5, "profileConfidence": 0.8333, "reasoningStyle": "causal", "pacingRecommendation": "steady"}}


class LearnerSignalsTests(unittest.TestCase):
    def test_judge_requires_explicit_observed_status_and_keeps_no_rationale(self):
        model = JudgeModel({"measurement": {
            "measurementStatus": "observed", "attention": 0.9, "fatigue": 0.1,
            "reasoningQuality": 0.8, "reasoningStyle": "causal", "rationale": "must be ignored",
        }})
        measurement = LearningSignalJudge(model).assess("First, water enters the leaf, so the plant can use it with light.")
        self.assertEqual(measurement.measurement_status, "observed")
        self.assertEqual(measurement.reasoning_style, "causal")
        self.assertNotIn("rationale", measurement.wire())
        self.assertNotIn("rationale", measurement.public())
        self.assertIn("learnerMessage", model.messages[0][1].content)

    def test_malformed_or_ambiguous_judge_is_not_checked(self):
        self.assertEqual(LearningSignalJudge(JudgeModel({"measurement": {"measurementStatus": "observed"}})).assess("This sentence has enough length to reach the judge.").measurement_status, "not_checked")
        self.assertEqual(LearningSignalJudge(JudgeModel({"measurement": {"measurementStatus": "observed", "attention": 1, "fatigue": 0, "reasoningQuality": 1, "reasoningStyle": "not_observed"}})).assess("This sentence has enough length to reach the judge.").measurement_status, "not_checked")

    def test_profile_is_a_soft_cue_until_it_has_multiple_measurements(self):
        sparse = LearnerTeachingProfile.from_wire({"evidenceCount": 2, "profileConfidence": 0.4, "reasoningStyle": "causal", "pacingRecommendation": "stretch"})
        mature = LearnerTeachingProfile.from_wire({"evidenceCount": 3, "profileConfidence": 0.5, "reasoningStyle": "causal", "pacingRecommendation": "steady"})
        self.assertIn("insufficient", sparse.prompt_line())
        self.assertIn("soft presentation cue", mature.prompt_line())

    def test_only_guardian_supported_observations_produce_a_compact_episode(self):
        rejected = ConceptObservation("concept-1", "demonstrated_understanding", .9, 0, .9, "not_checked", "Not checked.")
        retrieved = ConceptObservation("concept-2", "recall_success", .9, .9, .9, "supported", "Supported.")
        self.assertIsNone(episode_from_observations((rejected,)))
        episode = episode_from_observations((rejected, retrieved))
        self.assertEqual(episode.wire(), {"conceptId": "concept-2", "kind": "retrieval_practice"})

    def test_private_client_sends_scores_only_and_never_a_raw_reply(self):
        transport = InsightsTransport()
        session = AkoroLearningInsightsClient("https://api.test/internal", "outbound", transport=transport).open_session(
            session_id="session_1", tool_context="capability",
        )
        profile, episodes = session.snapshot()
        self.assertEqual(profile.evidence_count, 4)
        self.assertEqual(episodes[0]["summary"], "Verified progress recorded for Inputs.")
        session.record("turn_1", LearningMeasurement(.8, .1, .7, "causal", "observed"), None)
        wire = transport.calls[-1][1]
        self.assertNotIn("learnerReply", str(wire))
        self.assertEqual(wire["measurement"]["reasoningStyle"], "causal")


if __name__ == "__main__":
    unittest.main()
