from __future__ import annotations

from datetime import datetime, timezone
import unittest

from agent.adaptive.concepts import (
    ConceptObservation,
    ConceptStatePolicy,
    CurriculumConcept,
    LearnerConceptState,
    encode_concept_condition,
)
from agent.adaptive.repository import InMemoryLearningRepository


PHOTOSYNTHESIS_INPUTS = CurriculumConcept(
    id="0e5be9d1-8c57-4f5d-b2ce-9879de1d5000",
    code="BIO.PH.01",
    title="Photosynthesis inputs",
    objective="Identify light, water, and carbon dioxide as the inputs to photosynthesis.",
    curriculum_key="nerdc-jss2-basic-science-v1",
    subject="Biology",
    topic_key="photosynthesis",
    source_type="curriculum",
)


def observation(**overrides: object) -> ConceptObservation:
    base = {
        "conceptId": PHOTOSYNTHESIS_INPUTS.id,
        "kind": "demonstrated_understanding",
        "responseQuality": 0.8,
        "claimValidity": 0.9,
        "modelConfidence": 0.7,
        "claimStatus": "supported",
        "evidenceSummary": "The reply correctly identified all three inputs.",
    }
    base.update(overrides)
    parsed = ConceptObservation.from_model(base, active_concept_ids=[PHOTOSYNTHESIS_INPUTS.id])
    assert parsed is not None
    return parsed


class ConceptObservationTests(unittest.TestCase):
    def test_model_observations_cannot_create_concepts_or_duplicate_a_concept(self) -> None:
        parsed = ConceptObservation.list_from_model({"observations": [
            {  # plain wire values, not a state delta
                "conceptId": PHOTOSYNTHESIS_INPUTS.id, "kind": "demonstrated_understanding",
                "responseQuality": 0.8, "claimValidity": 0.9, "modelConfidence": 0.7,
                "claimStatus": "supported", "evidenceSummary": "Correctly named the inputs.",
            },
            {
                "conceptId": PHOTOSYNTHESIS_INPUTS.id, "kind": "recall_success",
                "responseQuality": 1, "claimValidity": 1, "modelConfidence": 1,
                "claimStatus": "supported", "evidenceSummary": "Duplicate should be ignored.",
            },
            {
                "conceptId": "invented-concept", "kind": "demonstrated_understanding",
                "responseQuality": 1, "claimValidity": 1, "modelConfidence": 1,
                "claimStatus": "supported", "evidenceSummary": "Must not escape the active catalogue.",
            },
        ]}, active_concept_ids=[PHOTOSYNTHESIS_INPUTS.id])
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0].concept_id, PHOTOSYNTHESIS_INPUTS.id)

    def test_unchecked_claim_never_changes_mastery_or_retention(self) -> None:
        before = LearnerConceptState(PHOTOSYNTHESIS_INPUTS.id, mastery=0.62, retention=0.55)
        transition = ConceptStatePolicy().apply(
            before,
            observation(claimStatus="not_checked", responseQuality=1, claimValidity=1, modelConfidence=1),
            observed_at=datetime(2026, 9, 7, tzinfo=timezone.utc),
        )
        self.assertFalse(transition.applied)
        self.assertEqual(transition.reason, "claim_not_checked")
        self.assertEqual(transition.state.mastery, 0.62)
        self.assertEqual(transition.state.retention, 0.55)
        self.assertEqual(transition.state.evidence_count, 0)

    def test_supported_transition_uses_the_canonical_policy_coefficients(self) -> None:
        transition = ConceptStatePolicy().apply(
            LearnerConceptState(PHOTOSYNTHESIS_INPUTS.id),
            observation(),
            observed_at=datetime(2026, 9, 7, tzinfo=timezone.utc),
        )
        # The same 0.28 mastery, 0.32 retention, and 0.20 evidence-confidence
        # coefficients are implemented by edu.record_learner_concept_evidence.
        self.assertEqual(transition.state.mastery, 0.2282)
        self.assertEqual(transition.state.retention, 0.256)
        self.assertEqual(transition.state.evidence_confidence, 0.14)
        self.assertEqual(transition.state.evidence_count, 1)

    def test_contradicted_misconception_is_visible_but_cannot_increase_mastery(self) -> None:
        before = LearnerConceptState(PHOTOSYNTHESIS_INPUTS.id, mastery=0.62, retention=0.55)
        transition = ConceptStatePolicy().apply(
            before,
            observation(kind="misconception_detected", claimStatus="contradicted", responseQuality=1, claimValidity=0, modelConfidence=1),
            observed_at=datetime(2026, 9, 7, tzinfo=timezone.utc),
        )
        self.assertTrue(transition.applied)
        self.assertTrue(transition.state.misconception_active)
        self.assertLess(transition.state.mastery, before.mastery)
        self.assertLess(transition.state.retention, before.retention)


class ConceptRepositoryTests(unittest.TestCase):
    def test_repository_scopes_catalogue_and_makes_replayed_evidence_idempotent(self) -> None:
        repository = InMemoryLearningRepository([PHOTOSYNTHESIS_INPUTS])
        self.assertEqual(
            repository.resolve_active_concepts("learner-1", "Biology", "Photosynthesis"),
            [PHOTOSYNTHESIS_INPUTS],
        )
        self.assertEqual(repository.resolve_active_concepts("learner-1", "Physics", "Photosynthesis"), [])

        first = repository.record_concept_observations("learner-1", "session-1", "turn-1", [observation()])
        replay = repository.record_concept_observations("learner-1", "session-1", "turn-1", [observation()])
        self.assertEqual(first[0].evidence_count, 1)
        self.assertEqual(replay[0].evidence_count, 1)
        self.assertEqual(replay[0].mastery, first[0].mastery)

    def test_unchecked_evidence_replays_the_default_without_materialising_state(self) -> None:
        repository = InMemoryLearningRepository([PHOTOSYNTHESIS_INPUTS])
        first = repository.record_concept_observations(
            "learner-1", "session-1", "turn-1", [observation(claimStatus="not_checked")],
        )
        replay = repository.record_concept_observations(
            "learner-1", "session-1", "turn-1", [observation(claimStatus="not_checked")],
        )
        snapshot = repository.get_learner_concept_states("learner-1", [PHOTOSYNTHESIS_INPUTS.id])
        self.assertEqual(first[0].evidence_count, 0)
        self.assertEqual(replay[0].evidence_count, 0)
        self.assertEqual(snapshot[0].evidence_count, 0)
        self.assertNotIn(("learner-1", PHOTOSYNTHESIS_INPUTS.id), repository._concept_states)

    def test_condition_is_bounded_canonical_state_not_raw_transcript(self) -> None:
        condition = encode_concept_condition(
            [PHOTOSYNTHESIS_INPUTS],
            [LearnerConceptState(PHOTOSYNTHESIS_INPUTS.id, mastery=0.32, retention=0.24, misconception_active=True)],
        )
        self.assertIn("Curriculum-grounded cognitive condition", condition)
        self.assertIn(PHOTOSYNTHESIS_INPUTS.id, condition)
        self.assertIn("misconception=active", condition)
        self.assertNotIn("Teacher:", condition)
        self.assertLessEqual(len(condition), 3_200)


if __name__ == "__main__":
    unittest.main()


class ConceptSliceModel:
    """One complete turn with an approved concept catalogue, no provider calls."""

    def __init__(self) -> None:
        self.text_calls = []
        self.json = [
            {"steps": [
                {"title": "Inputs", "kind": "foundation", "buildsOn": None, "whyNow": "Start with the inputs."},
                {"title": "Process", "kind": "synthesis", "buildsOn": "Inputs", "whyNow": "Connect them."},
            ]},
            {"goal": "Revise photosynthesis.", "completed": [], "plan": [{"step": "Explain inputs.", "status": "in_progress"}], "nextSteps": ["Explain inputs."], "openQuestions": []},
            {"understanding": 70, "confusion": 20, "engagement": 80, "newConceptLearned": "Inputs", "strengths": ["Named inputs"]},
            {"observations": [{
                "conceptId": PHOTOSYNTHESIS_INPUTS.id, "kind": "demonstrated_understanding",
                "responseQuality": 0.85, "claimValidity": 0.9, "modelConfidence": 0.8,
                "claimStatus": "supported", "evidenceSummary": "The reply named light, water, and carbon dioxide.",
            }]},
            {"shouldSave": True, "topic": "Photosynthesis", "content": "Plants use light, water, and carbon dioxide in photosynthesis.", "chunkType": "taught", "confidence": 0.8},
            {"tip": "Ask your agent to connect those inputs to the products.", "nextAction": "NEXT_SUBTOPIC", "nextPhase": "PHASE_2", "nextMustKnowIndex": 1, "isUrgent": False, "offTopic": False},
            {"goal": "Revise photosynthesis.", "completed": ["Named inputs."], "plan": [{"step": "Explain products.", "status": "pending"}], "nextSteps": ["Explain products."], "openQuestions": []},
        ]

    def complete_text(self, messages, temperature=0.4):
        self.text_calls.append(messages)
        return "I understand that plants need light, water, and carbon dioxide before they can make food."

    def complete_json(self, messages, temperature=0.0):
        return self.json.pop(0)


class ConceptVerticalSliceTests(unittest.TestCase):
    def test_approved_concept_is_conditioned_then_updated_from_an_observation(self) -> None:
        from agent.adaptive.orchestrator import AdaptiveTeachingOrchestrator
        from agent.adaptive.types import AdaptiveSession

        repository = InMemoryLearningRepository([PHOTOSYNTHESIS_INPUTS])
        model = ConceptSliceModel()
        loop = AdaptiveTeachingOrchestrator(
            repository, model,
            AdaptiveSession(session_id="concept-session", student_id="learner-1", topic="Photosynthesis", subject="Biology"),
        )
        ready = loop.initialize()
        self.assertTrue(ready["conceptTracking"]["enabled"])
        self.assertEqual(ready["conceptTracking"]["concepts"], [PHOTOSYNTHESIS_INPUTS.public()])

        result = loop.process_teaching_message("Plants need light, water, and carbon dioxide.")
        tracking = result["adaptiveEngine"]["conceptTracking"]
        self.assertTrue(tracking["enabled"])
        self.assertEqual(tracking["submitted"], 1)
        self.assertGreater(tracking["states"][0]["mastery"], 0)
        self.assertIn("## Curriculum-grounded cognitive condition", model.text_calls[0][0].content)
        self.assertIn(PHOTOSYNTHESIS_INPUTS.id, model.text_calls[0][0].content)
