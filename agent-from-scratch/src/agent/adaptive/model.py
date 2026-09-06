"""Teaching-model protocol and OpenAI implementation adapter."""
from __future__ import annotations

from typing import Protocol, Sequence

from agent.llm.client import OpenAIChatClient
from agent.llm.messages import Message


class TeachingModel(Protocol):
    def complete_text(self, messages: Sequence[Message], temperature: float = 0.4) -> str: ...
    def complete_json(self, messages: Sequence[Message], temperature: float = 0.0) -> dict: ...


class OpenAIAdaptiveModel:
    """Makes the shared LLM client satisfy the teaching-specific protocol."""

    def __init__(self, client: OpenAIChatClient) -> None:
        self._client = client

    def complete_text(self, messages: Sequence[Message], temperature: float = 0.4) -> str:
        return self._client.complete_text(messages, temperature)

    def complete_json(self, messages: Sequence[Message], temperature: float = 0.0) -> dict:
        return self._client.complete_json(messages, temperature)
