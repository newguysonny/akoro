from __future__ import annotations

import unittest

from agent.llm.client import LLMResponse
from agent.llm.messages import ToolCall
from agent.loop.tool_calling import TeachingToolLoop
from agent.tools.akoro_api import AkoroToolDefinition, AkoroToolsClient


class RecordingTransport:
    def __init__(self, catalogue: list[dict], result: dict | None = None,
                 confirmation: dict | None = None, confirmed_result: dict | None = None) -> None:
        self.catalogue = catalogue
        self.result = result or {"success": True, "result": {"completion": 42}}
        self.confirmation = confirmation or {
            "success": True,
            "result": {
                "requiresConfirmation": True,
                "confirmationId": "3ea5f00a-13e5-4acf-aef0-bb0427e6acb4",
                "preview": {"kind": "create_task", "title": "Revise biology"},
            },
        }
        self.confirmed_result = confirmed_result or {
            "success": True,
            "confirmedTool": "create_task",
            "result": {"created": True, "title": "Revise biology"},
        }
        self.calls: list[tuple[str, dict, dict]] = []

    def __call__(self, url: str, payload: dict, headers: dict, _timeout: float) -> dict:
        self.calls.append((url, payload, headers))
        if url.endswith("/catalog"):
            return {"tools": self.catalogue}
        if url.endswith("/confirmations"):
            return self.confirmation
        if url.endswith("/execute-confirmed"):
            return self.confirmed_result
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

    def test_side_effecting_catalogue_tools_are_denied_without_proposals(self) -> None:
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
        self.assertEqual(len(transport.calls), 1, "The proposal must never reach Akoro API without its gate")

    def test_side_effecting_tool_stages_a_review_card_and_never_invokes_directly(self) -> None:
        transport = RecordingTransport([
            {
                "name": "schedule_chat_follow_up",
                "description": "Schedule a new agent chat.",
                "inputSchema": {
                    "type": "object", "properties": {"message": {"type": "string"}, "scheduledAt": {"type": "string"}},
                    "required": ["message", "scheduledAt"],
                },
                "sideEffecting": True,
            },
        ])
        tools = AkoroToolsClient("https://api.akoro.test/tools", "secret", transport=transport).open_session(
            "session-1", "opaque-capability", max_calls=3, request_write_confirmations=True,
        )
        result = tools.invoke(ToolCall("schedule-1", "schedule_chat_follow_up", {
            "message": "Ready for your revision?", "scheduledAt": "2026-09-08T14:00:00+01:00",
        }))
        self.assertTrue(result["success"])
        self.assertTrue(result["requiresConfirmation"])
        self.assertEqual(transport.calls[1][0], "https://api.akoro.test/tools/confirmations")
        self.assertEqual(transport.calls[1][1]["tool"], "schedule_chat_follow_up")
        self.assertEqual(tools.drain_executions(), [{
            "tool": "schedule_chat_follow_up", "success": True, "sideEffecting": True,
            "requiresConfirmation": True,
            "confirmationId": "3ea5f00a-13e5-4acf-aef0-bb0427e6acb4",
            "confirmationPreview": {"kind": "create_task", "title": "Revise biology"},
        }])

    def test_confirmed_write_needs_the_service_gate_and_uses_one_stable_redemption_key(self) -> None:
        transport = RecordingTransport([])
        blocked = AkoroToolsClient("https://api.akoro.test/tools", "secret", transport=transport).open_session(
            "session-1", "opaque-capability", max_calls=3,
        )
        self.assertFalse(blocked.execute_confirmed_write("reviewed-token")["success"])
        self.assertEqual(len(transport.calls), 1)

        tools = AkoroToolsClient("https://api.akoro.test/tools", "secret", transport=transport).open_session(
            "session-1", "opaque-capability", max_calls=3, allow_side_effects=True,
        )
        result = tools.execute_confirmed_write("reviewed-token")
        self.assertTrue(result["success"])
        self.assertEqual(result["result"]["tool"], "create_task")
        self.assertEqual(transport.calls[-1][0], "https://api.akoro.test/tools/execute-confirmed")
        self.assertTrue(transport.calls[-1][1]["idempotencyKey"].startswith("confirmed-"))

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
