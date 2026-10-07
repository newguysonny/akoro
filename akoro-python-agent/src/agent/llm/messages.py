"""Provider-neutral chat message and tool-call values."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal
import json

Role = Literal["system", "user", "assistant", "tool"]


@dataclass(frozen=True, slots=True)
class ToolCall:
    """A structured function call requested by a model."""

    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)

    def to_openai(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": "function",
            "function": {"name": self.name, "arguments": json.dumps(self.arguments)},
        }


@dataclass(frozen=True, slots=True)
class Message:
    """One transcript item, convertible to Chat Completions input."""

    role: Role
    content: str
    name: str | None = None
    tool_call_id: str | None = None
    tool_calls: tuple[ToolCall, ...] = ()

    @classmethod
    def system(cls, content: str) -> "Message":
        return cls("system", content)

    @classmethod
    def user(cls, content: str) -> "Message":
        return cls("user", content)

    @classmethod
    def assistant(cls, content: str, tool_calls: tuple[ToolCall, ...] = ()) -> "Message":
        return cls("assistant", content, tool_calls=tool_calls)

    @classmethod
    def tool(cls, call_id: str, name: str, value: Any) -> "Message":
        return cls("tool", json.dumps(value, ensure_ascii=False), name=name, tool_call_id=call_id)

    def to_openai(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"role": self.role, "content": self.content}
        if self.name:
            payload["name"] = self.name
        if self.tool_call_id:
            payload["tool_call_id"] = self.tool_call_id
        if self.tool_calls:
            payload["tool_calls"] = [call.to_openai() for call in self.tool_calls]
        return payload
