from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from agent.harness.harness import build_agent
from agent.llm.client import LLMResponse
from agent.llm.config import LLMConfig
from agent.llm.messages import ToolCall
from agent.state.agent_state import RunStatus


class CalculatorThenAnswerClient:
    def __init__(self) -> None:
        self.calls = 0
        self.transcripts = []

    def complete(self, messages, tools):
        self.calls += 1
        self.transcripts.append(messages)
        if self.calls == 1:
            return LLMResponse("", (ToolCall("tool-1", "calculator", {"expression": "19 * (6 + 3)"}),))
        if not any(message.role == "tool" and "171" in message.content for message in messages):
            raise AssertionError("Expected the calculator result in the follow-up transcript")
        return LLMResponse("The result is 171.")


class ForbiddenToolClient:
    def complete(self, messages, tools):
        return LLMResponse("", (ToolCall("tool-1", "delete_everything", {}),))


class AgentLoopTests(unittest.TestCase):
    def test_loop_executes_a_permitted_tool_then_returns_answer(self) -> None:
        with TemporaryDirectory() as directory:
            harness = build_agent(LLMConfig(api_key="test", max_steps=3), CalculatorThenAnswerClient(), Path(directory))
            result = harness.run("What is 19 times 9?")
        self.assertEqual(result.answer, "The result is 171.")
        self.assertEqual(result.state.status, RunStatus.COMPLETED)
        self.assertEqual(result.state.tool_events[0].name, "calculator")
        self.assertTrue(result.state.tool_events[0].allowed)

    def test_forbidden_tool_is_recorded_and_never_executed(self) -> None:
        with TemporaryDirectory() as directory:
            harness = build_agent(LLMConfig(api_key="test", max_steps=1), ForbiddenToolClient(), Path(directory))
            result = harness.run("Do something unsafe")
        self.assertEqual(result.state.status, RunStatus.COMPLETED)
        self.assertFalse(result.state.tool_events[0].allowed)
        self.assertIn("tool-use limit", result.answer)
