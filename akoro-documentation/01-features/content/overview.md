---
title: Public content overview
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Public content overview

The content module backs the public blog and careers pages. Reads and intake are
public; content management is admin-only.

## Public endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/content/blog/posts` | Published blog cards; optional `category`, `search`, `limit`, `offset` |
| GET | `/api/content/blog/posts/featured` | Featured published post |
| GET | `/api/content/blog/categories` | Categories with counts |
| GET | `/api/content/blog/posts/:slug` | Full published post and related posts |
| POST | `/api/content/blog/subscribe` | Newsletter subscription |
| GET | `/api/content/careers/departments` | Job departments |
| GET | `/api/content/careers/jobs` | Open jobs |
| GET | `/api/content/careers/jobs/:id` | Job detail |
| POST | `/api/content/careers/jobs/:id/apply` | Job application |

## Admin surface

Admin-only endpoints create blog posts, upload images, manage subscribers,
departments, jobs and applications. They are Tier 3 and must not appear in the
public API reference.

## Data

Core entities: `content.blog_posts`, `content.blog_chunks`,
`content.blog_subscribers`, `content.jobs`, `content.job_departments`,
`content.job_applications`.

## Capabilities

- `content.list_blog_posts`

## Related

- [OpenAPI](../../02-api/openapi.yaml)
- [Errors](../../02-api/errors.md)
