---
title: Learning session model
status: beta
doc_status: draft
tier: 2
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Learning session model

## What it represents

A structured learning interaction. Different session types share the
workflow engine but have distinct tables and rules.

## Session types

| Type | Core table | Purpose |
| --- | --- | --- |
| Study Prep | `edu.study_prep_sessions` | Plan and study selected topics |
| Adaptive/teaching | `edu.adaptive_sessions` | Agent-driven teaching turns |
| Assessment | `edu.assessment_sessions` | Practice/test attempts |
| Workflow | `edu.workflow_instances` | Generic durable workflow state |

## Important fields

`edu.study_prep_sessions` includes `id`, `learner_id`, `goal`, `subject`,
`class_level`, `entry_mode`, `exam_board`, `status`, `paused_reason`, `plan`,
`estimate`, `policy_version`, `tool_calls_used`, timestamps.

`edu.study_prep_topics` links a session to syllabus topics and per-topic state.
`edu.study_prep_events` records the sequence of actions.

`edu.workflow_instances` / `edu.workflow_events` mirror workflow state and events.

## Status lifecycle

Study Prep:

```text
planning -> awaiting_confirmation -> topic_active -> completed
                                   -> replanning
                                   -> paused -> topic_active
                                   -> abandoned / cancelled
```

Only one active Study Prep session per learner is allowed by a partial unique
index.

## Relationships

```text
learner -> study_prep_sessions -> study_prep_topics -> syllabus topics
                               -> study_prep_events
learner -> adaptive_sessions
learner -> assessment_sessions
```

## Ownership and access

- Owner: the learner.
- Writers: the learning harness/engine; the learner for confirm/adjust/answer.
- Agents may propose transitions but the engine validates them.

## Agent guidance

- Do not skip confirmation, teach-back or pause gates.
- Do not mark mastery from a session outcome without evidence.
- Do not create a second active session.
- Always re-read the session view after a 409.

## Related

- [Study Prep workflow](../13-examples/workflows/study-prep.md)
- [Concept model](concept.md)
- [Learner model](learner.md)
