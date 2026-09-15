from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from agent.llm.config import ConfigurationError, LLMConfig
from agent.llm.messages import Message, ToolCall


class MessageTests(unittest.TestCase):
    def test_tool_call_serializes_to_openai_shape(self) -> None:
        message = Message.assistant("", (ToolCall("call-1", "calculator", {"expression": "2+2"}),))
        wire = message.to_openai()
        self.assertEqual(wire["role"], "assistant")
        self.assertEqual(wire["tool_calls"][0]["function"]["name"], "calculator")
        self.assertIn('"expression": "2+2"', wire["tool_calls"][0]["function"]["arguments"])

    def test_tool_result_serializes_without_leaking_python_values(self) -> None:
        wire = Message.tool("call-1", "calculator", {"result": 4}).to_openai()
        self.assertEqual(wire["role"], "tool")
        self.assertEqual(wire["tool_call_id"], "call-1")
        self.assertEqual(wire["content"], '{"result": 4}')


class ConfigTests(unittest.TestCase):
    def test_explicit_environment_overrides_dotenv(self) -> None:
        with TemporaryDirectory() as directory:
            dotenv = Path(directory) / ".env"
            dotenv.write_text("OPENAI_API_KEY=from-file\nAGENT_MAX_STEPS=4\n", encoding="utf-8")
            config = LLMConfig.from_env({"OPENAI_API_KEY": "from-env", "AGENT_MAX_STEPS": "3"}, dotenv)
        self.assertEqual(config.api_key, "from-env")
        self.assertEqual(config.max_steps, 3)

    def test_missing_api_key_is_rejected(self) -> None:
        with self.assertRaises(ConfigurationError):
            LLMConfig.from_env({}, Path("does-not-exist"))
