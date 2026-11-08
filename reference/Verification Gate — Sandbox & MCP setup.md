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
| `AKORO_JOBS_ENABLED` | optional: `chat follow-ups worker,self-tool resumes worker,deferred jobs` keeps only the workers the gate needs (`deferred jobs` releases far-off jobs from Postgres — leave it in) |

Writes stay on test learners in the sandbox too (same policy as production),
so even a misconfigured sandbox can't change a real account.

## 3. The gate as MCP tools

`akoro-api/scripts/verify/mcp-server.mjs` — a dependency-free stdio MCP server
with `gate_status`, `gate_scenarios`, `gate_run` (waits for the verdict) and
`gate_get_run`. It is plain MCP with nothing Claude-specific: any coding agent
that runs **local (stdio) MCP servers** can use it — Claude Code, OpenCode,
Kilo Code, Cline, Roo Code, Cursor, Windsurf, Continue, Zed, Gemini CLI, Codex
CLI — and so any model those tools run (DeepSeek, GPT, Gemini, Qwen, …).
DeepSeek's own chat website can't (it can't start a local server).

Every client needs the same three things:

| What | Value |
|---|---|
| Command | `node akoro-api/scripts/verify/mcp-server.mjs` (from the repo root; or an absolute path) |
| `AKORO_GATE_URL` | `https://api.akoro.ng` — no `/api/verify`. The old `api.akoro.name.ng` redirects, and the key is **not** sent across the redirect. |
| `AKORO_GATE_KEY` | the gate key (`AGENT_CONSOLE_KEY` on the server) |

Optional: `NODE_USE_ENV_PROXY=1` behind a proxy (Node's fetch ignores
`HTTPS_PROXY` otherwise). Needs Node 18+ (Node 22+ for the proxy switch).

The snippets below follow each tool's documented MCP format; field names
change between versions, so check the tool's own MCP docs if one doesn't load.

**Claude Code**

```bash
claude mcp add akoro-gate \
  -e AKORO_GATE_URL=https://api.akoro.ng \
  -e AKORO_GATE_KEY=<AGENT_CONSOLE_KEY> \
  -- node akoro-api/scripts/verify/mcp-server.mjs
```

**OpenCode** — `opencode.json` in the repo root (or `~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "akoro-gate": {
      "type": "local",
      "command": ["node", "akoro-api/scripts/verify/mcp-server.mjs"],
      "environment": {
        "AKORO_GATE_URL": "https://api.akoro.ng",
        "AKORO_GATE_KEY": "{env:AKORO_GATE_KEY}"
      },
      "enabled": true
    }
  }
}
```

**Kilo Code, Cline, Roo Code** — their MCP settings file (Kilo/Roo: `.kilocode/mcp.json` /
`.roo/mcp.json` in the project, or the global `mcp_settings.json` from the MCP panel;
Cline: `cline_mcp_settings.json` from its MCP panel):

```json
{
  "mcpServers": {
    "akoro-gate": {
      "command": "node",
      "args": ["akoro-api/scripts/verify/mcp-server.mjs"],
      "env": {
        "AKORO_GATE_URL": "https://api.akoro.ng",
        "AKORO_GATE_KEY": "<AGENT_CONSOLE_KEY>"
      },
      "disabled": false
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`), **Windsurf** (`~/.codeium/windsurf/mcp_config.json`),
**Gemini CLI** (`.gemini/settings.json`) use the same `mcpServers` shape as above.
For a relative `args` path, start the tool from the repo root, or use the absolute path.

**Codex CLI** — `~/.codex/config.toml`:

```toml
[mcp_servers.akoro-gate]
command = "node"
args = ["akoro-api/scripts/verify/mcp-server.mjs"]
env = { AKORO_GATE_URL = "https://api.akoro.ng", AKORO_GATE_KEY = "<AGENT_CONSOLE_KEY>" }
```

**Check it loaded:** ask the agent to call `gate_status`; it answers with the
build (git sha) the gate tests and the sandbox state.

**Good to know**

- **The key.** Anyone holding it can run any scenario, write scenarios included
  (test learners and the sandbox — real accounts are never written to). Keep it in
  the tool's config or an environment variable (OpenCode's `{env:…}` reads one),
  never in chat or a committed file; rotate it if it leaks. Don't commit a config
  file that contains it (`.cursor/`, `.kilocode/`, `.roo/`, `opencode.json` with a
  literal key).
- **Long runs.** `gate_run` waits up to 9 minutes for the verdict. Clients that cut
  tool calls off sooner: pass `maxWaitSeconds` (e.g. 50), then read the result with
  `gate_get_run`.
- **Only PASS means verified.** FAIL, BLOCKED, ERROR and INCONCLUSIVE are reported
  as they are; pass `expectSha` (the pushed commit) so a stale deploy says BLOCKED.
- **Remote-only clients.** The server is local (stdio). A client that only accepts
  remote MCP servers by URL can't use it yet.
- **No MCP at all.** Any agent that can run `curl` can use the same gate over HTTP:
  `curl -H "Authorization: Bearer $AKORO_GATE_KEY" https://api.akoro.ng/api/verify/scenarios`.

## 4. Optional CI check

`.github/workflows/verify-gate.yml` (manual: Actions → Verification Gate → Run)
runs a suite (default `regression`) and fails unless the verdict is PASS.
Repository secrets: `AKORO_GATE_URL`, `AKORO_GATE_KEY`. Pass `expect_sha` to
make sure the server runs the commit you mean.
