---
title: Courses and media overview
status: beta
doc_status: overview
tier: 1
audience: [developer, learner, instructor, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Courses and media overview

Courses are the structured learning product. The public catalogue is
unauthenticated; course access, progress and media management are
authenticated and role-gated.

## Public catalogue

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/courses/published` | Published courses; optional `q`, `type`, `limit` |
| GET | `/api/courses/:idOrSlug/full` | Published course detail |
| GET | `/api/live-sessions` | Upcoming, live and recorded sessions |
| GET | `/api/instructors/featured` | Active instructors |

These endpoints only expose published catalogue data. Draft courses, unpublished
lessons and private fields do not leave the API.

## Authenticated course surface

- Enrolments and my-courses.
- Lessons, modules and progress.
- Reviews and certificates.
- Live-session participation.
- Instructor course management and student lists.

The full authenticated surface is Tier 2 and is documented by workflow, not by
listing every route.

## Course video pipeline

1. Instructor requests a direct upload URL (presigned PUT).
2. Browser uploads the source to R2.
3. Upload completion HEADs the object and queues encoding.
4. The API coordinator probes the source, fans out one container per rendition,
   polls them, writes the HLS master playlist and marks the video complete.
5. The learner receives the playback URL and status.

Video status is `queued`, `encoding`, `completed` or `failed`. Encoding is
asynchronous; callers must poll status rather than assume immediate playback.

Some learner-side media states are still partial, such as rendered episode
playback and audio narration. Treat media features as **beta** until the
specific workflow is verified end-to-end.

## Capabilities

- `courses.list_published`
- `courses.get_published`

## Related

- [Programmes overview](../programmes/overview.md)
- [Library overview](../records/overview.md)
- [OpenAPI](../../02-api/openapi.yaml)
- [Phase 0 audit](../../../docs/audits/phase-0-documentation-audit.md)
