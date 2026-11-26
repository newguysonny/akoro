---
title: Feature test cases
status: beta
doc_status: draft
audience: [engineer, qa, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Feature test cases

Feature-level testing in Akoro is scenario-based. The catalogue of record
is the verification gate's scenario registry
(`akoro-api/modules/verify/scenarios/`): each scenario is a named,
deterministic end-to-end case with explicit assertions and captured
evidence, grouped into suites in `scenarios/index.js`. This document
describes how feature cases are organised and what the major areas cover;
the registry itself is the source of truth for the exact case list.

## How a feature case is written

- A scenario is registered with a dotted name (`area.case`), a suite and a
  risk level (`read` or `write`). Write-risk scenarios are excluded from
  read-only targets by the gate's policy.
- Assertions are deterministic: status codes, response shapes, state
  read-backs and residue checks. A scenario that depends on a model's
  free-text wording asserts structure and facts, not phrasing.
- Write scenarios clean up after themselves, and the `writes.no_residue`
  scenario verifies that a write suite left nothing behind.
- Blocked preconditions (a demo account not enrolled, a feature flag off)
  are reported as blocked, never silently passed.

## Coverage by area (scenario files)

| Area | Scenario files | What they prove |
| --- | --- | --- |
| Platform smoke | `smoke.js`, `platform.js` | Health/build identity, storage and embeddings liveness, search fallback, tools catalogue, session-token hygiene |
| Agent chat | `chat.js`, `chatContinuity.js`, `activityChat.js` | Tool honesty, dry-run no-writes, history tools, follow-ups, identity and capability answers |
| Study Prep / teaching | `studyprep.js`, `studyPrepExit.js`, `teaching.js`, `teachingChain.js`, `teachingTools.js`, `teachingAgent.js` | Plan lifecycle, budget ceilings, cap-outs, plan rejection, teaching runs to mastery, exit paths |
| Learning engine | `learningEvents.js`, `learningSignals.js`, `learnerModel.js`, `decay.js`, `decayReview.js` | Event recording, misconception capture, strategy outcomes, next-action model, review scheduling/decay |
| Materials & reader | `materials.js`, `reader.js`, `imageExtraction.js`, `handwritingRead.js`, `photoAnswer.js`, `syllabusImport.js` | Upload/extraction pipeline, reader behaviour, image and handwriting reading, syllabus import |
| Grading & activities | `grading.js`, `classGrading.js`, `activities.js`, `activityReview.js`, `practice.js` | Scoring verdicts, class grading, activity lifecycle and review |
| Instructor | `instructorTools.js`, `instructorActivities.js` | Instructor tool routing and activity management |
| Battles & network | `battleChat.js`, `battleSeries.js`, `network.js`, `networkAuto.js` | Battle entry gates and chat surfaces, recurring series, network privacy edges |
| Self-tooling | `selftool.js`, `selftoolChanges.js` | View/schema integrity, build consent, change application, sandbox containment |
| School | `schoolStruggles.js` | School-scoped struggle records and scope enforcement |
| Cross-cutting | `cost.js`, `latency.js`, `redisIdle.js`, `socket.js`, `eventStream.js`, `inbox.js`, `suggestions.js`, `voice.js`, `agentHygiene.js`, `agentOutreach.js`, `proactive*.js` | Cost scaffolds, latency, realtime channels, suggestion quality, proactive delivery rules |

## Suites

Scenarios are composed into named suites — among them `smoke`, `regression`
(the default full set; see [Regression testing](regression-testing.md)),
per-feature suites (`study-prep`, `battles`, `self-tooling`,
`self-tooling-writes`, `instructor-teaching-tools`, …) and phase close-out
suites that pin a milestone's whole surface in one run. A recent full
sandbox regression run selected 55 scenarios; suite membership, not this
document, defines the current count.

## Adding a feature case

1. Write the scenario in the area's file under `scenarios/` (or a new file)
   and register it in `scenarios/index.js` with suite and risk.
2. Keep assertions deterministic and evidence small, per the verify
   module's own README.
3. If the feature has a permission boundary, add the denial case too —
   see [Security testing](security-testing.md).
4. Run the owning suite against the sandbox before claiming the feature
   works.

## Related

- [Quality assurance strategy](quality-assurance-strategy.md)
- [Regression testing](regression-testing.md)
- [API test cases](api-test-cases.md)
- [Scripts README](../scripts/README.md)
