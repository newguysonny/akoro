---
title: Assessment model
status: beta
doc_status: draft
tier: 2
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Assessment model

## What it represents

An assessment is a structured evaluation of a learner. On the learning side
it is one proctored Practice session in `edu.assessment_sessions` — the
table the Grand Plan's Practice workflow uses. School-side examinations are
a separate model in the `mgmt` schema (`mgmt.exams`, `mgmt.exam_marks`,
`mgmt.online_exams`, `mgmt.question_bank`) and are not the same entity.

## Identifier

- `edu.assessment_sessions.id` — UUID.
- Note: `student_id` on `edu.assessment_sessions` is `TEXT`, not a foreign
  key — do not assume referential integrity there; `student_agent_id` is a
  UUID reference to the learner's agent.

## Important fields

`edu.assessment_sessions` includes:

- `student_id`, `student_agent_id`, `topic`, `subject`.
- `status` — `active|completed|abandoned|terminated`.
- Identity verification: `reference_image_url`, `identity_verified`.
- Transcript and questions: `block_history` (JSONB block array, the same
  shape the UI renders), `questions` (JSONB generated question bank).
- Proctoring: `cheat_events` (JSONB array of `{ts, type, severity,
  detail}`), `proctoring_signals` (JSONB rolling counts/ratios).
- Scoring: `assessment_score` (0–100), `cheat_probability` (0–1),
  `final_verdict` (`pass|fail|flagged|terminated`), `verdict_detail`
  (the written verdict).
- `started_at`, `completed_at`, `updated_at`. The Grand Plan (section
  14.2) also records a `workflow_id` addition linking the session to its
  Practice workflow instance.

School side: `mgmt.exams` and `mgmt.exam_schedules` define an examination;
`mgmt.exam_marks` records marks per student; `mgmt.grade_scales` and
`mgmt.report_card_setups` shape reporting.

## Relationships

```text
learner -> edu.assessment_sessions -> questions / block_history
        -> final_verdict -> evidence (assessment_result)
        -> edu.learner_concept_state (via the learning engine)
school -> mgmt.exams -> mgmt.exam_marks -> mgmt.students
```

## Ownership and access

- Owner: the learner for their assessment sessions; the school for its
  examinations and marks.
- Readers: the learner (own results), authorised instructors, school staff
  for their school.
- Writers: the assessment engine — scoring, proctoring aggregates and the
  verdict are server-side and deterministic; the learner writes only
  answers.
- Answer keys stay server-side and never enter the model's context
  unnecessarily.

## Lifecycle

```text
active -> completed (verdict pass | fail | flagged)
       -> abandoned
       -> terminated (kicked for cheating)
```

## Agent guidance

- Never decide or change a score, verdict or cheat probability; the
  Education Engine owns them.
- Never reveal answer keys or upcoming questions to the learner.
- Do not treat a flagged verdict as a fail; report it as flagged.
- A completed assessment produces `assessment_result` evidence; it does
  not by itself set mastery.

## Related

- [Learning session model](learning-session.md)
- [Evidence model](evidence.md)
- [Concept and mastery model](concept.md)
- [Learning and assessment](../01-features/learning/overview.md)
