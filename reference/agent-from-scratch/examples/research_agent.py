"""Ask the agent to research a focused topic using its bounded search tool."""
from __future__ import annotations

import sys

from agent.harness.harness import build_agent


if __name__ == "__main__":
    question = " ".join(sys.argv[1:]) or "What are the major moons of Mars?"
    result = build_agent().run(f"Research this question and cite the useful links: {question}")
    print(result.answer)
