---
title: Agent evaluation
status: beta
doc_status: draft
audience: [engineer, qa, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Agent evaluation

Agent correctness — *did the agent choose and execute the right actions?* —
is evaluated separately from software correctness, because the same code
can pass every unit test while the model inside it behaves badly. This
document describes the evaluation systems that exist today and how their
results are read. Governance expectations for the agent are in
[AI governance](../09-security-governance/ai-governance.md).

## Evaluation surfaces

1. **Benchmark cases (`evals` scenarios).** The verification gate carries
   an evals scenario set that runs fixed benchmark tasks against the live
   agent — for example multi-step task-planning cases — and asserts that
   every case in the set passes. Benchmarks run against the configured
   model, so a failure is a model/behaviour signal, not a route failure,
   and is reported as such. Admin surfaces also expose evaluation tooling
   and agent ratings for human review.
2. **Behavioural scenarios.** Chat and workflow scenarios assert agent
   behaviour end-to-end: tool-error honesty (the agent reports a failed
   tool truthfully), dry-run discipline (a dry run writes nothing),
   past-question truthfulness, protégé identity answers, capability
   answers in plain language, and correct tool routing for instructor and
   learner requests.
3. **Model-selection scenarios.** Cases under the `models.*` names assert
   that configured model picks persist, reach the workflows that should
   use them, respect tier lists, and that refusal/fallback behaviour works
   — a refused or failed primary answer must degrade to a working
   fallback, not to an empty or fabricated reply.
4. **Self-tooling scenarios.** The `selftool.*` suites evaluate the
   agent's tool-building behaviour: builds follow the consent flow,
   escalations happen when a build exceeds the agent's reach, change
   applications match what was approved, and generated code tools stay
   inside their sandbox.
5. **Hygiene and outreach scenarios.** Cases cover agent-network hygiene:
   no flooding of a learner's chat, tell-only reports staying tell-only,
   privacy edges in discovery and contact, and protected learners never
   being auto-answered.

## How results are read

- A benchmark FAIL names the failing case set; the response is to inspect
  the case, not to loosen the assertion. Model-side variance is a known
  failure mode: a single flaky pass does not clear a benchmark, and a
  single failure is triaged (re-run the suite) before it is called a
  regression.
- Scenario verdicts are PASS / FAIL / ERROR / blocked. An ERROR (for
  example a gate-side timeout on a slow model turn) is not a PASS and not
  proof of a product defect; it is re-run before conclusions are drawn.
- Evaluation results are reported with target, build and model context.
  An eval claim without its run is anecdote.

## What evaluation does not do

- It does not measure learning outcomes; that is
  [Learning effectiveness evaluation](learning-effectiveness-evaluation.md).
- It does not replace the confirmation and consent mechanisms; it verifies
  the agent respects them (see
  [Human approval policy](../09-security-governance/human-approval-policy.md)).
- It does not certify a model for a new capability area; new areas add
  their own scenarios before launch, per
  [Feature test cases](feature-test-cases.md).

## Adding an evaluation

New agent behaviour ships with: one happy-path scenario asserting the
chosen tools and the verified side effect; one honesty case (failure or
missing capability reported truthfully); and, where the behaviour spends
money or writes data, one boundary case (budget ceiling, consent refusal,
or dry-run no-write).

## Related

- [Quality assurance strategy](quality-assurance-strategy.md)
- [Feature test cases](feature-test-cases.md)
- [AI governance](../09-security-governance/ai-governance.md)
- [Agent capabilities](../06-agents/agent-capabilities.md)
