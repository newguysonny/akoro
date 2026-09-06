"""Default-deny policy for model-requested tool execution."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class PermissionPolicy:
    allowed_tools: frozenset[str] = field(default_factory=lambda: frozenset({"calculator", "search"}))
    max_tool_calls_per_run: int = 6

    def can_call(self, tool_name: str, arguments: dict[str, Any]) -> tuple[bool, str]:
        if tool_name not in self.allowed_tools:
            return False, f"Tool '{tool_name}' is not permitted"
        if not isinstance(arguments, dict):
            return False, "Tool arguments must be an object"
        if tool_name == "calculator":
            expression = arguments.get("expression")
            if not isinstance(expression, str) or len(expression) > 200:
                return False, "Calculator requires an expression up to 200 characters"
        if tool_name == "search":
            query = arguments.get("query")
            if not isinstance(query, str) or not query.strip() or len(query) > 240:
                return False, "Search requires a non-empty query up to 240 characters"
        return True, "Permitted by policy"
