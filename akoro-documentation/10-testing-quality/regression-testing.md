---
title: Regression testing
status: beta
doc_status: draft
audience: [engineer, qa, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Regression testing

Regression testing in Akoro is the verification gate: a registry of named
scenarios with deterministic assertions, composed into suites, run against
a target environment with captured evidence. This document describes how
the system works and how runs are interpreted. The catalogue of areas is
in [Feature test cases](feature-test-cases.md); the module itself is
`akoro-api/modules/verify`.

## How the gate works

- **Registry.** Scenarios live in `modules/verify/scenarios/`, one file
  per area, and are registered in `scenarios/index.js` with a name, suite
  memberships and a risk level. Suites are named selections — per-feature
  suites, phase close-out suites, and the `regression` suite.
- **The regression suite** is defined as every registered scenario whose
  risk is not `write`, excluding the evals result case and any scenario
  explicitly marked non-regression, with a small named subset of
  self-tooling cases retained. Write-risk coverage runs in its own suites
  (for example `self-tooling-writes`) against targets that allow writes.
- **Runner and evidence.** A run executes its scenarios against the
  target, records per-scenario verdicts and assertion evidence, and is
  retrievable afterwards by run ID — a verdict without its evidence is
  not a result.
- **Target policy.** The gate's policy module decides what a run may do:
  production is read-only unless writes are explicitly enabled, and
  real-user runs additionally require a short-lived admin approval.
  Sandbox is the normal regression target.

## Reading a run

- Verdicts are **PASS**, **FAIL** (an assertion did not hold), **ERROR**
  (the scenario could not complete — timeouts on slow model turns are the
  common case) and **blocked** (a precondition, such as a demo account's
  enrolment or a feature flag, was not met).
- A run is reported with its target, the build under test, the suite and
  the counts — for example, a recent full sandbox regression run selected
  55 scenarios and returned 53 PASS, 1 FAIL (a model benchmark case) and
  1 ERROR (a gate-side timeout). That run is a FAIL overall: the gate
  does not round up.
- FAIL and ERROR are triaged differently: a FAIL is triaged to the owning
  area as a product or model defect; an ERROR is re-run first, because it
  usually indicts the run, not the product.

## When regression runs happen

- On demand before a release is accepted (see
  [Release acceptance criteria](release-acceptance-criteria.md)).
- After changes to shared machinery — the agent loop, auth, self-tooling,
  the learning engine — using the owning suites plus `regression`.
- After an incident fix, adding the scenario that would have caught it.

## Keeping the suite trustworthy

- Assertions stay deterministic; model-dependent cases assert facts and
  structure, not wording.
- A scenario that fails for environmental reasons is fixed or marked
  blocked with its precondition — never deleted to make a run green, and
  never excluded from `regression` without the exclusion being visible in
  the registry definition.
- New features register their scenarios in the same change that ships the
  feature; a feature without scenarios is a known coverage gap, reported
  as such.

## Relationship to other layers

The gate complements, and does not replace, the co-located `node --test`
suites (fast, serverless) and the sandbox smoke scripts (write paths with
cleanup). A change is regression-clean only when the layers it touches
are green — see [Quality assurance strategy](quality-assurance-strategy.md).

## Related

- [Feature test cases](feature-test-cases.md)
- [Release acceptance criteria](release-acceptance-criteria.md)
- [Scripts README](../scripts/README.md)
- [Audit logging](../09-security-governance/audit-logging.md)
