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
   AKORO_API_URL=https://api.akoro.app       # reserved for persistence bridge

   # Optional: Akoro API's private account-aware tools gateway.
   AKORO_AGENT_TOOLS_URL=https://api.akoro.app/api/internal/agent-tools/v1
   AKORO_AGENT_TOOLS_SECRET=<different long random value>
   AGENT_TOOL_TIMEOUT_SECONDS=12
   AGENT_TOOL_MAX_CALLS_PER_SESSION=4
   AGENT_ALLOW_SIDE_EFFECTING_TOOLS=false
   ```

3. Verify the unauthenticated health endpoint:

   ```bash
   curl https://your-agent-service.example/health
   curl https://your-agent-service.example/ready
   ```

`/ready` reports `mode: evaluation` until an `AkoroApiLearningRepository` is
introduced. In that mode, active sessions and memory are process-local and are
lost at restart. This is intentional for isolated testing; it is not a durable
production data path.

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

A student-scoped capability currently receives the six existing adaptive-chat
functions: `check_progress`, `create_task`, `list_tasks`, `find_battles`,
`get_ranking`, and `get_weak_topics`. `create_task` is marked side-effecting.
A teacher-task capability receives the existing task-agent tool catalogue,
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
durable replay record is created by `2026-agent-tools-gateway.sql`. The trusted
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

Tools with `sideEffecting: true` are denied by default by the Python service.
Keep `AGENT_ALLOW_SIDE_EFFECTING_TOOLS=false` until an explicit Akoro API
confirmed-action flow is deployed; backend authorization remains mandatory even
if it is enabled later.

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
| Stream a teacher turn | `POST /v1/sessions/{id}/turns/stream` | internal SSE: `stream_started`, `student_token`, then `turn_complete` |
| Stop a stream | `POST /v1/sessions/{id}/turns/stream/stop` | requests a safe, non-committing stop |
| Read a summary | `GET /v1/sessions/{id}/summary` | `session_summary` payload |
| Finalise a session | `POST /v1/sessions/{id}/end` | `session_ended` summary |

The Node bridge remains responsible for user authentication, ownership checks,
Socket.IO delivery, database persistence, rate limiting, and reference-file
extraction. It must never forward a browser's `studentId` as authority; it
should derive the identity from the authenticated request exactly as the
current Socket.IO middleware does.

## Reference privacy

A `reference` may be included only as the already-normalised compact payload:

```json
{"name":"lecture-notes.pdf", "text":"…", "truncated":false}
```

The Python service caps text at 12,000 characters, treats it as untrusted source
material in prompts, returns metadata only, and keeps its raw text only inside
the live in-memory session. It does not write the reference to long-term memory
or the local evaluation repository.
