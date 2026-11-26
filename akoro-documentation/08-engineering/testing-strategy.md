---
title: Testing strategy (engineering)
status: implemented
doc_status: complete
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---
# Testing strategy (engineering)

How engineers run tests day to day: the suites that exist, the commands that
run them, and the sandbox verification gate. The QA strategy itself — what
correctness means for software, agents, learning and security, and release
acceptance — lives in [Testing and quality](../10-testing-quality/README.md);
this page is only the engineer's how-to.

## API tests (`akoro-api`)

Tests use the built-in `node:test` runner. There is **no aggregate runner** —
suites are named npm scripts, each an explicit list of test files. From the
repository `AGENTS.md`, the always-relevant set:

```bash
cd akoro-api
npm run test:structure        # structural guardrails — always run
npm run test:client           # shared client core: copies + behaviour
npm run test:agent-chat       # agent chat contracts (loop, trace, intent, realtime)
npm run test:task-scheduling  # learner task validation + follow-ups
npm run test:agent-context    # conversation context + tool-request validation
npm run typecheck             # tsc --noEmit
node --test <file>            # a single test file
```

Further suites declared in `akoro-api/package.json`:

- `npm run test:emails` — auth email rendering.
- `npm run test:adaptive-teaching` — teaching evidence, teaching-workflow
  runner, document grounding contracts.
- `npm run test:imports` — module import graph, barrel exports, unbound
  helpers.
- `npm run test:extract` — record extraction lanes and contracts.
- `npm run preflight` — `scripts/preflight-security.mjs`, the security
  preflight check.
- `npm run smoke:instructor` — `scripts/smoke-instructor.mjs`.

Conventions:

- Unit tests are `*.test.mjs`; contract tests are `*.contract.test.mjs` and
  assert shapes and invariants across module boundaries. Both sit next to the
  code they cover.
- Tests that import the self-tooling pipeline need the test environment
  loaded first (`akoro-api/test-env.mjs` exists for this).
- The API suite needs `npm ci` in `akoro-api/` — some tests need the `bcrypt`
  native binding, which a cloud sandbox may not build.

## Frontend tests (`akoro-learner`)

```bash
cd akoro-learner
npm run test:onboarding     # onboarding chat unit tests
npm run test:agent-actions  # agent chat endpoint/transport/trace/UI contracts
npm run test:reader         # reader, extraction-run and suggestion suites
npm run test:settings       # settings groups
npm run test:split          # app/landing target split contracts
npm run test:features       # feature boundary tests
npm run lint:undef          # eslint over src
npm run typecheck
node ui-gate/run.mjs --scenario reader.opens_text --device phone
```

The `ui-gate` runs real-browser journeys against the sandbox API; learner-app
changes are verified through it as well as through unit tests.

## Sandbox verification gate

Passing tests are necessary, not sufficient. Behaviour changes are verified
live on the sandbox (`https://sandbox.akoro.ng`, its own database):

1. Push to `kilo/modular-storm-thz` and wait for the sandbox `/health`
   endpoint's `.build.git` to equal the pushed SHA.
2. Start a verify run (suite `regression`) pinned to that SHA via the verify
   gate described in the repository `AGENTS.md`, then poll for the verdict.
3. Report the verdict, run id, commit and every failed assertion. A FAIL or
   BLOCKED verdict means the change is **not verified**, whatever the local
   tests said.

The documentation smoke scripts (`sandbox-write-smoke.mjs`,
`sandbox-auth-smoke.mjs`, `sandbox-course-video-smoke.mjs`,
`sandbox-content-validation.mjs`) follow the same rule — sandbox host only,
no action without `--confirm` (see [scripts README](../scripts/README.md)).

## What a pattern-matching test does not prove

A contract test that only pattern-matches source text proves the text exists,
not that the behaviour works. Claims of "fixed" or "live" require the sandbox
run (API behaviour) or a real-browser run (UI behaviour), plus — for shipped
code — fetching the pushed file back and confirming the change is in the
deployed build.
