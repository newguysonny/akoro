# Deploying the Python adaptive-agent service

This service is deliberately internal. **Do not call it from a browser.** The
learner app continues to call `akoro-api`; the Node API will later authenticate
the learner, authorise the requested agent, then call this service with its
internal credential.

## Deploy as its own service

1. Create a Railway (or container-host) service with `akoro-python-agent` as
   the root directory. `Dockerfile` binds Uvicorn to `0.0.0.0:$PORT`.
2. Set these service variables:

   ```bash
   OPENAI_API_KEY=...
   OPENAI_MODEL=gpt-4.1-mini
   AGENT_SERVICE_ENVIRONMENT=production
   AKORO_AGENT_SERVICE_SECRET=<long random value>
   AGENT_SESSION_TTL_SECONDS=1800
   AKORO_API_URL=https://api.akoro.app       # service metadata; never a database URL

   # Akoro API's private account-tools AND durable-conversation gateway.
   # Both variables are required to hydrate/persist conversation context.
   AKORO_AGENT_TOOLS_URL=https://api.akoro.app/api/internal/agent-tools/v1
   AKORO_AGENT_TOOLS_SECRET=<different long random value>
   AGENT_TOOL_TIMEOUT_SECONDS=12
   AGENT_TOOL_MAX_CALLS_PER_SESSION=4
   # Keep both false until the Node bridge and learner review UI are deployed.
   AGENT_ENABLE_WRITE_CONFIRMATION_PROPOSALS=false
   AGENT_ALLOW_SIDE_EFFECTING_TOOLS=false
   # Keep false until reviewed concept-catalogue rows AND the bridge's signed
   # curriculum scope are deployed.
   AGENT_ENABLE_CONCEPT_STATE=false
   # Keep false until 2026-learner-signal-profile-v1.sql is applied and the
   # authenticated learner visibility/clear controls are enabled in Akoro API.
   AGENT_ENABLE_LEARNING_INSIGHTS=false
   # Keep false until 2026-learner-soul-state-v1.sql is deployed. This is a
   # learner-selected interaction layer, not an inferred emotion profile.
   AGENT_ENABLE_SOUL_STATE=false
   ```

3. Verify the unauthenticated health endpoint:

   ```bash
   curl https://your-agent-service.example/health
   curl https://your-agent-service.example/ready
   ```

`/ready` reports `mode: evaluation` while the legacy teaching repository is
process-local. **Durable learner conversation history is separate:** when the
private gateway variables below are configured and the bridge supplies a
`conversationId`, Akoro API owns the conversation transcript, its compact
summary, and learner-clearable study-memory notes. Python never uses database
credentials or a browser token. The feature-flagged canonical concept slice is
also Akoro-owned: it uses a narrow protected repository decorator rather than a
wholesale Python database port.

## Canonical Node teaching-workflow bridge

Set these values only after the private agent-tools gateway is deployed:

```bash
# Python service; true is the default when the gateway is configured.
AGENT_PREFER_AKORO_TEACHING_WORKFLOW=true
AGENT_TEACHING_WORKFLOW_TIMEOUT_SECONDS=90

# Akoro API; existing agent-tool credentials remain the sole private boundary.
AKORO_TEACHING_WORKFLOW_SESSION_TTL_SECONDS=1800
```

For an eligible fresh session with a signed learner `toolContext`, Python calls
`POST {AKORO_AGENT_TOOLS_URL}/teaching-workflow/sessions`, then relays turns,
summaries, and session end calls beneath that resource. Akoro API obtains the
learner only from the capability and runs the exact fixed
`adaptive_teaching_turn` sequence; neither Python nor a model can select or
skip `load_session_state`, evidence observation, protégé generation,
assessment, persistence, verified-learning recording, coaching, or the final
progress gate.

The selection is session-sticky: if Akoro API is explicitly unavailable before
creation, Python starts its local conservative loop; once the Node session has
started, a later outage is returned as an error rather than silently switching
progress authority. Configure session affinity (or one API replica) for the
private bridge because Node owns live workflow state. Python-only conversation,
concept-state, learner-insights, and Soul-state sessions remain local until
those durable state contracts are unified. Remote streaming is one atomic
terminal turn—not a second path for partial raw tokens or workflow internals.

## Canonical concept-state vertical slice

`AGENT_ENABLE_CONCEPT_STATE=true` enables only the first reviewed,
curriculum-grounded cognitive slice. It is not a generic feature flag for the
legacy JSON `student-state.js` path, and it does not replace that JavaScript
agent. The trusted Akoro bridge must mint the learner's `toolContext` with a
matching signed `learningScope` and pass the same explicit fields when starting
Python:

```js
const toolContext = issueAgentToolsCapability({
  user: req.user,
  sessionId: pythonSessionId,
  learningScope: {
    curriculumKey: "nerdc-jss2-basic-science-v1",
    subject: "Biology",
    topicKey: "photosynthesis",
  },
});
```

```json
{
  "studentId": "derived-by-akoro-api",
  "sessionId": "python-live-session-1",
  "toolContext": "<opaque learner capability>",
  "curriculumKey": "nerdc-jss2-basic-science-v1",
  "subject": "Biology",
  "topic": "Photosynthesis",
  "topicKey": "photosynthesis"
}
```

Akoro's private gateway resolves at most eight `status=approved` catalog
concepts for that exact signed scope, returns state only for those concepts,
and accepts no more than four observations per source turn. The gateway
re-checks the user on every request; no Python `studentId` is used as database
authority. Its `record_learner_concept_evidence` SQL function provides the
idempotent `(learner, session, turn, concept)` ledger and bounded state
transition. `not_checked` observations remain audit records only and cannot
alter cognitive state.

Apply `2026-concept-state-v1.sql` and
`2026-concept-state-retention-v1.sql` through the standard API migration
manifest, then import/review the initial catalogue before enabling the flag.
The latter refreshes only a requested 1–8 concept snapshot using Akoro's documented existing decay curve, with an immutable retention event; it does not send a
notification or take a learner action. There is no built-in AI seed data: a
scope without approved concepts remains an intentional non-canonical no-op.
This avoids presenting generated/web-retrieved material as an approved
curriculum brain.

A candidate observation is now checked by the bounded `CurriculumGuardian`
against the approved objective and a quote actually present in the completed
Student Agent reply. An invalid/uncertain check is persisted only as
`not_checked` evidence. The `CognitiveProgressionEngine` rather than NaNa or
the Student Agent decides whether to hold, repair, retrieve, challenge, move
one objective, or recognise mastery. Its thresholds are versioned and returned
in `cognitiveDecision` for monitoring; the UI must not turn a model suggestion
into an advancement.

## Measured learner-signals profile and episodes

`AGENT_ENABLE_LEARNING_INSIGHTS=true` opens a distinct optional private
resource at `/learning-insights`. It requires the same session-bound learner
capability and Akoro gateway credential as other Python integrations, but not a
curriculum scope unless an episode is recorded. The service writes one
idempotent `(learner, session, turn)` score tuple only after a completed reply;
a disconnected or stopped stream writes nothing. A separate schema-validated
judge may report `observed` attention/fatigue/reasoning quality or the safe
`not_checked` zero-value fallback. It does not save raw replies, judge rationale,
hidden reasoning, tool output, health data, or an inferred learner identity.

Akoro computes a rolling 12-observed-turn aggregate and expires it after 45
days. The profile remains a soft pacing cue only after at least three
observations. A current valid `learner-signals-v1` high-fatigue/very-low-
attention measurement may hold an otherwise-ready objective for a shorter
clarifying chunk; neither profile nor measurement can advance an objective,
modify concept mastery/retention, send a proactive message, or create a task. A compact episode is permitted only from
a Guardian-supported concept observation, is capped at 60 per learner, and uses
a server-generated approved-concept summary.

Deploy `2026-learner-signal-profile-v1.sql` through the normal migration
manifest first. Then set both service and Akoro API controls deliberately:

```bash
# Python service
AGENT_ENABLE_LEARNING_INSIGHTS=true

# Akoro API authenticated learner projection and destructive clear endpoint
AKORO_LEARNER_INSIGHTS_ENABLED=true
```

Before enabling, verify `GET /health` reports `learningInsights.enabled: true`.
A signed-in learner can inspect only their own compact projection at
`GET /api/adaptive/chat/learning-insights`, and can explicitly delete `all`,
`profile` (which also removes measurements), or `episodes` with
`DELETE /api/adaptive/chat/learning-insights`. Do not enable either flag until
the migration, private gateway, and learner control surface have been deployed.

## Exam-Prep Confidence Loop

`2026-exam-prep-confidence-loop-v1.sql` adds the learner-owned, generated
exam-style MCQ workflow without changing the existing teacher `exam_prep` task
tool. Enable it only after migration with:

```bash
AKORO_EXAM_PREP_CONFIDENCE_ENABLED=true
```

The scoped authenticated route is `/api/adaptive/exam-prep/confidence-runs`.
A run stores a board/subject policy threshold and capped number of attempts,
keeps answer keys server-side, scores one submitted diagnostic or retest, and
returns a clear learner-initiated teach-back handoff when below threshold. The
retest endpoint requires `learnerConfirmedReady: true`, generates fresh
questions, and ends at `change_approach` after the configured cap. Do not
represent this content as real historical papers: every run is explicitly
`generated_exam_style` until an authorised past-paper ingestion pipeline exists.

## Learner-selected Soul interaction layer

The first broader Soul Stack deployment is intentionally not an inferred
emotion/identity/relationship profile. `2026-learner-soul-state-v1.sql` stores
only learner-selected interaction preferences plus a self-reported, session-
bound check-in that expires after eight hours. It accepts no free text. The
prompt layer may honour a learner's requested pace/examples/challenge style and
use up to four existing server-generated verified-learning episode summaries as
a compact narrative thread. It may not claim to know the learner's feelings,
form dependency, diagnose, alter cognition, invoke tools, create a task, or
send a notification.

Deploy the migration, then enable both sides deliberately:

```bash
# Python service
AGENT_ENABLE_SOUL_STATE=true

# Akoro API learner-owned read/update/clear controls
AKORO_LEARNER_SOUL_STATE_ENABLED=true
```

Authenticated controls are `GET /api/adaptive/chat/soul-state`,
`PUT /api/adaptive/chat/soul-state/preferences`,
`PUT /api/adaptive/chat/soul-state/check-in`, and
`DELETE /api/adaptive/chat/soul-state` (`all`, `preferences`, or `checkins`).
The private Python resource is read-only at `/soul-state/snapshot` and always
uses a signed learner capability rather than a client-supplied learner ID.

## Durable learner conversation context

The existing Akoro Agent Chat tables remain the canonical raw transcript. The
additive Python service can attach to one existing user-owned `chat_sessions`
row using a short-lived learner `toolContext` and this start payload:

```json
{
  "studentId": "derived-by-akoro-api",
  "sessionId": "python-live-session-1",
  "conversationId": "8ca0532e-20be-49c2-b4df-566d87f0e0e4",
  "toolContext": "<opaque Akoro-issued learner capability>",
  "topic": "Photosynthesis"
}
```

At start, Python asks the private Akoro gateway for only the authorised
conversation snapshot:

- a most-recent window of up to 24 persisted user/assistant messages and
  24,000 total characters, in native `user` and `assistant` roles (the full
  raw history remains in Akoro’s existing session drawer);
- one compact conversation summary (maximum 4,000 characters);
- up to eight compact, learner-scoped study notes (maximum 1,500 characters
  each); and
- one conversation-scoped structured working scratchpad.

The current user prompt is sent as the final `user` message—not embedded in a
system prompt. Earlier dialogue is role-labelled as actual conversation, while
summary, memory, and scratchpad are clearly labelled as untrusted reference
data. Neither past conversation text nor memory can override the service system
instructions.

### Semantic learner-memory retrieval

Before every attached Python-agent turn, Python sends the **bounded current
learner message** (and optional subject) to
`POST /api/internal/agent-tools/v1/conversations/relevant-memory`. Akoro
creates the query embedding with its metered provider credentials and performs
user-scoped hybrid reciprocal-rank search across only:

- active, learner-clearable `edu.learner_agent_memories`; and
- compact `edu.learner_agent_conversation_summaries` from that learner's chats.

It returns at most six 1,200-character reference items. The exact chat
transcript, current scratchpad, and raw tool results are **not** vectorized or
returned by this route. Python keeps native recent `user`/`assistant` history
and the active scratchpad in their existing prompt positions, adds only the
retrieved older context as clearly-labelled untrusted reference data, then
plans and replies. Results never appear as raw text in the browser response;
`memoryRetrieval` reports only attempted/mode/match-count metadata.

Summary/note writes clear their `embedded_at` value, attempt a safe inline
embedding after durable persistence, and leave any provider failure for the
central embedding sweeper. The vector function has a lexical-only branch if a
query embedding is unavailable; if semantic retrieval itself is unavailable,
the gateway falls back to a deterministic bounded newest-note/summary list.
All retrieval predicates include the authenticated learner ID and active-memory
status, so forgotten notes and other learners' context cannot surface.

### Structured working scratchpad

Every iteration also receives an **Active working scratchpad** before the
current prompt. Its fixed schema is deliberately operational rather than a
chain-of-thought log:

| Field | Purpose |
|---|---|
| `goal` | One concise learner-facing objective |
| `progressSummary` | A 1,200-character compressed record of older completed work |
| `completed` | Up to six recent observable completed facts/actions |
| `plan` | Up to six future steps, each marked `pending`, `in_progress`, `completed`, or `blocked` |
| `nextSteps` | Up to six concrete next actions |
| `openQuestions` | Up to six unresolved questions |
| `toolState` | Up to four result-free tool statuses, including whether a learner review is pending |

Before the response/tool loop, the LLM produces a constrained plan update. The
reply then sees that plan in its own prompt, so a planned action is visible
before any tool may be called. After the reply, it produces a second constrained
checklist update based on the completed response and result-free tool status.
Python validates and bounds both updates before storing the final one.

When recent `completed` rows are replaced, their factual text is folded into
`progressSummary` instead of being silently discarded. This keeps the
scratchpad compact as a conversation grows while retaining the essential trail
of progress. It never asks the model to reveal private reasoning, stores no
hidden chain-of-thought, and does not put raw tool results into durable context.
The scratchpad is restored with the conversation on a later session; because it
lives in Akoro’s database rather than local disk, it also survives a Python
instance crash, restart, or instance change.

For a durable turn, the trusted Node bridge must supply a unique retry-safe
`turnId` with `POST /v1/sessions/{sessionId}/turns` (or the streaming variant):

```json
{"message":"Light helps plants make food.", "turnId":"chat_turn_0001"}
```

Only after a complete assistant response does Python call
`POST /api/internal/agent-tools/v1/conversations/turns`. Akoro stores the user
message, assistant message, compact conversation summary, and any bounded
study-memory note with the session/turn idempotency key. A stopped stream writes
nothing. If persistence is temporarily unavailable, the completed response says
`conversationPersistence.saved: false`; the bridge must retry the same `turnId`
rather than generate a second answer. This route is independent of the model
function-tool catalogue and never becomes an LLM-callable tool.

Apply `2026-python-agent-conversation-memory.sql`,
`2026-python-agent-conversation-scratchpad.sql`,
`2026-python-agent-conversation-scratchpad-plan.sql`, and
`2026-python-agent-memory-retrieval.sql` before enabling this path.
They extend the existing chat-message schema with nullable Python turn IDs, add
durable summaries and bounded `edu.learner_agent_memories`, persist the
conversation scratchpad/plan, record idempotent cross-service turns, and add
1536-dimensional summary/note vectors plus user-scoped hybrid retrieval. All
four are in `migrations/manifest.json` for the API deployment's normal
`npm run db:deploy` pre-deploy process.

The current JavaScript Agent Chat remains unchanged until its authenticated Node
bridge is deliberately switched to this Python session flow. It continues to
own its session list, transcript browsing, rename, and delete controls. Learners
can also manage compact memory through these authenticated API routes, suitable
for a future Settings/Agent Memory screen:

| Purpose | Route |
|---|---|
| List active compact memory notes | `GET /api/agent-memory/v1/memories` |
| Forget one note | `DELETE /api/agent-memory/v1/memories/{memoryId}` |
| Clear a conversation’s compact summary | `DELETE /api/agent-memory/v1/conversations/{conversationId}/summary` |
| Clear a conversation’s working scratchpad | `DELETE /api/agent-memory/v1/conversations/{conversationId}/scratchpad` |

Forgetting a note does not delete the raw chat. Deleting an existing chat
session continues to cascade its associated summary and turn records; source
links on independent memory notes are retained only as nullable references.

## Akoro API tools gateway contract

The Python service can call **only** an Akoro API tool gateway configured by
`AKORO_AGENT_TOOLS_URL`; it has no direct database credentials. This setting is
a full private base URL, not a browser-facing URL. Pair it with
`AKORO_AGENT_TOOLS_SECRET`, an independently rotatable outbound credential.
Python sends that value in `X-Akoro-Tools-Secret`, while the existing
`X-Akoro-Agent-Secret` remains exclusively for inbound Akoro API → Python
session calls.

Akoro API now provides these authenticated internal routes:

```http
POST /api/internal/agent-tools/v1/catalog
X-Akoro-Tools-Secret: <outbound secret>
Content-Type: application/json

{"sessionId":"...","toolContext":"<opaque Akoro-issued capability>"}
```

```json
{
  "tools": [
    {
      "name": "check_progress",
      "description": "Read the current learner progress.",
      "inputSchema": {"type": "object", "properties": {}, "required": [], "additionalProperties": false},
      "sideEffecting": false,
      "maxCalls": 2
    }
  ]
}
```

```http
POST /api/internal/agent-tools/v1/invoke
X-Akoro-Tools-Secret: <outbound secret>
Content-Type: application/json

{"sessionId":"...","toolContext":"<opaque capability>","tool":"check_progress","arguments":{},"idempotencyKey":"<model-tool-call-id>"}
```

```json
{"success":true,"result":{"completion":61}}
```

The canonical teaching-workflow bridge is a separate private resource, never a
model function:

```http
POST /api/internal/agent-tools/v1/teaching-workflow/sessions/{sessionId}/turns
X-Akoro-Tools-Secret: <outbound secret>
Content-Type: application/json

{"sessionId":"...","toolContext":"<opaque capability>","message":"...","turnId":"optional-stable-retry-key"}
```

Akoro derives the learner from the capability, verifies the session owner, and
executes `StudentSessionOrchestrator.processTeachingMessage()`—which invokes the
sealed `adaptive_teaching_turn` workflow. The request contains no learner ID,
workflow-tool name, step order, evidence score, or progression decision. It may
return only the normal learner-facing turn payload plus bounded workflow
metadata. The bridge maintains at most 32 replayable turn keys per live session.

A student-scoped capability currently receives **17 baseline adaptive-chat
functions**, with **four more** available only when their feature gates are on
(21 total). The baseline catalogue includes `get_learner_context`,
`get_agent_capabilities`, `check_progress`, `create_task`,
`schedule_chat_follow_up`, `list_scheduled_chat_follow_ups`,
`cancel_scheduled_chat_follow_up`, `list_tasks`, `find_battles`, `get_ranking`,
`get_weak_topics`, `get_learning_overview`, `get_knowledge_map`,
`search_my_study_knowledge`, `get_agent_preferences`,
`get_autonomy_status`, and `submit_tool_request`. The feature-gated tools are
`get_concept_tracker_summary`, `get_learning_insights_summary`,
`get_exam_prep_status`, and `get_chat_memory`. `get_learner_context` is a read-only, privacy-minimised
profile/account-context lookup: preferred name, self-reported city/country,
learning context, account timezone, and current local/UTC time only. City/country
never infer a timezone; it omits contact, payment, and authentication data.
The agent calls it before it resolves relative dates/times or personalises a reply.
`create_task`,
`schedule_chat_follow_up`, and `cancel_scheduled_chat_follow_up` are marked
side-effecting. The follow-up tool stores a delayed delivery, then opens a new
persistent Agent Chat and notifies the learner at its offset-aware scheduled
time. The list and cancellation tools provide learner-owned schedule management.
Delivery requires `REDIS_URL` on Akoro API so its BullMQ follow-up worker can run.

### Learner due-task autonomy

The learner dashboard's **Agent online / Agent offline** control persists a
default-off consent in Akoro API. When Online, only a pending, non-recurring
learner task with a precise `dueAt`/`due_at` is queued for its one exact due
time. The Akoro worker re-checks both consent and task state before creating a
single persistent proactive Agent Chat plus normal notification. It does not
execute, modify, complete, or spend for the task, and it performs no periodic
task polling. The worker must be running anywhere `REDIS_URL` is configured;
Offline pauses outstanding reviews. `create_task` accepts optional exact,
offset-aware `dueAt`, a concise optional `description`, and an IANA `timezone`;
a human-friendly `due` label does not create a schedule. Task and schedule tools
use the account timezone from `get_learner_context` when no timezone is supplied,
and label the Africa/Lagos platform fallback rather than claiming a location.

A teacher-task capability
receives the existing task-agent tool catalogue,
including quiz, lesson-plan, worksheet, report, exam-prep, attendance,
interactive-material, grading, scheduling, battle, self-study, and teaching
library tools, after Akoro entitlement gates have been applied. Task tools run
only against a signed, currently-running task/run context and are all marked
side-effecting because they persist an artifact or change platform state.

The Akoro API must authenticate the gateway credential, validate and expire the
opaque `toolContext`, resolve the authenticated learner and tenant from its own
state, filter the catalogue by entitlement, validate arguments, apply rate
limits, and enforce idempotency. It must not use a caller-supplied `studentId`
as authority. It returns tool output as data only—never trusted prompt
instructions. Its implementation is `akoro-api/modules/agent-tools/` and its
durable replay record is created by `2026-agent-tools-gateway.sql`; scheduled
chat delivery is created by `2026-scheduled-chat-follow-ups.sql`. The trusted
Node bridge can mint a context with `issueAgentToolsCapability` exported by
`akoro-api/modules/agent-tools/index.js`.

Configure the companion Akoro API service with the same
`AKORO_AGENT_TOOLS_SECRET` and an additional
`AKORO_AGENT_TOOLS_CAPABILITY_SECRET`. The latter signs `toolContext` tokens
inside the trusted Node bridge and is never sent to Python or a browser.

Pass the opaque capability only when creating a session:

```json
{"studentId":"derived-by-akoro-api","topic":"Photosynthesis","toolContext":"<short-lived capability>"}
```

The service opens the catalogue once for that live session. It returns safe
catalogue metadata in `session_ready` and result-free `toolExecutions` metadata
on a teaching turn. Raw structured tool data is bounded and not echoed as an
API field; the model may use relevant bounded facts in its natural-language
reply. Calls are capped per session, and malformed/unavailable tools fail
closed without ending a valid teaching session.

Learner tools with `sideEffecting: true` cannot execute directly from a Python
model call. With `AGENT_ENABLE_WRITE_CONFIRMATION_PROPOSALS=true`, Python may
only stage a 10-minute learner review preview through Akoro API. The browser
must explicitly approve it at the authenticated `/api/agent-actions/v1`
confirmation endpoint; Akoro then issues a short-lived, one-use token bound to
the exact tool arguments. The trusted Node bridge sends that token to Python's
`POST /v1/sessions/{sessionId}/confirmed-actions` endpoint. Only then—and only
with `AGENT_ALLOW_SIDE_EFFECTING_TOOLS=true`—can Python redeem the action. The
private gateway rechecks the signed user/session/capability/payload binding and
atomically consumes the durable confirmation before executing it. Backend
authorization remains mandatory at every step.

The browser review contract is deliberately separate from the private gateway:

| Purpose | Authenticated Akoro API route | Body |
|---|---|---|
| List bounded pending/reviewed previews | `GET /api/agent-actions/v1/confirmations` | — |
| Approve an exact preview | `POST /api/agent-actions/v1/confirmations/{confirmationId}/confirm` | `{"confirmed":true}` |
| Reject an exact preview | `POST /api/agent-actions/v1/confirmations/{confirmationId}/reject` | `{"rejected":true}` |

These routes return title/message, ISO instant, local date/time, and IANA
timezone where the action has a time. They do **not** return raw action
arguments, the Akoro gateway secret, or the confirmation token. On approval,
Akoro API performs the trusted relay to the Python endpoint below. If the
bridge is not configured, approval remains durable but cannot execute anything.

Python has two private gateway calls: `POST
/api/internal/agent-tools/v1/confirmations` stages a proposal and `POST
/api/internal/agent-tools/v1/execute-confirmed` redeems an opaque reviewed
token. Raw `/invoke` rejects every learner write tool. The new confirmation
ledger migration is `2026-agent-tool-write-confirmations.sql`; apply it before
enabling the proposals flag.

## Future akoro-api bridge contract

When the Python service has passed evaluation, configure the Node API with:

```bash
PYTHON_AGENT_SERVICE_URL=https://your-agent-service.example
AKORO_AGENT_SERVICE_SECRET=<same long random value>
```

The bridge must send the secret only server-to-server:

```http
X-Akoro-Agent-Secret: <secret>
Content-Type: application/json
```

The service endpoints deliberately use the same camel-case teaching payload
shape that the current Socket.IO layer emits:

| Purpose | Method and path | Response purpose |
|---|---|---|
| Create live session | `POST /v1/sessions` | `session_ready` payload |
| Process a buffered teacher turn | `POST /v1/sessions/{id}/turns` | adaptive teaching response |
| Redeem an approved learner write | `POST /v1/sessions/{id}/confirmed-actions` | submits only the opaque reviewed token; does not call the model |
| Stream a teacher turn | `POST /v1/sessions/{id}/turns/stream` | internal SSE: `stream_started`, `student_token`, then `turn_complete` |
| Stop a stream | `POST /v1/sessions/{id}/turns/stream/stop` | requests a safe, non-committing stop |
| Read a summary | `GET /v1/sessions/{id}/summary` | `session_summary` payload |
| Finalise a session | `POST /v1/sessions/{id}/end` | `session_ended` summary |

The Node bridge remains responsible for user authentication, ownership checks,
Socket.IO delivery, rate limiting, reference-file extraction, and issuing the
short-lived capability. Akoro API remains the database owner: the private
conversation gateway, not Python, reads and persists durable history/memory.
The bridge must never forward a browser's `studentId` as authority; it should
derive identity from the authenticated request exactly as the current Socket.IO
middleware does.

## Reference privacy

A `reference` may be included only as the already-normalised compact payload:

```json
{"name":"lecture-notes.pdf", "text":"…", "truncated":false}
```

The Python service caps text at 12,000 characters, treats it as untrusted source
material in prompts, returns metadata only, and keeps its raw text only inside
the live in-memory session. It does not write the reference to long-term memory
or the local evaluation repository.
