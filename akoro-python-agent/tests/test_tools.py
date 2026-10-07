from __future__ import annotations

import unittest

from agent.tools.calculator import CalculationError, calculate
from agent.tools.registry import Tool, ToolRegistry, UnknownToolError


class CalculatorTests(unittest.TestCase):
    def test_calculates_restricted_arithmetic(self) -> None:
        self.assertEqual(calculate("19 * (6 + 3)")["result"], 171)
        self.assertEqual(calculate("7 // 2")["result"], 3)

    def test_rejects_python_execution(self) -> None:
        with self.assertRaises(CalculationError):
            calculate("__import__('os').system('echo unsafe')")
        with self.assertRaises(CalculationError):
            calculate("1 / 0")


class RegistryTests(unittest.TestCase):
    def test_registry_exposes_schema_and_invokes_tool(self) -> None:
        registry = ToolRegistry()
        registry.register(Tool("echo", "Echo a value", {"type": "object"}, lambda args: {"value": args["value"]}))
        self.assertEqual(registry.schemas()[0]["function"]["name"], "echo")
        self.assertEqual(registry.invoke("echo", {"value": "hello"}), {"value": "hello"})
        with self.assertRaises(UnknownToolError):
            registry.invoke("missing", {})
