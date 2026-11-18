# AGENTS.md

Akoro monorepo. The API is `akoro-api/`; the apps are `akoro-learner/`, `akoro-school/`,
`akoro-instructor/`, `akoro-admin/`. Plan and phases: `reference/Grand Plan.md`.

## Commands

```bash
# API tests (node:test; there is no aggregate runner)
cd akoro-api
npm run test:structure        # structural guardrails (Phase 19) — always run
npm run test:agent-chat
npm run test:task-scheduling
npm run test:agent-context
npm run typecheck             # tsc --noEmit (Phase 20 Part B)

# Learner app
cd akoro-learner
npm run typecheck
npx vite build
npm test                      # ui-gate-free unit tests, see package.json
```

`node --test <file>` runs one test file. The API suite needs `npm ci` in
`akoro-api/` (some tests need the `bcrypt` native binding, which the cloud
sandbox may not build).

## Structural rules (Phase 19)

`akoro-api/modules/structure.contract.test.mjs` ratchets against
`akoro-api/modules/structure-baseline.json`; rules in `akoro-api/modules/README.md`.
The baseline may only shrink: fix the code, then `npm run structure:baseline`.
New files over 600 lines fail; modules are entered through `index.js` only;
no import cycles; every module needs a README.

## Verify on the sandbox before claiming a fix

The gate is the source of truth (`.claude/skills/verify/SKILL.md`):

```bash
set -a; . ~/.akoro_console.env; set +a
B=https://sandbox.akoro.ng/api/verify                 # sandbox gate (its own DB)
curl -s $B/scenarios -H "Authorization: Bearer $AGENT_CONSOLE_KEY"
```

1. Commit/push, then wait for `https://sandbox.akoro.ng/health` `.build.git`
   to equal the pushed SHA (cold start can answer 502 for a minute).
2. Start a suite pinned to that SHA and poll (never hold the request open):

```bash
SHA=$(git rev-parse HEAD)
ID=$(curl -s -X POST $B/runs -H "Authorization: Bearer $AGENT_CONSOLE_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"suite\":\"regression\",\"expectSha\":\"$SHA\",\"wait\":false}" | jq -r .data.id)
curl -s $B/runs/$ID -H "Authorization: Bearer $AGENT_CONSOLE_KEY" | jq '.data | {status, verdict, reason}'
```

3. Report verdict, run id, commit, and every failed assertion. FAIL/BLOCKED is
   not verified. The production gate's sandbox forwarding can be stale — if it
   answers 503, run against `sandbox.akoro.ng` directly.

Learner-app changes also use the frontend gate: `akoro-learner/ui-gate/README.md`.

## Screenshots and previews

`scripts/README.md` — local dev server against `sandbox.akoro.ng`, capture to
`/artifacts/screenshots` (never the repo; the platform auto-commits and pushes
the worktree, and this branch auto-deploys), read the PNG directly.

## Deploy model

`kilo/modular-storm-thz` deploys on push (`render.yaml`: `autoDeployTrigger:
commit`). Anything written inside the repo ships; previews belong in
`/artifacts`.
