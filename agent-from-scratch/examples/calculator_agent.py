"""Ask the agent a question that should use its safe calculator tool."""
from agent.harness.harness import build_agent


if __name__ == "__main__":
    result = build_agent().run("Calculate (19 * 6 + 8) / 4. State the answer clearly.")
    print(result.answer)
