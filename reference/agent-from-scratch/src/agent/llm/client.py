"""Small OpenAI-compatible chat client behind a testable protocol."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, Sequence
import json

from .config import LLMConfig
from .messages import Message, ToolCall


@dataclass(frozen=True, slots=True)
class LLMResponse:
    content: str
    tool_calls: tuple[ToolCall, ...] = ()


class ChatClient(Protocol):
    """The loop depends on this narrow contract, not a provider SDK."""

    def complete(self, messages: Sequence[Message], tools: Sequence[dict[str, Any]]) -> LLMResponse: ...


class OpenAIChatClient:
    """Chat Completions implementation for OpenAI and compatible APIs."""

    def __init__(self, config: LLMConfig) -> None:
        try:
            from openai import OpenAI
        except ImportError as exc:  # Keep tests credential- and SDK-free.
            raise RuntimeError("Install the package dependencies: pip install -e .") from exc
        self._config = config
        kwargs: dict[str, Any] = {"api_key": config.api_key, "timeout": config.timeout_seconds}
        if config.base_url:
            kwargs["base_url"] = config.base_url
        self._client = OpenAI(**kwargs)

    def complete(self, messages: Sequence[Message], tools: Sequence[dict[str, Any]]) -> LLMResponse:
        response = self._client.chat.completions.create(
            model=self._config.model,
            messages=[message.to_openai() for message in messages],
            tools=list(tools) or None,
            tool_choice="auto" if tools else None,
            temperature=self._config.temperature,
        )
        if not response.choices:
            raise RuntimeError("The LLM returned no choices")
        message = response.choices[0].message
        calls: list[ToolCall] = []
        for call in message.tool_calls or []:
            try:
                arguments = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                arguments = {}
            if not isinstance(arguments, dict):
                arguments = {}
            calls.append(ToolCall(id=call.id, name=call.function.name, arguments=arguments))
        return LLMResponse(content=message.content or "", tool_calls=tuple(calls))
