---
name: verify
description: Verify a change on the deployed Akoro API with the Verification Gate (/api/verify) before saying it works. Use after pushing any fix or feature to the preview branch, when asked to "verify", "check it works on the server", or before reporting a bug fixed.
---

# Verify with the gate

The Verification Gate runs scenarios against the REAL running API and returns
a verdict with evidence. Plan: `reference/Self-Tooling & Verification Gate — Grand Plan.md` §8.

**Rule: never say "verified", "works on the server" or "fixed" for deployed
behaviour without a `PASS` run on the deployed commit.** FAIL, BLOCKED,
ERROR, INCONCLUSIVE and "no run" are not verified — report them as they are.

## Reaching it

`https://api.akoro.name.ng/api/verify` — the cloud environment's network
secret adds `Authorization: Bearer <AGENT_CONSOLE_KEY>`; never ask for the key.

```bash
B=https://api.akoro.name.ng/api/verify
curl -s $B/scenarios | jq '.data.scenarios[] | {name, risk, description}'
curl -s $B/suites | jq
```

### Sandbox

When production has `VERIFY_SANDBOX_ENABLED=true`, runs are forwarded to the
sandbox gate (`https://akoro-sandbox.onrender.com`, same code, its own
database); responses carry `"via":"sandbox"` and `target: "sandbox"`. Check
where runs go and the sandbox's build with
`curl -s $B/scenarios | jq '.data | {runsGoTo, sandbox}'` — wait for
`.data.sandbox.sha` to equal the pushed commit (the sandbox redeploys
separately). Pin a run to production with `"target":"production"` in the body.

### Real accounts (V4)

The gate key can never write to a real account — real users stay read/dry.
A write check on a real account is started only by an admin in the admin
app (Insights → Real-account checks); never ask for or try to work around
that. The whole path is tested on the sandbox with suite `real-user`.

## Workflow

1. Unit/contract tests pass locally.
2. Push. Wait for Render: poll `curl -s https://api.akoro.name.ng/health | jq -r .build.git`
   until it equals the pushed commit (`git rev-parse HEAD`).
3. Run the affected suite (or scenario), pinned to that commit:
   ```bash
   SHA=$(git rev-parse HEAD)
   ID=$(curl -s -X POST $B/runs -H 'Content-Type: application/json' \
     -d "{\"suite\":\"regression\",\"expectSha\":\"$SHA\",\"wait\":false}" | jq -r .data.id)
   # poll (the outbound proxy cuts requests held open ~60 s+, so never wait inline)
   until [ "$(curl -s $B/runs/$ID | jq -r .data.status)" = done ]; do sleep 10; done
   curl -s $B/runs/$ID | jq '.data | {id, verdict, sha, reason, scenarios: [.scenarios[] | {name, verdict, repeats, failed: [.failed[] | {name, expected, actual}]}]}'
   ```
   One scenario: `{"scenario":"chat.schedule_message_here","params":{"learner":"@tester01"},"wait":false}`.
   The full regression suite takes about a minute.
4. Report: verdict, run id, commit, and every failed assertion with expected/actual.
5. FAIL → fix and repeat. BLOCKED → say exactly what blocked it (stale deploy,
   fixture drift, flag off…). ERROR → it's a gate problem; say so.

## Suites

`smoke` · `agent-chat` · `agent-network` · `battles` · `regression` (everything
that doesn't write) · `writes` (real changes on test learners + `writes.no_residue`).

- **Writes on production** need `VERIFY_ALLOW_WRITES=true` on the Render
  service; without it they come back BLOCKED. Locally they always run.
- **Model comparison:** `{"scenario":"chat.schedule_message_here","models":["gpt-4o-mini","gpt-4.1"],"wait":false}`
  → `data.compare` lists each model's verdict side by side.

## Accounts

- Test learners `@tester01`…`@tester50` (seeded): any scenario.
- Real users (`@username` / email / id): `read` and `dry` scenarios only — the
  gate refuses writes, saves nothing to their chats, audit-logs every run.
  Only use a real account when the user asks (e.g. to reproduce their bug).

## Adding a scenario

`akoro-api/modules/verify/scenarios/<area>.js` → export `{ name, area, risk,
description, params?, repeats?, run(ctx, p) }`, register it in
`scenarios/index.js` (and a suite). Drive through `ctx.http` / `ctx.agent`,
check evidence with `ctx.db` and `ctx.expect.*`; a missing precondition is
`ctx.expect.blocked(reason)`, never a silent pass. Writes (`risk: "write"`)
need `ctx.cleanup(undo)` for everything they create.

## Local target (before deploying)

```bash
STACK_DIR=<scratchpad>/stack akoro-api/scripts/verify/local-stack.sh   # idempotent; re-run after a restart
B=http://127.0.0.1:4600/api/verify; K='Authorization: Bearer local-console-key'
```
Real API on Postgres + PostgREST + Redis, all migrations and the 50 testers,
`VERIFY_TARGET=local` (writes allowed). With the mock model (no
`OPENAI_API_KEY`), scenarios that judge the model's tool choice FAIL by design;
everything else is meaningful.
