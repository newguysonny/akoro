"""Small OpenAI-compatible chat client behind a testable protocol."""
from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Iterator
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

    def _create(self, messages: Sequence[Message], *, temperature: float | None = None,
                tools: Sequence[dict[str, Any]] = (), json_mode: bool = False):
        kwargs: dict[str, Any] = {
            "model": self._config.model,
            "messages": [message.to_openai() for message in messages],
            "temperature": self._config.temperature if temperature is None else temperature,
        }
        if tools:
            kwargs["tools"] = list(tools)
            kwargs["tool_choice"] = "auto"
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        response = self._client.chat.completions.create(**kwargs)
        if not response.choices:
            raise RuntimeError("The LLM returned no choices")
        return response.choices[0].message

    def complete(self, messages: Sequence[Message], tools: Sequence[dict[str, Any]]) -> LLMResponse:
        message = self._create(messages, tools=tools)
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

    def complete_text(self, messages: Sequence[Message], temperature: float | None = None) -> str:
        """Text completion used by the teaching-role adapters."""
        return self._create(messages, temperature=temperature).content or ""

    def stream_text(self, messages: Sequence[Message], temperature: float | None = None) -> Iterator[str]:
        """Yield provider text deltas without storing a response transcript."""
        kwargs: dict[str, Any] = {
            "model": self._config.model,
            "messages": [message.to_openai() for message in messages],
            "temperature": self._config.temperature if temperature is None else temperature,
            "stream": True,
        }
        stream = self._client.chat.completions.create(**kwargs)
        for chunk in stream:
            choices = getattr(chunk, "choices", None) or []
            if not choices:
                continue
            content = getattr(getattr(choices[0], "delta", None), "content", None)
            if isinstance(content, str) and content:
                yield content

    def complete_json(self, messages: Sequence[Message], temperature: float = 0) -> dict[str, Any]:
        """JSON-object completion with a strict, provider-neutral return value."""
        content = self._create(messages, temperature=temperature, json_mode=True).content or "{}"
        try:
            value = json.loads(content)
        except json.JSONDecodeError as exc:
            raise RuntimeError("The LLM returned invalid JSON") from exc
        if not isinstance(value, dict):
            raise RuntimeError("The LLM JSON response must be an object")
        return value
