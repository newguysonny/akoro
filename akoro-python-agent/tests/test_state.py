from __future__ import annotations

import unittest

from agent.reasoning.planner import Planner
from agent.state.agent_state import AgentState, RunStatus


class StateTests(unittest.TestCase):
    def test_state_tracks_run_and_tool_events(self) -> None:
        state = AgentState()
        state.start(Planner().create("Calculate something"))
        state.next_iteration()
        state.record_tool("calculator", True, {"result": 4})
        state.complete()
        self.assertEqual(state.status, RunStatus.COMPLETED)
        self.assertEqual(state.iterations, 1)
        self.assertEqual(state.tool_events[0].summary, "4")

    def test_state_rejects_advancing_when_not_running(self) -> None:
        with self.assertRaises(RuntimeError):
            AgentState().next_iteration()
