---
title: Programme model
status: implemented
doc_status: draft
tier: 1
audience: [developer, learner, admin, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Programme model

## What it represents

A programme is a collection of sections, courses and materials, such as a
degree or diploma programme. Published programmes are public.

## Identifiers

- `edu.programmes.id` — UUID.
- `edu.programme_courses.id`, `edu.programme_materials.id` — UUIDs.

## Important fields

`edu.programmes`: `id`, `name`, `code`, `description`, `duration_label`,
`cover_url`, `source`, `source_programme_id`, `status` (`draft|published`).

`edu.programme_sections`: `id`, `programme_id`, `name`, `position`.

`edu.programme_courses`: `id`, `programme_id`, `section_id`, `code`, `title`,
`instructor`, `color`, `status`, `position`, `source_course_id`.

`edu.programme_materials`: `id`, `course_id`, `title`, `type`, `meta`, `url`,
`thumb_url`, `status`, `position`, `source_topic_id`.

## Relationships

```text
programme -> sections -> programme_courses -> programme_materials
programme -> source (pharmd or internal)
```

## Access

- Public: published programmes, published courses and published materials only.
- Admin: all programme management.
- Draft content never leaves the public catalogue.

## Lifecycle

- Draft -> published.
- Ordering is controlled by `position`.
- Unpublishing removes content from the public catalogue.

## Agent guidance

- Do not assume a course/material is published because its parent is.
- Use the catalogue endpoints, not admin tables, for public discovery.
- Preserve section/course/material ordering when editing.

## Related

- [Programmes overview](../01-features/programmes/overview.md)
- [Course model](course.md)
