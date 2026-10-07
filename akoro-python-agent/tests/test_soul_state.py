from __future__ import annotations

import unittest

from agent.adaptive.akoro_soul_state import AkoroSoulStateClient
from agent.adaptive.soul_state import SoulState


class SoulTransport:
    def __init__(self):
        self.calls = []

    def __call__(self, url, payload, headers, _timeout):
        self.calls.append((url, payload, headers))
        return {
            "success": True,
            "preferences": {
                "interactionStyle": "socratic", "responseTone": "curious",
                "challengeLevel": "stretch", "encouragementLevel": "minimal",
            },
            "checkIn": {
                "feeling": "tired", "studyContext": "distracted", "studyIntent": "prepare",
                "requestedSupport": "slower_steps", "expiresAt": "2026-09-07T20:00:00Z",
            },
            "episodes": [{"kind": "verified_progress", "summary": "Verified progress recorded for Fractions."}],
        }


class SoulStateTests(unittest.TestCase):
    def test_state_contains_only_explicit_controls_checkin_and_compact_episode_cues(self):
        state = SoulState.from_wire({
            "preferences": {"interactionStyle": "collaborative", "responseTone": "calm", "challengeLevel": "adaptive", "encouragementLevel": "balanced"},
            "checkIn": {"feeling": "stuck", "studyContext": "rushed", "studyIntent": "recover", "requestedSupport": "more_examples"},
            "episodes": [{"kind": "retrieval_practice", "summary": "Retrieval practice recorded for Fractions.", "rawMessage": "must not survive"}],
        })
        public = state.public()
        self.assertEqual(public["checkIn"]["feeling"], "stuck")
        self.assertEqual(public["narrativeEpisodeCount"], 1)
        condition = state.prompt_condition()
        self.assertIn("not inferred emotions, identity, or ability", condition)
        self.assertIn("more_examples", condition)
        self.assertNotIn("must not survive", condition)

    def test_invalid_values_fall_back_to_safe_defaults(self):
        state = SoulState.from_wire({
            "preferences": {"interactionStyle": "dependent", "responseTone": "manipulative"},
            "checkIn": {"feeling": "diagnosed", "studyContext": "private", "studyIntent": "other", "requestedSupport": "tell_me_what_to_do"},
        })
        self.assertEqual(state.preferences.interaction_style, "balanced")
        self.assertEqual(state.preferences.response_tone, "calm")
        self.assertEqual(state.check_in.feeling, "steady")
        self.assertEqual(state.check_in.requested_support, "none")

    def test_private_gateway_client_is_read_only_and_uses_capability_not_learner_id(self):
        transport = SoulTransport()
        state = AkoroSoulStateClient("https://api.test/internal", "secret", transport=transport).open_session(
            session_id="session_1", tool_context="opaque-capability",
        ).snapshot()
        self.assertEqual(state.preferences.interaction_style, "socratic")
        url, payload, headers = transport.calls[0]
        self.assertTrue(url.endswith("/soul-state/snapshot"))
        self.assertEqual(payload, {"sessionId": "session_1", "toolContext": "opaque-capability"})
        self.assertNotIn("learnerId", payload)
        self.assertEqual(headers["X-Akoro-Tools-Secret"], "secret")


if __name__ == "__main__":
    unittest.main()
