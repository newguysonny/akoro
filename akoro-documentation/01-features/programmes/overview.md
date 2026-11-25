---
title: Programmes overview
status: implemented
doc_status: overview
tier: 1
audience: [developer, learner, admin, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Programmes overview

A programme is a structured collection of courses, sections and materials, such
as a degree or diploma programme. The published catalogue is public; programme
management is admin-only.

## Public catalogue

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/programmes/catalogue` | Published programmes with published course counts |
| GET | `/api/programmes/catalogue/:id` | One published programme with sections and published courses |
| GET | `/api/programmes/catalogue/courses/:id` | One published course with published materials |

The catalogue filters at every level. Draft programmes, draft courses and draft
materials never appear.

## Admin surface

The remaining programme endpoints are admin-only and cover:

- programme CRUD and publish/unpublish;
- sections and ordering;
- courses and course movement;
- materials and ordering;
- the programme activity log.

These endpoints are Tier 3 and must not be published as public API.

## Data

Core entities: `edu.programmes`, `edu.programme_sections`,
`edu.programme_courses`, `edu.programme_materials` and
`edu.programme_log`.

## Capabilities

- `programmes.list_catalogue`

## Related

- [Courses and media](../courses/overview.md)
- [PharmD](../pharmd/overview.md)
- [OpenAPI](../../02-api/openapi.yaml)
