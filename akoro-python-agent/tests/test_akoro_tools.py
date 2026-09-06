from __future__ import annotations

import unittest

from agent.llm.client import LLMResponse
from agent.llm.messages import ToolCall
from agent.loop.tool_calling import TeachingToolLoop
from agent.tools.akoro_api import AkoroToolDefinition, AkoroToolsClient


class RecordingTransport:
    def __init__(self, catalogue: list[dict], result: dict | None = None) -> None:
        self.catalogue = catalogue
        self.result = result or {"success": True, "result": {"completion": 42}}
        self.calls: list[tuple[str, dict, dict]] = []

    def __call__(self, url: str, payload: dict, headers: dict, _timeout: float) -> dict:
        self.calls.append((url, payload, headers))
        if url.endswith("/catalog"):
            return {"tools": self.catalogue}
        return self.result


class ScriptedToolModel:
    def __init__(self) -> None:
        self.calls = []

    def complete(self, messages, tools):
        self.calls.append((messages, tools))
        if len(self.calls) == 1:
            return LLMResponse("", (ToolCall("lookup-1", "check_progress", {}),))
        return LLMResponse("Your completion is 42 percent.")


class AkoroToolsTests(unittest.TestCase):
    def test_flexible_backend_schemas_are_not_misrepresented_as_openai_strict(self) -> None:
        flexible = AkoroToolDefinition.from_wire({
            "name": "get_weak_topics", "description": "Read weak topics.",
            "inputSchema": {"type": "object", "properties": {"subject": {"type": "string"}}, "required": []},
        })
        strict = AkoroToolDefinition.from_wire({
            "name": "check_progress", "description": "Read progress.",
            "inputSchema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
        })
        self.assertNotIn("strict", flexible.schema()["function"])
        self.assertTrue(strict.schema()["function"]["strict"])

    def test_catalogue_is_session_scoped_and_invocation_relays_opaque_context(self) -> None:
        transport = RecordingTransport([
            {
                "name": "check_progress",
                "description": "Read the student's current course progress.",
                "input_schema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
                "maxCalls": 2,
            },
        ])
        client = AkoroToolsClient("https://api.akoro.test/api/internal/agent-tools/v1", "outbound-secret", transport=transport)
        tools = client.open_session("session-1", "opaque-capability", max_calls=3)

        self.assertTrue(tools.enabled)
        self.assertEqual(tools.schemas()[0]["function"]["name"], "check_progress")
        result = tools.invoke(ToolCall("call-1", "check_progress", {}))
        self.assertEqual(result, {"success": True, "result": {"completion": 42}})
        self.assertEqual(transport.calls[0][0], "https://api.akoro.test/api/internal/agent-tools/v1/catalog")
        self.assertEqual(transport.calls[1][0], "https://api.akoro.test/api/internal/agent-tools/v1/invoke")
        self.assertEqual(transport.calls[1][1]["toolContext"], "opaque-capability")
        self.assertEqual(transport.calls[1][1]["idempotencyKey"], "call-1")
        self.assertEqual(transport.calls[1][2]["X-Akoro-Tools-Secret"], "outbound-secret")
        self.assertEqual(tools.drain_executions(), [{"tool": "check_progress", "success": True, "sideEffecting": False}])

    def test_side_effecting_catalogue_tools_are_denied_by_default(self) -> None:
        transport = RecordingTransport([
            {
                "name": "create_task",
                "description": "Create a task.",
                "inputSchema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
                "sideEffecting": True,
            },
        ])
        tools = AkoroToolsClient("https://api.akoro.test/tools", "secret", transport=transport).open_session(
            "session-1", "opaque-capability", max_calls=3,
        )
        result = tools.invoke(ToolCall("write-1", "create_task", {}))
        self.assertFalse(result["success"])
        self.assertIn("disabled", result["error"])
        self.assertEqual(len(transport.calls), 1, "The invocation must never reach Akoro API")

    def test_scheduled_chat_follow_up_is_relayed_only_when_writes_are_enabled(self) -> None:
        transport = RecordingTransport([
            {
                "name": "schedule_chat_follow_up",
                "description": "Schedule a new agent chat.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"message": {"type": "string"}, "scheduledAt": {"type": "string"}},
                    "required": ["message", "scheduledAt"],
                },
                "sideEffecting": True,
            },
        ], result={"success": True, "result": {"scheduled": True, "followUpId": "follow-up-1"}})
        tools = AkoroToolsClient("https://api.akoro.test/tools", "secret", transport=transport).open_session(
            "session-1", "opaque-capability", max_calls=3, allow_side_effects=True,
        )
        result = tools.invoke(ToolCall("schedule-1", "schedule_chat_follow_up", {
            "message": "Ready for your revision?", "scheduledAt": "2026-09-08T14:00:00+01:00",
        }))
        self.assertEqual(result["result"]["followUpId"], "follow-up-1")
        self.assertEqual(transport.calls[1][1]["tool"], "schedule_chat_follow_up")

    def test_tool_loop_feeds_bounded_result_back_to_the_model(self) -> None:
        transport = RecordingTransport([
            {
                "name": "check_progress",
                "description": "Read progress.",
                "inputSchema": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
            },
        ])
        tools = AkoroToolsClient("https://api.akoro.test/tools", "secret", transport=transport).open_session(
            "session-1", "opaque-capability", max_calls=3,
        )
        model = ScriptedToolModel()
        answer = TeachingToolLoop().respond(model, [], tools)

        self.assertEqual(answer.content, "Your completion is 42 percent.")
        self.assertFalse(answer.hit_limit)
        self.assertEqual(answer.executions, ({"tool": "check_progress", "success": True, "sideEffecting": False},))
        tool_messages = [message for message in model.calls[1][0] if message.role == "tool"]
        self.assertEqual(len(tool_messages), 1)
        self.assertIn('"completion": 42', tool_messages[0].content)
