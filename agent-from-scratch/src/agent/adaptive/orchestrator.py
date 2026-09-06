"""Compatibility import for the adaptive teaching loop.

The coordination loop belongs in `agent.loop`; this module preserves the
initial public import path while callers move to `AdaptiveTeachingLoop`.
"""
from agent.loop.adaptive_teaching_loop import AdaptiveTeachingLoop

AdaptiveTeachingOrchestrator = AdaptiveTeachingLoop

__all__ = ["AdaptiveTeachingOrchestrator", "AdaptiveTeachingLoop"]
