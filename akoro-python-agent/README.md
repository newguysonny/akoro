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

### Canonical Node teaching-workflow bridge

The default hybrid mode prefers Akoro API's canonical
`adaptive_teaching_turn` workflow for an eligible **new** teaching session. It
calls the private `teaching-workflow` gateway with the existing outbound service
credential and the same short-lived, learner-bound `toolContext` used for other
Akoro resources. Python neither chooses the workflow tools nor accepts a learner
identity: Node executes its fixed evidence-first sequence and the deterministic
progress gate.

```bash
AGENT_PREFER_AKORO_TEACHING_WORKFLOW=true
AGENT_TEACHING_WORKFLOW_TIMEOUT_SECONDS=90
AKORO_AGENT_TOOLS_URL=https://api.akoro.app/api/internal/agent-tools/v1
AKORO_AGENT_TOOLS_SECRET=<outbound-only-secret>
```

The authority is selected once at session start:

- an eligible, reachable canonical workflow session is **Akoro API-owned** for
  its whole lifetime;
- an explicitly unavailable canonical service before a session starts selects
  Python's conservative local adaptive loop; and
- an active remote session never silently fails over locally, because that
  would split teaching evidence and progression state.

The current bridge intentionally keeps Python-only durable conversation,
canonical-concept, learner-insights, and Soul-state sessions local until their
state contracts are unified. It also requires API session affinity because the
canonical Node workflow owns live session state. A remote streaming request is
therefore delivered as one atomic terminal response rather than leaking partial
model tokens through a second service. The public `workflowAuthority` field is
bounded operational metadata only; raw learner text, evaluator output, tool
outputs, and hidden reasoning remain private.

## Agent-system coverage

### Canonical concept-state vertical slice

The first adaptive-cognition implementation is deliberately narrow and
**off by default** (`AGENT_ENABLE_CONCEPT_STATE=false`). When it is enabled,
the trusted Akoro bridge must provide `curriculumKey` and `topicKey` alongside
the normal `subject`; the Python service will not select a durable curriculum
scope from free text alone.

For that explicit scope, Python asks the private Akoro gateway for no more than
eight **approved** concepts, reads the learner's fraction-based state, places a
maximum of six compact concept conditions in the reply prompt, and returns only
bounded observations using those existing IDs. Akoro—not the model—then writes
an immutable evidence row and applies the deterministic database transition.
The three evidence dimensions remain separate: demonstrated response quality,
the Guardian's curriculum-objective claim assessment, and Guardian confidence.
The Student Agent first emits a schema-bounded candidate; a separate
`CurriculumGuardian` pass may mark it `supported`, `contradicted`, or
`not_checked` only against the reviewed objective and an exact quote from the
completed learner reply. It cannot use arbitrary web/RAG material. A malformed,
ungrounded, or unavailable Guardian result becomes `not_checked`, which remains
an immutable audit record but cannot create or modify cognitive state.

There are no ordered hardcoded teaching phases. After each completed turn, the
versioned `CognitiveProgressionEngine` calculates a bounded readiness score
from smoothed understanding/confusion/engagement, the current turn's
understanding, reviewed concept mastery/retention/evidence (when available),
and the accumulated agent level/knowledge profile. It may independently select
clarify, repair, retrieval, practice, challenge, advance, or mastery-review;
only this deterministic engine can advance one objective. Its policy version,
signals, threshold adjustment, decision, and reason are returned as bounded
`cognitiveDecision` metadata for calibration.

The migration `akoro-api/migrations/2026-concept-state-v1.sql` owns:

- `edu.concept_catalog` and reviewed prerequisite edges with source provenance;
- `edu.learner_concept_state` (`mastery`, `retention`, and evidence confidence
  are `0..1` fractions, alongside misconception, review-timing, count, and
  version fields); and
- append-only, per-turn-idempotent `edu.learner_concept_evidence` plus the
  `edu.record_learner_concept_evidence` policy function; and
- `edu.learner_concept_retention_events` plus a bounded, idempotent retention
  refresh using the documented existing Akoro decay curve.

This does **not** reinterpret or replace legacy `edu.student_knowledge`
(retrieval weighting fraction) or `edu.knowledge_confidence` (assessment
percentage). The private endpoints are `/concept-state/resolve`, `/snapshot`,
and `/observations` beneath `AKORO_AGENT_TOOLS_URL`; they require both the
service credential and the learner's session-bound capability. They are not
model-callable tools and never accept a learner ID from Python.

Enable the slice only after importing/reviewing curriculum concepts and adding
the trusted Node bridge fields:

```bash
AGENT_ENABLE_CONCEPT_STATE=true
AKORO_AGENT_TOOLS_URL=https://api.akoro.app/api/internal/agent-tools/v1
AKORO_AGENT_TOOLS_SECRET=<outbound-only-secret>
```

An empty reviewed catalogue is a safe, explicit no-op: the Python service keeps
its existing evaluation lifecycle rather than inventing concepts or persisting
local cognitive state. A non-empty snapshot refreshes only its bounded concept
scope's retention using the same documented decay coefficients as the existing JS decay
engine; it never creates a task, notification, or other learner action.

The optional qualitative tracker (`AKORO_CONCEPT_TRACKER_ENABLED=true`) adds a
separate, deterministic status/resume projection after canonical evidence is
recorded. Apply both `2026-concept-tracker-qualitative-v1.sql` and
`2026-concept-tracker-qualitative-v2.sql` before enabling it. The complete
lifecycle is `not_started → introduced → learning → understood → mastered`, with
`confused` as a repair branch; it is derived from approved catalogue objectives
and canonical evidence outcomes—not raw chat text or judge rationale. Learners
can view their own projection at `GET /api/adaptive/chat/concept-tracker` and
clear only compact confusion notes at
`DELETE /api/adaptive/chat/concept-tracker/confusion-notes`.

For a Guardian-supported contradiction, the teaching loop chooses a repair cue;
it does not manufacture an error or claim certainty. After the additive
`2026-curriculum-guardian-review-v1.sql` migration and explicit
`AKORO_GUARDIAN_REVIEW_QUEUE_ENABLED=true`, Akoro also records a metadata-only
review item for curriculum administrators. It contains concept/session/turn IDs
and the status only—not the learner reply, quote, model rationale, or raw tool
output. Administrators review and close items at authenticated
`/api/curriculum/guardian-reviews` endpoints.

### Measured learner-signals substrate

The next additive slice is also **off by default**
(`AGENT_ENABLE_LEARNING_INSIGHTS=false`). With the same private gateway and a
learner capability, it can store exactly one idempotent measurement for a
completed teaching turn: bounded attention, fatigue, reasoning-quality scores,
and a categorical reasoning style. A separate narrow judge returns
`not_checked` (all zeroes) when a reply is too ambiguous; the scores are not a
health, ability, or identity assessment and factual correctness remains solely
with `CurriculumGuardian`.

Akoro's `2026-learner-signal-profile-v1.sql` owns the raw-free measurement
ledger, a twelve-turn slow-moving aggregate profile, and a maximum of sixty
compact learning episodes. An episode is created only from a Guardian-supported
concept outcome, and Akoro constructs its summary from the approved concept
title—no transcript quote, hidden model reasoning, or tool result is stored.
The profile stays a soft response-presentation cue until it has at least three
observed turns. A current, schema-valid `learner-signals-v1` fatigue/very-low-
attention measurement may only hold an otherwise-ready objective for a shorter
clarifying chunk; it cannot advance an objective, change canonical concept
state, create a task, or trigger a notification.

Apply that migration before enabling:

```bash
AGENT_ENABLE_LEARNING_INSIGHTS=true
AKORO_LEARNER_INSIGHTS_ENABLED=true  # enables authenticated Akoro API visibility/clear controls
```

The learner can view the bounded projection at
`GET /api/adaptive/chat/learning-insights`, and explicitly clear `all`,
`profile` (including source measurements), or `episodes` with
`DELETE /api/adaptive/chat/learning-insights`. These controls are authenticated
and always derive the learner from the token; the private Python endpoint never
accepts a learner ID.

### Exam-Prep Confidence Loop

The learner-owned Exam-Prep Confidence Loop is a separate, **off-by-default**
workflow in Akoro API (`AKORO_EXAM_PREP_CONFIDENCE_ENABLED=true`). It provides
a bounded single-topic path: generated exam-style MCQ diagnostic → transparent
score/threshold branch → learner-initiated scoped teach-back handoff → fresh
MCQ retest → pass or capped `change_approach` fallback. Board/subject thresholds
and maximum attempts are configurable in `edu.exam_prep_confidence_policies`;
the fallback is 70% and three attempts. Every run carries the explicit
`generated_exam_style` provenance—it is not a historic past-paper corpus.

The authenticated endpoints are under `/api/adaptive/exam-prep/confidence-runs`:
list the learner's twelve most recent runs, create a run, read its current
attempt, submit answers, and request a fresh retest only after an explicit
`learnerConfirmedReady` value. The learner app opens this from the Agent tab,
labels it **Generated exam-style practice**, and hands a low-score learner
straight into the existing `TeachAgentModal` only after the learner chooses it.
A low score starts no session, task, notification, autonomy flow, or instructor
escalation automatically. Apply `2026-exam-prep-confidence-loop-v1.sql` before
enabling it.

When `AKORO_ADAPTIVE_WORKFLOWS_ENABLED=true` is deliberately enabled after
`2026-adaptive-workflows-v1.sql`, the confidence loop additionally writes a
learner-owned, observable workflow run and append-only public status steps. The
states are versioned and bounded (`diagnostic_ready`, `teach_back_required`,
`retest_ready`, `passed`, `change_approach`, or `cancelled`); they do not expose
chain-of-thought, raw tool output, or scratchpad contents. A learner can list
this projection at `GET /api/adaptive/exam-prep/workflows`.

### Learner-selected Soul interaction layer

The broader Soul Stack starts with a deliberately non-manipulative, **off by
default** interaction layer (`AGENT_ENABLE_SOUL_STATE=false`). It does not
infer emotion, identity, mental health, relationships, loyalty, or ability. The
learner can explicitly choose interaction style, response tone, challenge, and
encouragement preferences, and can create a short-lived current-session
check-in using bounded categorical values for feeling, study context, intent,
and requested support. It has no free-text diary or relationship-memory field.
The learner app exposes these explicit choices through the Agent-tab controls,
along with an authenticated one-action erasure control for saved preferences,
check-ins, profile measurements, and compact episodes.

When enabled, the Python agent fetches this read-only Akoro projection once at
session start and uses it only as a presentation prompt condition. The compact
narrative cue is drawn from the already safe, server-generated verified-learning
episodes—not raw transcript text. It cannot change cognitive state, run a tool,
create a task, send a notification, or treat a check-in as a diagnosis. Learners
may inspect, update, and clear their own controls through the authenticated
`/api/adaptive/chat/soul-state` endpoints. Deployment requires
`2026-learner-soul-state-v1.sql`, `AGENT_ENABLE_SOUL_STATE=true`, and
`AKORO_LEARNER_SOUL_STATE_ENABLED=true`.

| Capability | Current implementation |
|---|---|
| Tools | Akoro API-provided, per-session function catalogue; Python has no direct database tools. |
| Loop | Generic permissioned `AgentLoop`, adaptive `AdaptiveTeachingLoop`, and bounded `TeachingToolLoop`. |
| State | Explicit agent run state, validated teaching progression, TTL live sessions, per-session locks, stream-stop signals, and an optional capability-bound durable conversation attachment. |
| Memory/context | The service keeps a bounded live teaching transcript. When Akoro attaches a learner conversation, it restores role-correct user/assistant history, a compact summary, learner-clearable study notes, and a structured scratchpad with compressed progress plus an explicit plan on every turn. Before planning/replying, Akoro hybrid-searches only compact notes and summaries for the current learner message; raw chat and scratchpad remain ordered relational context. Akoro API—not Python—owns durable storage and embedding credentials. |
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
| `POST {AKORO_AGENT_TOOLS_URL}/teaching-workflow/sessions` | `sessionId`, `toolContext`, topic/session metadata | Starts a session-owned canonical Node teaching workflow |
| `POST {AKORO_AGENT_TOOLS_URL}/teaching-workflow/sessions/{sessionId}/turns` | `sessionId`, `toolContext`, `message`, optional `turnId` | Runs the fixed evidence-first turn; no workflow tool name is accepted |

Python sends `X-Akoro-Tools-Secret` only on those private outbound requests.
The Akoro API validates that secret, validates and expires `toolContext`,
derives authority from the signed capability plus current user/task state,
validates tool arguments, applies entitlement gates, and honours the durable
idempotency key. It never trusts `studentId` in a Python request as authority.

Student sessions receive **17 baseline account tools**, with **four more** available
when their matching feature gates are enabled (21 total). The baseline catalogue
includes `get_learner_context`, `get_agent_capabilities`, `check_progress`,
`create_task`, `schedule_chat_follow_up`, `list_scheduled_chat_follow_ups`,
`cancel_scheduled_chat_follow_up`, `list_tasks`, `find_battles`, `get_ranking`,
`get_weak_topics`, `get_learning_overview`, `get_knowledge_map`,
`search_my_study_knowledge`, `get_agent_preferences`, `get_autonomy_status`,
and `submit_tool_request`. The feature-gated tools are
`get_concept_tracker_summary`, `get_learning_insights_summary`,
`get_exam_prep_status`, and `get_chat_memory`.
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
