"""The composition root for the standalone agent and its small CLI."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Sequence
import sys

from agent.environment.environment import Environment
from agent.llm.client import ChatClient, OpenAIChatClient
from agent.llm.config import LLMConfig
from agent.loop.agent_loop import AgentLoop, AgentResult
from agent.memory.long_term import LongTermMemory
from agent.memory.short_term import ShortTermMemory
from agent.permissions.policy import PermissionPolicy
from agent.state.agent_state import AgentState
from agent.tools.calculator import calculator_tool
from agent.tools.registry import Tool, ToolRegistry
from agent.tools.search import search_web


@dataclass(slots=True)
class AgentHarness:
    """Public facade. A future HTTP/CLI/UI adapter should call `run` only."""

    loop: AgentLoop
    environment: Environment
    long_term_memory: LongTermMemory

    def run(self, message: str) -> AgentResult:
        return self.loop.run(message)


def default_registry(include_search: bool = True) -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(Tool(
        name="calculator",
        description="Evaluate a basic arithmetic expression exactly and safely.",
        parameters={
            "type": "object",
            "properties": {"expression": {"type": "string", "description": "Arithmetic expression"}},
            "required": ["expression"],
            "additionalProperties": False,
        },
        handler=calculator_tool,
    ))
    if include_search:
        registry.register(Tool(
            name="search",
            description="Search the public web for a concise set of reference results.",
            parameters={
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Specific web search query"}},
                "required": ["query"],
                "additionalProperties": False,
            },
            handler=search_web,
        ))
    return registry


def build_agent(
    config: LLMConfig | None = None,
    client: ChatClient | None = None,
    workspace: Path | None = None,
) -> AgentHarness:
    """Build a production client, or inject a fake client for tests/evaluation."""
    config = config or LLMConfig.from_env()
    root = workspace or Path(__file__).resolve().parents[3] / "workspace"
    environment = Environment(root)
    registry = default_registry(include_search=config.allow_search)
    allowed = frozenset(registry.names())
    policy = PermissionPolicy(allowed_tools=allowed, max_tool_calls_per_run=config.max_steps)
    loop = AgentLoop(
        client=client or OpenAIChatClient(config),
        tools=registry,
        memory=ShortTermMemory(),
        state=AgentState(),
        policy=policy,
    )
    return AgentHarness(loop=loop, environment=environment, long_term_memory=LongTermMemory(environment.workspace))


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    question = " ".join(args).strip()
    if not question:
        print('Usage: akoro-agent "Your question"', file=sys.stderr)
        return 2
    try:
        result = build_agent().run(question)
    except Exception as exc:
        print(f"Agent failed: {exc}", file=sys.stderr)
        return 1
    print(result.answer)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
