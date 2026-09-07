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
   ```

3. Verify the unauthenticated health endpoint:

   ```bash
   curl https://your-agent-service.example/health
   curl https://your-agent-service.example/ready
   ```

`/ready` reports `mode: evaluation` until an `AkoroApiLearningRepository` is
introduced. The adaptive cognitive repository is therefore process-local in
that mode. **Durable learner conversation history is separate:** when the
private gateway variables below are configured and the bridge supplies a
`conversationId`, Akoro API owns the conversation transcript, its compact
summary, and learner-clearable study-memory notes. Python never uses database
credentials or a browser token.

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
- one compact conversation summary (maximum 4,000 characters); and
- up to eight compact, learner-scoped study notes (maximum 1,500 characters
  each).

The current user prompt is sent as the final `user` message—not embedded in a
system prompt. Earlier dialogue is role-labelled as actual conversation, while
summary and memory are clearly labelled as untrusted reference data. Neither
past conversation text nor memory can override the service system instructions.

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

Apply `2026-python-agent-conversation-memory.sql` before enabling this path. It
extends the existing chat-message schema with nullable Python turn IDs, adds
durable summaries and bounded `edu.learner_agent_memories`, and records
idempotent cross-service turns. Add it to the API deployment's normal
`npm run db:deploy` pre-deploy process through `migrations/manifest.json`.

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

A student-scoped capability currently receives ten adaptive-chat functions:
`get_learner_context`, `check_progress`, `create_task`,
`schedule_chat_follow_up`, `list_scheduled_chat_follow_ups`,
`cancel_scheduled_chat_follow_up`, `list_tasks`, `find_battles`, `get_ranking`,
and `get_weak_topics`. `get_learner_context` is a read-only, privacy-minimised
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
