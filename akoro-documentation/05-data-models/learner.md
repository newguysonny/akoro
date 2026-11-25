---
title: Learner model
status: implemented
doc_status: draft
tier: 2
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Learner model

## What it represents

A learner is a `public.users` row with role `student` (and, in a school, a
student record under `mgmt.students`). The learner owns progress, records,
goals, memory and concept evidence.

## Identifier

- `public.users.id` — UUID.

## Important fields

`public.users` includes `id`, `email`, `username`, `full_name`, `avatar_url`,
`role`, `is_active`, `email_verified`, `onboarding_completed`, `deleted_at`,
`deactivated_at`, `two_factor_enabled` and `two_factor_secret`.

## Relationships

```text
public.users (learner)
  -> edu.records
  -> enrollments -> courses
  -> lesson_progress / video_progress
  -> edu.study_prep_sessions -> edu.study_prep_topics
  -> edu.adaptive_sessions
  -> edu.assessment_sessions
  -> edu.learner_goals
  -> edu.learner_concept_state -> edu.concept_catalog
  -> edu.learner_concept_evidence
  -> edu.learner_agent_memories
  -> edu.learner_soul_preferences / check-ins / episodes
  -> edu.workflow_instances
```

## Ownership and access

- Owner: the learner.
- Readers: the learner, authorised instructors for enrolled courses, school
  staff for their school, platform admins.
- Writers: the learner for their own preferences; server-side learning engine
  for concept state/evidence; authorised staff where policy allows.
- Tenant isolation: school data is scoped by school id; learner Library content
  is owner-scoped.

## Lifecycle

- Registered -> email verified -> onboarding -> active.
- Deactivated accounts may auto-reactivate within the grace period.
- Deleted accounts are permanently blocked.

## Agent guidance

- Never assume a learner id from an email or name.
- Never read another learner's records or memory.
- Do not treat a learner's self-report as mastery evidence.
- Do not change concept state directly; the learning engine owns it.

## Related

- [Concept model](concept.md)
- [Records model](record.md)
- [Course model](course.md)
