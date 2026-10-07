"""Teaching-model protocol and OpenAI implementation adapter."""
from __future__ import annotations

from collections.abc import Iterator
from typing import Protocol, Sequence

from agent.llm.client import LLMResponse, OpenAIChatClient
from agent.llm.messages import Message


class TeachingModel(Protocol):
    def complete_text(self, messages: Sequence[Message], temperature: float = 0.4) -> str: ...
    def complete_json(self, messages: Sequence[Message], temperature: float = 0.0) -> dict: ...


class OpenAIAdaptiveModel:
    """Makes the shared LLM client satisfy the teaching-specific protocol."""

    def __init__(self, client: OpenAIChatClient) -> None:
        self._client = client

    def complete(self, messages: Sequence[Message], tools: Sequence[dict]) -> LLMResponse:
        """Function-calling surface used only when a session has Akoro tools."""
        return self._client.complete(messages, tools)

    def complete_text(self, messages: Sequence[Message], temperature: float = 0.4) -> str:
        return self._client.complete_text(messages, temperature)

    def stream_text(self, messages: Sequence[Message], temperature: float = 0.4) -> Iterator[str]:
        return self._client.stream_text(messages, temperature)

    def complete_json(self, messages: Sequence[Message], temperature: float = 0.0) -> dict:
        return self._client.complete_json(messages, temperature)
