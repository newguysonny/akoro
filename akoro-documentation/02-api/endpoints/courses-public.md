---
title: Public course catalogue
status: implemented
doc_status: overview
tier: 1
audience: [developer, learner, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: courses.list_published
---

# Public course catalogue

All endpoints are unauthenticated and return published data only.

## GET /api/courses/published

Returns published course cards.

| Query | Type | Default | Notes |
| --- | --- | --- | --- |
| `q` | string | none | Search title, description and subject |
| `type` | string | none | `live` or `video` |
| `limit` | integer | 12 | Max 50 |

Response:

```json
{ "success": true, "courses": [ { "id": "...", "slug": "...", "title": "...", "type": "video", "price": "Free" } ], "count": 1 }
```

Card fields include `cat`, `emoji`, `grad`, `subject`, `img`, `dur`, `rating`,
`ratingNum`, `rev`, `students`, `level`, `price`, `priceNum` and `syllabus`.

## GET /api/courses/{idOrSlug}/full

Returns the published course detail: modules/lessons, schedule, reviews,
teachers, battles, leaderboard and revisions. `404` if the course is not
published or does not exist.

## GET /api/live-sessions

Returns live, scheduled and recorded sessions.

| Query | Type | Default |
| --- | --- | --- |
| `limit` | integer | 10, max 50 |

Fields include `id`, `status`, `platform`, `subject`, `course`, `teacher`,
`teacherEmoji`, `date`, `time`, `desc`, `enrolled` and `present`.

## GET /api/instructors/featured

Returns active instructors with published-course stats.

| Query | Type | Default |
| --- | --- | --- |
| `limit` | integer | 8, max 50 |

Fields include `id`, `emoji`, `bg`, `name`, `subject`, `score`, `rev` and `bio`.

## Rules

- Never expose draft lessons, videos or private fields.
- Do not treat a course id as proof of publication; use the catalogue.
- Dates/timezones in live sessions are display strings; do not parse them as
  canonical timestamps.

## Related

- [Courses overview](../../01-features/courses/overview.md)
- [Course model](../../05-data-models/course.md)
- [OpenAPI](../openapi.yaml)
