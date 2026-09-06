# Akoro agent from scratch

A compact, runnable Python agent foundation with a complete **adaptive teaching
service**. It separates the pieces that tend to become entangled in an agent
implementation: LLM I/O, a deliberately non-secret plan, tool execution,
memory, state, environment boundaries, permission policy, and the Student
Agent / NaNa-style teaching roles.

It is a **standalone Python service**. It does not replace the production
JavaScript tutoring agents under `akoro-api/modules/adaptive-learning/agents`.
The Python implementation mirrors that adaptive session lifecycle so it can be
evaluated independently, then connected through an authenticated service URL
without exposing the browser directly to it.

## Layout

```text
src/agent/
├── llm/          # environment config, provider client, typed chat messages
├── reasoning/    # compact task planning and permission-aware decisions
├── tools/        # registry, local utilities, and the Akoro API tools gateway
├── memory/       # recent context, durable JSON memory, live teaching transcript
├── state/        # agent-run state, validated phases, concurrency-safe live sessions
├── environment/  # workspace-only filesystem boundary
├── permissions/  # default-deny tools and internal-service access policy
├── loop/         # generic agent loop and adaptive teaching coordination loop
├── harness/      # explicit composition roots for CLI and adaptive service
├── adaptive/     # domain roles: Student Agent, NaNa guide, ladder, repository seam
└── service/      # thin internal FastAPI delivery adapter and HTTP contracts
```

`workspace/` is intentionally ignored except for `.gitkeep`; any persisted
memory belongs to the local runtime, not source control.

### Responsibility boundaries

- **`service`** parses and returns HTTP only; it does not make learning or
  authentication decisions.
- **`harness`** composes the configured model, repository, live-session store,
  and internal access policy in one place.
- **`loop`** coordinates turns; **`reasoning`** validates lesson progression;
  **`state`** owns phase and concurrency state; and **`memory`** owns the
  bounded live transcript.
- **`adaptive`** contains the Student Agent and NaNa-style domain roles plus a
  persistence protocol. It has no FastAPI dependency.
- **`permissions`** default-denies tools and protects the internal service.
- **`tools/akoro_api.py`** is the only outbound path to account-aware tools. It
  loads an Akoro API-provided, per-session catalogue and relays model calls
  using an opaque Akoro-issued capability; it does not contain database logic
  or browser tokens.

This separation makes each layer unit-testable and lets the current evaluation
repository be swapped for a protected Akoro API repository without changing
LLM roles, browser code, or HTTP contracts.

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

## Run the adaptive-agent service

```bash
cd agent-from-scratch
# Configure OPENAI_API_KEY; set a long shared secret before any production deployment.
python -m agent.service
# GET http://localhost:8000/health
```

The service implements the same lifecycle as the JavaScript adaptive-learning
path: create a session, process teaching turns, read a summary, and end the
session. It returns camel-case response fields aligned with the existing
Socket.IO payloads. See [`DEPLOY.md`](DEPLOY.md) for the server-to-server
contract, authentication boundary, deployment settings, and the staged Akoro
API integration plan.

## Account-aware Akoro API tools

The adaptive service can enrich a **Student Agent** reply with live Akoro data
only when the Akoro API grants a session-scoped catalogue. It does not access
Supabase or reuse a browser JWT. Configure the full private gateway root and a
separate, outbound-only secret:

```bash
AKORO_AGENT_TOOLS_URL=https://api.akoro.app/api/internal/agent-tools/v1
AKORO_AGENT_TOOLS_SECRET=<different-long-random-secret>
```

When starting a Python session, the authenticated Akoro API bridge may include
an opaque, short-lived `toolContext`. Python never reads this value as an
identity claim; it relays it to the tools gateway on catalogue and invoke
requests. Without both environment settings **and** `toolContext`, no remote
functions are shown to the model.

The expected Akoro API contract is intentionally small:

| Request | Body | Required response |
|---|---|---|
| `POST {AKORO_AGENT_TOOLS_URL}/catalog` | `sessionId`, `toolContext` | `{"tools":[{"name","description","inputSchema","sideEffecting","maxCalls"}]}` |
| `POST {AKORO_AGENT_TOOLS_URL}/invoke` | `sessionId`, `toolContext`, `tool`, `arguments`, `idempotencyKey` | `{"success":true,"result":{...}}` or `{"success":false,"error":"..."}` |

Python sends `X-Akoro-Tools-Secret` only on those private outbound requests.
The Akoro API must validate that secret, validate and expire `toolContext`,
derive user/tenant authority from that capability or its own session record,
validate tool arguments, enforce entitlements, and honour the idempotency key.
It must not trust `studentId` in a Python request as authorization.

Catalogues support Akoro's existing `input_schema` spelling as well as
`inputSchema`. The service caps catalogues at 24 functions, invocation
arguments at 12 KB, tool data added to model context at 12 KB, and calls at the
configured per-session limit. Only result-free execution metadata is returned
in `toolExecutions`; the raw structured result is not echoed as an API field
(the model may use bounded facts from it in its natural-language reply).

Read tools are available by default once Akoro grants them. Tools marked
`sideEffecting: true` are blocked locally unless
`AGENT_ALLOW_SIDE_EFFECTING_TOOLS=true`; leave that default in place until the
Akoro API has a confirmed-action workflow. Akoro API authorization remains the
final and mandatory enforcement point in either case.

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

The suite uses Python's standard-library `unittest` runner and fake LLM clients.
After installing the package dependencies, it needs no API key or network access.

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
