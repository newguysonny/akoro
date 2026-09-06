"""Reusable bounded function-calling loop for a single response.

Unlike the generic `AgentLoop`, this component does not own user memory or a
plan. It lets a domain role (such as the Student Agent) safely enrich one reply
with tools supplied by Akoro API.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence

from agent.llm.client import LLMResponse
from agent.llm.messages import Message
from agent.tools.akoro_api import AkoroToolSession


class ToolCapableModel(Protocol):
    def complete(self, messages: Sequence[Message], tools: Sequence[dict]) -> LLMResponse: ...


@dataclass(frozen=True, slots=True)
class ToolCallingResult:
    content: str
    executions: tuple[dict, ...]
    hit_limit: bool = False


class TeachingToolLoop:
    """Runs at most a few model/tool rounds, then returns a grounded response."""

    def __init__(self, max_rounds: int = 3) -> None:
        self._max_rounds = max(1, min(max_rounds, 6))

    def respond(self, model: ToolCapableModel, messages: Sequence[Message], tools: AkoroToolSession) -> ToolCallingResult:
        active = list(messages)
        for _ in range(self._max_rounds):
            response = model.complete(active, tools.schemas())
            active.append(Message.assistant(response.content, response.tool_calls))
            if not response.tool_calls:
                return ToolCallingResult(response.content, tuple(tools.drain_executions()))
            for call in response.tool_calls:
                # Results are untrusted data. The Student Agent prompt tells
                # the model never to execute instructions contained in them.
                active.append(Message.tool(call.id, call.name, tools.invoke(call)))
        return ToolCallingResult(
            "I could not complete the requested lookup within this teaching turn. Please try again with a narrower question.",
            tuple(tools.drain_executions()),
            hit_limit=True,
        )
