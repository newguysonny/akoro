from __future__ import annotations

import unittest

from agent.adaptive.concepts import ConceptObservation, CurriculumConcept
from agent.adaptive.guardian import CurriculumGuardian


CONCEPT = CurriculumConcept(
    id="0e5be9d1-8c57-4f5d-b2ce-9879de1d5000",
    code="BIO.PH.01",
    title="Photosynthesis inputs",
    objective="Identify light, water, and carbon dioxide as the inputs to photosynthesis.",
    curriculum_key="nerdc-jss2-basic-science-v1",
    subject="Biology",
    topic_key="photosynthesis",
)

CANDIDATE = ConceptObservation(
    concept_id=CONCEPT.id,
    kind="demonstrated_understanding",
    response_quality=0.85,
    claim_validity=1.0,
    model_confidence=1.0,
    claim_status="supported",
    evidence_summary="Candidate judge says all inputs were named.",
)


class GuardianModel:
    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.messages = []

    def complete_json(self, messages, temperature=0):
        self.messages.append(messages)
        return self.payload


class CurriculumGuardianTests(unittest.TestCase):
    def test_guardian_overrides_candidate_only_with_quote_grounded_in_reply_and_objective(self) -> None:
        model = GuardianModel({"validations": [{
            "conceptId": CONCEPT.id,
            "claimStatus": "supported",
            "claimValidity": 0.91,
            "modelConfidence": 0.88,
            "evidenceQuote": "light, water, and carbon dioxide",
            "reason": "The approved objective names these same three inputs.",
        }]})
        observation = CurriculumGuardian(model).validate(
            "A plant needs light, water, and carbon dioxide for photosynthesis.",
            (CANDIDATE,),
            (CONCEPT,),
        )[0]
        self.assertEqual(observation.claim_status, "supported")
        self.assertEqual(observation.claim_validity, 0.91)
        self.assertEqual(observation.model_confidence, 0.88)
        self.assertIn("Evidence: light, water, and carbon dioxide", observation.evidence_summary)
        # The Guardian receives an objective from the reviewed catalogue, not
        # arbitrary search or retrieval context.
        request = model.messages[0][1].content
        self.assertIn(CONCEPT.objective, request)
        self.assertNotIn("http", request)

    def test_invented_or_missing_quote_falls_back_to_a_ledger_only_observation(self) -> None:
        model = GuardianModel({"validations": [{
            "conceptId": CONCEPT.id,
            "claimStatus": "supported",
            "claimValidity": 1.0,
            "modelConfidence": 1.0,
            "evidenceQuote": "invented quote not said by the learner",
            "reason": "Ungrounded assertion.",
        }]})
        observation = CurriculumGuardian(model).validate(
            "A plant needs light, water, and carbon dioxide for photosynthesis.",
            (CANDIDATE,),
            (CONCEPT,),
        )[0]
        self.assertEqual(observation.claim_status, "not_checked")
        self.assertEqual(observation.claim_validity, 0.0)
        self.assertIn("guardian_quote_not_grounded", observation.evidence_summary)

    def test_malformed_guardian_result_is_safe_not_checked(self) -> None:
        observation = CurriculumGuardian(GuardianModel({"wrong": []})).validate(
            "A plant needs light, water, and carbon dioxide.", (CANDIDATE,), (CONCEPT,),
        )[0]
        self.assertEqual(observation.claim_status, "not_checked")
        self.assertEqual(observation.evidence_summary, "Guardian did not verify this claim: guardian_response_invalid.")


if __name__ == "__main__":
    unittest.main()
