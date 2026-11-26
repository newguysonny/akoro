---
title: Agent verification
status: beta
doc_status: draft
audience: [agent, engineer]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Agent verification

How an agent knows a task actually worked — and how the platform verifies
agents themselves. "The code exists" and "the call returned success" are both
insufficient.

## 1. Per-action verification

Every capability in the [capability registry](../capability-registry.yaml)
carries a `verification` list and a `verification_status`. The agent's rules:

- After a write, verify the side effect — preferably with a follow-up read
  through a documented capability (list the records, re-read the tool, fetch
  the session) — before reporting success.
- Match evidence to the expected state: the exact item, count and owner, not
  a plausible-looking response.
- If a write times out or returns ambiguously, verify the state **before**
  retrying; retry only idempotent calls or calls carrying an idempotency key.
- Report what was verified and what was not. A check that was not run is
  stated as unverified, never implied.

Registry entries record how they were last verified (for example sandbox or
production smoke, with a date). An `implemented` capability whose documents
or operations are missing is a documentation defect, not an invitation to
improvise.

## 2. The verification gate

The API carries a dedicated verify module: scripted scenarios run against a
target environment (sandbox first) and produce per-scenario pass/fail
verdicts. Scenario families cover smoke (health, storage, embeddings, token
scoping, rate limits), the agent chat surface, instructor tools, materials,
self-tooling, battles entry gates, network privacy edges and model benchmark
cases. A run that returns FAIL is reported as not verified — partial passes
do not round up, and a gate-side timeout is reported as an error, distinct
from a feature failure.

Live tests belong on the sandbox, never on production. Production is checked
read-only (for example, fetching a deployed file or bundle back and comparing
it) to confirm a deploy landed; behaviour is proven on the sandbox.

## 3. Documentation validation

The offline half of verification, run from `akoro-documentation/`:

```bash
node scripts/validate-docs.mjs
node scripts/validate-tool-registry.mjs
node scripts/search-docs.mjs "records ask"
```

These check the index, registries, Markdown links, OpenAPI references and
tool/capability alignment. They are necessary but not sufficient: they prove
the documentation is internally consistent, not that runtime behaviour
matches it.

## 4. Agent evaluation

Model and agent quality are evaluated separately from feature verification:
benchmark cases (for example task-planning cases) run against the configured
model and can fail while every feature scenario passes. An evaluation
failure is a model-quality signal, reported as such — it is not hidden
inside a feature verdict, and a feature pass does not excuse it.

## Related

- [Agent capability discovery and execution](agent-capabilities.md)
- [Agent error recovery](agent-error-recovery.md)
- [Capability registry](../capability-registry.yaml)
- [Agent guide](../AGENTS.md)
