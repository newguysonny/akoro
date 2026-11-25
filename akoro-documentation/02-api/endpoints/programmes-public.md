---
title: Public programme catalogue
status: implemented
doc_status: overview
tier: 1
audience: [developer, learner, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: programmes.list_catalogue
---

# Public programme catalogue

Only published programmes, published courses and published materials leave
these endpoints.

## GET /api/programmes/catalogue

Returns published programmes with the count of published courses.

Fields: `id`, `name`, `code`, `description`, `duration_label`, `cover_url`,
`source`, `course_count`.

## GET /api/programmes/catalogue/{id}

Returns one published programme with its sections and published courses.

Fields include `published_courses` and `sections[]` with `id`, `name`,
`position` and `courses[]` (`id`, `section_id`, `code`, `title`, `instructor`,
`color`, `cover_url`, `materials_count`).

`404` if the programme is not published.

## GET /api/programmes/catalogue/courses/{id}

Returns one published programme course with its programme, section and
published materials.

Each material includes `id`, `title`, `type`, `meta`, `url`, `thumb_url`,
`position`, `mime`, `file_url` and `contentKey` where a file exists.

`404` if the course or its programme is not published.

## Rules

- Use these endpoints for public discovery, not the admin programme APIs.
- Draft sections, courses and materials must remain invisible.
- `file_url` may be used for reader playback/reading; external URLs remain in
  `url`.

## Related

- [Programmes overview](../../01-features/programmes/overview.md)
- [Programme model](../../05-data-models/programme.md)
- [OpenAPI](../openapi.yaml)
