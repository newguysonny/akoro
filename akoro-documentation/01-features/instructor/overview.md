---
title: Instructor overview
status: beta
doc_status: overview
tier: 2
audience: [instructor, developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capabilities: []
---

# Instructor overview

## What it covers

Course creation and delivery, live/on-demand lessons, students, assignments,
submissions, grading, assessments, documents, wallet and library.

## Observed surfaces

- Instructor app: 56 frontend routes.
- `instructor` module: 32 route declarations.
- `course-builder`: 13 route declarations.
- `self-study`: 43 route declarations for assignments, drafts, routines and
  grading.
- Course media pipeline via `courses/stream` and the media worker.

## Primary flows

1. Create a course and modules.
2. Add live or on-demand lessons.
3. Upload course video through the direct-to-R2 flow.
4. Publish the course/lessons.
5. Create assignments/assessments.
6. Review submissions and grade.
7. Track students and earnings.

## Status

Implemented but broad; treat as **beta** for public docs. Course-video publishing
is implemented but depends on the media worker and R2 configuration.

## Permissions

- Instructor owns their courses and student data for enrolled learners.
- Admin can manage all courses.
- Learners see only published content and their own progress.

## Documentation gaps

- Course-builder field reference.
- Assignment/submission lifecycle.
- AI grading rules and human override.
- Live-session platform setup.
- Earnings/payout rules.

## Related

- [Courses and media](../courses/overview.md)
- [Publish a course video](../../13-examples/workflows/course-video-publish.md)
- [Course model](../../05-data-models/course.md)
- [Phase 0 audit](../../../docs/audits/phase-0-documentation-audit.md)
