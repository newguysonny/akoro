# Verification Gate — Sandbox & MCP setup (phase V3)

The gate tests the **production API** by default (test learners for writes,
real users read/dry only). Phase V3 adds an optional **sandbox**: a second copy
of akoro-api on its own database, where the gate can run everything without
touching production data. A switch on the production API decides where runs go.

## 1. The switch (on the production akoro-api)

| Env | Value | Effect |
|---|---|---|
| `VERIFY_SANDBOX_ENABLED` | `true` | Gate runs are forwarded to the sandbox. **Unset or anything else: the gate tests this API, exactly as before.** |
| `VERIFY_SANDBOX_URL` | `https://akoro-api-sandbox.onrender.com` | The sandbox service's URL (no `/api/verify`). Missing/invalid → stays on this API and `/api/verify/scenarios` says why. |
| `VERIFY_SANDBOX_KEY` | *(optional)* | The sandbox's gate key, if it differs from this API's `AGENT_CONSOLE_KEY`. |

While it's on, a single run can still be pinned to production with
`"target": "production"` in `POST /api/verify/runs`. `GET /api/verify/scenarios`
shows `runsGoTo` (`sandbox` | `here`) and the sandbox's build sha and
reachability. A sandbox that doesn't answer gives **BLOCKED** — never a silent
fallback to production.

## 2. The sandbox service (Render)

New **Web Service** from the same repo and branch (`arena/e9efe0e4-akoro`):
root directory `akoro-api`, build `npm ci`, start `npm start`, health check
`/health`, auto-deploy on commit. Environment:

| Env | Value |
|---|---|
| `VERIFY_TARGET` | `sandbox` — boot migrations then apply **schema + demo seeds** (schools, courses, the 50 testers), and the service never forwards runs |
| `DATABASE_URL` | the **new** Supabase project's pooler connection string (never production's) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | the new project's API URL and service-role key |
| `REDIS_URL` | **its own Redis** (or another database index). Queue names are the same in both services — a shared Redis would let production workers pick up sandbox jobs and run them against production data. |
| `AGENT_CONSOLE_KEY` | the gate key (same as production, or set `VERIFY_SANDBOX_KEY` on production) |
| `OPENAI_API_KEY` | a key for agent scenarios (a separate key keeps sandbox spend visible) |
| `JWT_SECRET` | its own value |
| `AKORO_SELF_TOOLING_ENABLED`, `AKORO_SELF_TOOLING_CODE_ENABLED` | `true`, to test self-tooling |
| feature flags | the same as production, so the sandbox tests what production runs. Flags left unset on production can stay unset here — e.g. `AKORO_AGENT_NETWORK_ENABLED` defaults to on (only `false` turns it off). |
| `AKORO_JOBS_ENABLED` | optional: `chat follow-ups worker,self-tool resumes worker` keeps only the workers the gate needs |

Writes stay on test learners in the sandbox too (same policy as production),
so even a misconfigured sandbox can't change a real account.

## 3. The gate as MCP tools

`akoro-api/scripts/verify/mcp-server.mjs` — a dependency-free stdio MCP server
with `gate_status`, `gate_scenarios`, `gate_run` (waits for the verdict) and
`gate_get_run`.

```bash
claude mcp add akoro-gate \
  -e AKORO_GATE_URL=https://api.akoro.name.ng \
  -e AKORO_GATE_KEY=<AGENT_CONSOLE_KEY> \
  -- node akoro-api/scripts/verify/mcp-server.mjs
```

Behind a proxy, add `-e NODE_USE_ENV_PROXY=1` (Node's fetch ignores
`HTTPS_PROXY` otherwise).

## 4. Optional CI check

`.github/workflows/verify-gate.yml` (manual: Actions → Verification Gate → Run)
runs a suite (default `regression`) and fails unless the verdict is PASS.
Repository secrets: `AKORO_GATE_URL`, `AKORO_GATE_KEY`. Pass `expect_sha` to
make sure the server runs the commit you mean.
