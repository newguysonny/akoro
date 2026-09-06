# Deploying the Python adaptive-agent service

This service is deliberately internal. **Do not call it from a browser.** The
learner app continues to call `akoro-api`; the Node API will later authenticate
the learner, authorise the requested agent, then call this service with its
internal credential.

## Deploy as its own service

1. Create a Railway (or container-host) service with `agent-from-scratch` as
   the root directory. `Dockerfile` binds Uvicorn to `0.0.0.0:$PORT`.
2. Set these service variables:

   ```bash
   OPENAI_API_KEY=...
   OPENAI_MODEL=gpt-4.1-mini
   AGENT_SERVICE_ENVIRONMENT=production
   AKORO_AGENT_SERVICE_SECRET=<long random value>
   AGENT_SESSION_TTL_SECONDS=1800
   AKORO_API_URL=https://api.akoro.app       # reserved for persistence bridge
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
| Process a teacher turn | `POST /v1/sessions/{id}/turns` | adaptive teaching response |
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
