---
title: Course model
status: beta
doc_status: draft
tier: 1
audience: [developer, instructor, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Course model

## What it represents

A course is a structured learning product with lessons and media. Courses can
be live or on-demand and are created by instructors.

## Identifiers

- `courses.id` — UUID.
- `courses.slug` — public URL slug.
- `lessons.id`, `videos.id` — UUIDs.

## Important fields

`courses` includes `id`, `slug`, `title`, `description`, `subject`, `level`,
`is_free`, `price`, `currency`, `total_students`, `rating`, `total_hours`,
`course_type` (`live|video`), `cover_image_url`, `instructor_id`,
`is_published`, timestamps.

Related tables:

- `course_modules` — ordered modules.
- `lessons` — ordered lessons.
- `enrollments` / `lesson_progress` / `video_progress`.
- `videos` — source, HLS path, status, progress, variants.
- `live_sessions` — scheduled/live/recorded sessions.
- `reviews`, `certificates`.
- `edu.builder_courses` — instructor course-builder drafts.

## Relationships

```text
instructor -> courses -> course_modules -> lessons -> videos
                        -> enrollments -> learners -> progress
                        -> live_sessions
                        -> reviews / certificates
```

## Ownership and access

- Owner: the instructor; admins can manage all courses.
- Readers: published courses are public; lesson content is enrolled/authorised.
- Writers: the owning instructor or admin.
- Draft videos are not public.

## Lifecycle

- Course draft -> review -> published.
- Video: queued -> encoding -> completed/failed.
- A published course may have draft lessons/videos; only published content is
  visible to learners.

## Agent guidance

- Never publish on behalf of an instructor without authorisation.
- Do not assume a course is public because an id exists.
- Do not publish a failed/partial video encode.
- Preserve ownership checks when adding lessons or media.

## Related

- [Courses and media](../01-features/courses/overview.md)
- [Publish a course video](../13-examples/workflows/course-video-publish.md)
- [Programme model](programme.md) (planned)
