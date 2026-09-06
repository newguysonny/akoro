"""Explicit agent-run state suitable for logs, tests, or a future UI."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any
from uuid import uuid4

from agent.reasoning.planner import Plan


class RunStatus(StrEnum):
    IDLE = "idle"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class ToolEvent:
    name: str
    allowed: bool
    summary: str


@dataclass(slots=True)
class AgentState:
    run_id: str = field(default_factory=lambda: str(uuid4()))
    status: RunStatus = RunStatus.IDLE
    plan: Plan | None = None
    iterations: int = 0
    tool_events: list[ToolEvent] = field(default_factory=list)
    error: str | None = None

    def start(self, plan: Plan) -> None:
        if self.status is RunStatus.RUNNING:
            raise RuntimeError("An agent run is already active")
        self.status = RunStatus.RUNNING
        self.plan = plan
        self.iterations = 0
        self.tool_events.clear()
        self.error = None

    def next_iteration(self) -> None:
        if self.status is not RunStatus.RUNNING:
            raise RuntimeError("Cannot advance a non-running agent")
        self.iterations += 1

    def record_tool(self, name: str, allowed: bool, result: dict[str, Any]) -> None:
        summary = result.get("error") or result.get("result") or "completed"
        self.tool_events.append(ToolEvent(name=name, allowed=allowed, summary=str(summary)[:240]))

    def complete(self) -> None:
        if self.status is RunStatus.RUNNING:
            self.status = RunStatus.COMPLETED

    def fail(self, error: Exception | str) -> None:
        self.status = RunStatus.FAILED
        self.error = str(error)
