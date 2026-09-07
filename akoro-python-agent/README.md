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
| State | Explicit agent run state, validated teaching progression, TTL live sessions, per-session locks, stream-stop signals, and an optional capability-bound durable conversation attachment. |
| Memory/context | The service keeps a bounded live teaching transcript. When Akoro attaches a learner conversation, it restores role-correct user/assistant history, a compact summary, learner-clearable study notes, and a structured scratchpad with compressed progress plus an explicit plan on every turn; Akoro API—not Python—owns durable storage. |
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
| `POST {AKORO_AGENT_TOOLS_URL}/invoke` | `sessionId`, `toolContext`, `tool`, `arguments`, `idempotencyKey` | Read-tool result only: `{"success":true,"result":{...}}` |
| `POST {AKORO_AGENT_TOOLS_URL}/confirmations` | `sessionId`, `toolContext`, `tool`, `arguments`, `proposalKey` | Non-executing review preview and `confirmationId` |
| `POST {AKORO_AGENT_TOOLS_URL}/execute-confirmed` | `sessionId`, `toolContext`, `confirmationToken`, `idempotencyKey` | Executes the server-stored reviewed action once |

Python sends `X-Akoro-Tools-Secret` only on those private outbound requests.
The Akoro API validates that secret, validates and expires `toolContext`,
derives authority from the signed capability plus current user/task state,
validates tool arguments, applies entitlement gates, and honours the durable
idempotency key. It never trusts `studentId` in a Python request as authority.

Student sessions receive ten account tools: `get_learner_context`,
`check_progress`, `create_task`, `schedule_chat_follow_up`,
`list_scheduled_chat_follow_ups`, `cancel_scheduled_chat_follow_up`,
`list_tasks`, `find_battles`, `get_ranking`, and `get_weak_topics`.
`get_learner_context` is read-only and returns only safe personalisation data:
preferred name, self-reported city/country, language/study context, account
timezone, and current local/UTC time—never contact, payment, or authentication
data. City/country must not be used to infer a timezone; the saved IANA timezone
is the only account time authority. The agent calls it before
resolving relative dates and times. `schedule_chat_follow_up` creates a durable delayed job;
at delivery Akoro creates a new persistent Agent Chat, seeds its message, and
sends the learner an in-app/socket/push notification. The list tool shows
pending deliveries and the cancellation tool can cancel one by its `followUpId`.
Scheduling requires a future ISO 8601 `scheduledAt` value with an offset and an
explicit learner request; Akoro's Redis-backed worker delivers it. `create_task`
may also include an exact offset-aware `dueAt` when the learner supplied a precise
due time, an IANA `timezone`, and a concise `description`; plain-language `due`
remains display-only and never infers a schedule. Task and schedule tools default
to the account timezone returned by `get_learner_context` and return local-time
confirmation details. A `platform_default` timezone source is presented honestly
as an Akoro fallback, not a claim about the learner's location.

## Learner-controlled task autonomy

The learner dashboard's **Agent online / Agent offline** header control is a
server-backed, default-off opt-in. While Online, Akoro queues a review only for
a pending, non-recurring learner task with a precise `due_at`. At its due time,
the worker re-checks that opt-in and that task state, then opens **one** new
persistent Agent Chat suggesting a first next step and sends the normal
notification. It does not run a task executor, change the task, spend funds,
complete work, message anyone else, or poll the learner's task list on an
interval. Switching Offline pauses outstanding reviews; turning Online back on
can queue still-pending precisely due tasks, with a durable revision/idempotency
record preventing duplicate chats.

This autonomous path belongs to `akoro-api`, where the authenticated learner
preference and worker authorization remain durable. Python is not trusted to
supply user identity or authorization for it. A signed teacher-task
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

### Learner write-confirmation flow

Read tools are available by default once Akoro grants them. A learner write tool
never runs directly from a model call. When
`AGENT_ENABLE_WRITE_CONFIRMATION_PROPOSALS=true`, Python can only stage a
short-lived review card containing the exact bounded task/schedule/cancellation
preview. The authenticated learner reviews it at the Akoro API browser endpoint,
then Akoro issues a one-use, action-and-payload-bound confirmation token.

The learner UI reads pending previews at `GET /api/agent-actions/v1/confirmations`
and explicitly approves or rejects one at
`POST /api/agent-actions/v1/confirmations/{confirmationId}/confirm` (with
`{"confirmed":true}`) or `/reject` (with `{"rejected":true}`). The trusted Node bridge supplies the approval
token to Python's `POST /v1/sessions/{sessionId}/confirmed-actions` endpoint.
Python may redeem it only when `AGENT_ALLOW_SIDE_EFFECTING_TOOLS=true`; its private gateway validates
the signed session/principal/capability/payload binding and atomically consumes
the durable confirmation before execution. A retry with the same token receives
the durable idempotent result; a second action cannot use it. Keep both flags
`false` until the bridge and review UI are deployed. Akoro API authorization
remains mandatory at every step.

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
