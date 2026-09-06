"""Permission-aware decisions for requested tool calls."""
from __future__ import annotations

from dataclasses import dataclass

from agent.llm.messages import ToolCall
from agent.permissions.policy import PermissionPolicy


@dataclass(frozen=True, slots=True)
class ToolDecision:
    allowed: bool
    reason: str


class ToolDecider:
    """Turns the policy result into a transcript-safe decision."""

    def decide(self, call: ToolCall, policy: PermissionPolicy) -> ToolDecision:
        allowed, reason = policy.can_call(call.name, call.arguments)
        return ToolDecision(allowed=allowed, reason=reason)
