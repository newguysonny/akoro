---
title: Quality assurance strategy
status: beta
doc_status: draft
audience: [engineer, qa, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Quality assurance strategy

Akoro is a learning platform with an autonomous agent inside it, so "does
it work?" is four different questions. This strategy keeps them separate,
because a release can pass one and fail another.

## Four kinds of correctness

| Type | Question | Primary evidence |
| --- | --- | --- |
| Software correctness | Does the feature work? | Unit/contract tests, feature scenarios, sandbox smoke scripts |
| Agent correctness | Did the agent choose and execute the right actions? | Agent scenarios, benchmark evals, tool-call assertions |
| Educational effectiveness | Did the activity produce meaningful learning evidence? | Learning-signal scenarios, mastery/review evidence checks |
| Security correctness | Did the system enforce the required permissions? | Security scenarios, auth contract tests |

A change is assessed against every type it touches. A chat change, for
example, is never only a software change: it can alter what the agent does
(agent correctness) and what a learner learns (educational effectiveness)
in the same commit.

## The test layers that exist

1. **Co-located automated tests.** Modules carry their own `*.test.mjs`,
   `*.contract.test.mjs` and `*.behavior.test.mjs` suites, run with the
   Node test runner (`node --test`). Contract tests pin shapes and rules
   (auth flows, self-tooling consent and permission flows, structure
   baselines); behaviour tests pin observable behaviour. These run without
   a server and are the first gate for any change.
2. **The verification gate.** `akoro-api/modules/verify` is a scenario
   registry and runner that exercises the live system over HTTP: suites of
   named scenarios with deterministic assertions and captured evidence,
   run against a target environment. It is the platform's integration and
   regression system — see [Regression testing](regression-testing.md).
3. **Sandbox smoke scripts.** The documentation repository ships guarded
   end-to-end scripts (auth, records write path, course video, content
   validation) that run only against the sandbox and only with an explicit
   confirmation flag — see [Scripts README](../scripts/README.md).
4. **Documentation validation.** `validate-docs.mjs` and
   `validate-tool-registry.mjs` check that the docs, registries and
   OpenAPI contract agree with each other; documentation drift is a
   quality defect, not an editorial one.

## Environments

- **Local/unit** — layers 1 and 4; no network, no real data.
- **Sandbox** — the verification target. It has its own database and demo
  accounts; live behaviour claims are proven here, never on production.
- **Production** — read-only for verification. The gate's policy keeps
  production writes off unless explicitly enabled, and real-user runs
  additionally require a short-lived admin approval (see
  [Human approval policy](../09-security-governance/human-approval-policy.md)).

## Rules

- **A pattern-matching test is not verification of behaviour.** Where a
  behaviour matters, prove it with a scenario or a live sandbox run, not
  only with a source-text assertion.
- **No invented metrics.** Coverage percentages and pass-rate claims are
  stated only from an actual run's output. A run is reported with its
  target, build and verdicts — including failures.
- **Failures are signal, not embarrassment.** A FAIL or ERROR verdict is
  reported as-is, triaged to its owning area, and either fixed or carried
  as a known defect; it is never silently reclassified.
- **Every boundary change ships its test.** New routes declare their role
  and ownership rules with a test or scenario that proves a forbidden
  access fails (see [Security testing](security-testing.md)).

## Where the detail lives

- [Feature test cases](feature-test-cases.md) — scenario coverage by feature
- [API test cases](api-test-cases.md) — contract and endpoint testing
- [Agent evaluation](agent-evaluation.md) — agent correctness
- [Learning effectiveness evaluation](learning-effectiveness-evaluation.md)
- [Release acceptance criteria](release-acceptance-criteria.md) — the gate a release must pass

## Related

- [Scripts README](../scripts/README.md)
- [Agent capabilities](../06-agents/agent-capabilities.md)
- [Root README](../README.md)
