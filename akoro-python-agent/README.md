# Akoro Python Agent

A compact, runnable Python agent foundation with a complete **adaptive teaching
service**. It separates the pieces that tend to become entangled in an agent
implementation: LLM I/O, a deliberately non-secret plan, tool execution,
memory, state, environment boundaries, permission policy, and the Student
Agent / NaNa-style teaching roles.

It is a **standalone Python service**. It does not replace the production
JavaScript tutoring agents under `akoro-api/modules/adaptive-learning/agents`.
The original generic foundation is retained as a read-only snapshot in
[`../reference/agent-from-scratch`](../reference/agent-from-scratch).
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

### Agent-system coverage

| Capability | Current implementation |
|---|---|
| Tools | Akoro API-provided, per-session function catalogue; Python has no direct database tools. |
| Loop | Generic permissioned `AgentLoop`, adaptive `AdaptiveTeachingLoop`, and bounded `TeachingToolLoop`. |
| State | Explicit agent run state, validated teaching progression, TTL live sessions, per-session locks, and stream-stop signals. |
| Permissions | Default-deny local tools; separate inbound service and outbound Akoro-tools credentials; backend remains the authority for account actions. |
| Error handling | Validated settings/contracts, bounded remote calls, safe tool failures, typed session/stream conflicts, and generic SSE error events after a stream starts. |
| Stopping conditions | Provider timeout, maximum model/tool rounds, per-session tool caps, single-stream ownership, explicit stop, client disconnect, end-session guard, and TTL cleanup for idle sessions. |
| Environment access | A workspace-confined `Environment` supports the generic agent harness. The adaptive HTTP service intentionally has no arbitrary filesystem tool; references arrive already-normalised and remain memory-only. |

## Quick start

```bash
cd akoro-python-agent
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
cd akoro-python-agent
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

## Streaming teaching turns

Use the authenticated Server-Sent Events endpoint when the Akoro API bridge
needs token-by-token Student Agent output:

```http
POST /v1/sessions/{sessionId}/turns/stream
X-Akoro-Agent-Secret: <internal service secret>
Content-Type: application/json

{"message":"Plants use light energy to make glucose."}
```

The response is `text/event-stream` and has this ordered lifecycle:

| SSE event | Meaning |
|---|---|
| `stream_started` | the service reserved this session for one ordered stream |
| `student_token` | a Student Agent text delta; concatenate `data.text` in order |
| `turn_complete` | the normal complete teaching-turn payload, after analysis, coaching, XP, and state updates finish |
| `stopped` | cancellation or disconnect stopped a partial reply; no turn state was committed |
| `error` | a stream-time error after the HTTP response started; inspect `data.code` |

A stream can be cancelled by the trusted bridge:

```http
POST /v1/sessions/{sessionId}/turns/stream/stop
X-Akoro-Agent-Secret: <internal service secret>
```

Only one stream may run for a session (`409` otherwise). A normal turn and
session end are also rejected while a stream owns the session. The browser must
still talk only to `akoro-api`: the Node bridge should consume these SSE events
and relay the appropriate Socket.IO events to the learner.

For a provider that supports text streaming, `student_token` is emitted as each
model text delta arrives. A turn with backend function tools is safely buffered
through the function-call loop and then emitted as one text event; partial tool
arguments are never executed. This keeps tool execution provider-neutral until
a dedicated streaming tool-call parser is introduced.

## Account-aware Akoro API tools

The adaptive service can enrich a **Student Agent** reply with live Akoro data
only when the Akoro API grants a session-scoped catalogue. It does not access
Supabase or reuse a browser JWT. Configure the full private gateway root and a
separate, outbound-only secret:

```bash
AKORO_AGENT_TOOLS_URL=https://api.akoro.app/api/internal/agent-tools/v1
AKORO_AGENT_TOOLS_SECRET=<different-long-random-secret>
```

The Akoro API uses the same `AKORO_AGENT_TOOLS_SECRET` for gateway verification
and a separate `AKORO_AGENT_TOOLS_CAPABILITY_SECRET` to sign short-lived
capabilities. Its signing secret stays in Akoro API only.

When starting a Python session, the authenticated Akoro API bridge may include
an opaque, short-lived `toolContext`. Python never reads this value as an
identity claim; it relays it to the tools gateway on catalogue and invoke
requests. Without both environment settings **and** `toolContext`, no remote
functions are shown to the model.

The implemented Akoro API contract is intentionally small:

| Request | Body | Required response |
|---|---|---|
| `POST {AKORO_AGENT_TOOLS_URL}/catalog` | `sessionId`, `toolContext` | `{"tools":[{"name","description","inputSchema","sideEffecting","maxCalls"}]}` |
| `POST {AKORO_AGENT_TOOLS_URL}/invoke` | `sessionId`, `toolContext`, `tool`, `arguments`, `idempotencyKey` | `{"success":true,"result":{...}}` or `{"success":false,"error":"..."}` |

Python sends `X-Akoro-Tools-Secret` only on those private outbound requests.
The Akoro API validates that secret, validates and expires `toolContext`,
derives authority from the signed capability plus current user/task state,
validates tool arguments, applies entitlement gates, and honours the durable
idempotency key. It never trusts `studentId` in a Python request as authority.

Student sessions receive seven account tools: `check_progress`, `create_task`,
`schedule_chat_follow_up`, `list_tasks`, `find_battles`, `get_ranking`, and
`get_weak_topics`. `schedule_chat_follow_up` creates a durable delayed job;
at delivery Akoro creates a new persistent Agent Chat, seeds its message, and
sends the learner an in-app/socket/push notification. It requires a future ISO
8601 `scheduledAt` value with an offset and an explicit learner request; Akoro's
Redis-backed worker delivers it. A signed teacher-task
context receives the existing task-agent catalogue—quiz, lesson, worksheet,
report, exam-prep, attendance, interactive, grading, scheduling, battle,
self-study, and teaching-library tools—only while that task run remains active
and its instructor gates allow them.

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
