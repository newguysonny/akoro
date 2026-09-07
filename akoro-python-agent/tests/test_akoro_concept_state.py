from __future__ import annotations

import unittest

from agent.adaptive.akoro_concept_state import AkoroConceptStateClient, AkoroConceptStateError
from agent.adaptive.concepts import ConceptObservation
from agent.service.settings import ServiceSettings


CONCEPT_ID = "0e5be9d1-8c57-4f5d-b2ce-9879de1d5000"


class ConceptTransport:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict, dict]] = []

    def __call__(self, url: str, payload: dict, headers: dict, _timeout: float) -> dict:
        self.calls.append((url, payload, headers))
        if url.endswith("/resolve"):
            return {"success": True, "concepts": [{
                "id": CONCEPT_ID, "code": "BIO.PH.01", "title": "Photosynthesis inputs",
                "objective": "Identify water, carbon dioxide, and light.",
                "curriculumKey": "nerdc-jss2-basic-science-v1", "subject": "Biology",
                "topicKey": "photosynthesis", "sourceType": "curriculum",
            }]}
        if url.endswith("/snapshot"):
            return {"success": True, "states": [{
                "conceptId": CONCEPT_ID, "mastery": 0.2, "retention": 0.1,
                "evidenceConfidence": 0.4, "misconceptionActive": False,
                "evidenceCount": 2, "lastRetentionDecayAt": "2026-09-06T00:00:00Z", "stateVersion": 3,
            }]}
        if url.endswith("/observations"):
            return {"success": True, "states": [{
                "conceptId": CONCEPT_ID, "mastery": 0.4, "retention": 0.3,
                "evidenceConfidence": 0.5, "misconceptionActive": False,
                "evidenceCount": 3, "stateVersion": 4,
            }]}
        raise AssertionError(url)


class AkoroConceptStateClientTests(unittest.TestCase):
    def test_session_uses_capability_and_never_forwards_learner_identity(self) -> None:
        transport = ConceptTransport()
        client = AkoroConceptStateClient("https://api.akoro.test/api/internal/agent-tools/v1", "outbound", transport=transport)
        session = client.open_session(
            session_id="python-session-1", tool_context="opaque-capability",
            curriculum_key="NERDC-JSS2-BASIC-SCIENCE-V1", subject="Basic   Science", topic_key="Photosynthesis",
        )
        concepts = session.resolve_active_concepts()
        before = session.snapshot([CONCEPT_ID])
        states = session.record("turn_0001", [ConceptObservation(
            concept_id=CONCEPT_ID, kind="demonstrated_understanding", response_quality=0.8,
            claim_validity=0.9, model_confidence=0.7, claim_status="supported",
            evidence_summary="The reply correctly named the three inputs.",
        )])
        self.assertEqual(concepts[0].id, CONCEPT_ID)
        self.assertEqual(before[0].evidence_count, 2)
        self.assertEqual(before[0].last_retention_decay_at, "2026-09-06T00:00:00Z")
        self.assertEqual(states[0].evidence_count, 3)
        self.assertEqual(transport.calls[0][1]["curriculumKey"], "nerdc-jss2-basic-science-v1")
        self.assertEqual(transport.calls[0][1]["subject"], "Basic Science")
        self.assertNotIn("studentId", transport.calls[2][1])
        self.assertEqual(transport.calls[2][1]["turnId"], "turn_0001")
        self.assertEqual(transport.calls[2][2]["X-Akoro-Tools-Secret"], "outbound")

    def test_explicit_curriculum_scope_is_required(self) -> None:
        client = AkoroConceptStateClient("https://api.akoro.test/tools", "outbound", transport=ConceptTransport())
        with self.assertRaises(AkoroConceptStateError):
            client.open_session(session_id="session", tool_context="capability", curriculum_key=None, subject="Biology", topic_key="Plants")


class ConceptStateSettingsTests(unittest.TestCase):
    def test_feature_requires_the_private_gateway_pair(self) -> None:
        with self.assertRaisesRegex(ValueError, "requires the configured Akoro private gateway"):
            ServiceSettings.from_env({"OPENAI_API_KEY": "test", "AGENT_ENABLE_CONCEPT_STATE": "true"})
        settings = ServiceSettings.from_env({
            "OPENAI_API_KEY": "test", "AGENT_ENABLE_CONCEPT_STATE": "true",
            "AKORO_AGENT_TOOLS_URL": "https://api.akoro.test/tools", "AKORO_AGENT_TOOLS_SECRET": "outbound",
        })
        self.assertTrue(settings.enable_concept_state)


if __name__ == "__main__":
    unittest.main()
