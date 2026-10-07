# Akoro agent from scratch

A compact, runnable Python agent foundation. It separates the pieces that tend
to become entangled in an agent implementation: LLM I/O, a deliberately
non-secret plan, tool execution, memory, state, environment boundaries, and
permission policy.

It is a **standalone Python package**. It does not replace the production
JavaScript tutoring agents under `akoro-api/modules/adaptive-learning/agents`.
That lets the new architecture evolve and be evaluated independently before any
production integration is considered.

## Layout

```text
src/agent/
├── llm/          # environment config, provider client, typed chat messages
├── reasoning/    # compact task planning and permission-aware decisions
├── tools/        # registry, safe calculator, bounded web search
├── memory/       # in-process recent context and JSON-backed long-term memory
├── state/        # explicit run state and auditable tool events
├── environment/  # workspace-only filesystem boundary
├── permissions/  # default-deny tool policy and input limits
├── loop/         # bounded tool-calling loop
└── harness/      # one composition root and CLI entry point
```

`workspace/` is intentionally ignored except for `.gitkeep`; any persisted
memory belongs to the local runtime, not source control.

## Quick start

```bash
cd agent-from-scratch
cp .env.example .env
# Set OPENAI_API_KEY in .env
python -m venv .venv
. .venv/bin/activate
pip install -e .
akoro-agent "What is 19 * (6 + 3)?"
```

The default client uses the official `openai` SDK. Set `OPENAI_BASE_URL` for an
OpenAI-compatible provider. The SDK is imported only when the real client is
constructed, so all unit tests can run without credentials or network access.

## Examples

```bash
PYTHONPATH=src python examples/basic_chat.py
PYTHONPATH=src python examples/calculator_agent.py
PYTHONPATH=src python examples/research_agent.py "latest malaria prevention guidance"
```

The web-search example uses DuckDuckGo's public instant-answer endpoint. It is
best-effort: a network or provider failure becomes a tool result the model can
explain, rather than crashing the process.

## Tests

The test suite uses Python's standard library and fake LLM clients; no API key,
network access, or third-party test runner is required.

```bash
PYTHONPATH=src python -m unittest discover -s tests -v
```

`pytest` can also discover the same tests if you prefer it.

## Safety defaults

- Tool use is **default-deny** and checked before every invocation.
- The loop has a configurable maximum number of LLM/tool rounds.
- The calculator parses a restricted arithmetic AST; it never calls `eval`.
- Search query length and result count are bounded.
- `Environment` only resolves paths under its configured workspace.
- Long-term memory writes JSON atomically within that workspace.
- The planner produces a short task outline, not hidden chain-of-thought.
