"""Run a one-shot chat prompt with the default configured model."""
from agent.harness.harness import build_agent


if __name__ == "__main__":
    prompt = input("You: ").strip()
    if prompt:
        print(f"Agent: {build_agent().run(prompt).answer}")
