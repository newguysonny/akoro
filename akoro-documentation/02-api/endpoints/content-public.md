---
title: Public blog and careers
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: content.list_blog_posts
---

# Public blog and careers

All endpoints are unauthenticated. Reads return published/open content only.

## Blog

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/content/blog/posts` | Published cards; `category`, `search`, `limit`, `offset` |
| GET | `/api/content/blog/posts/featured` | Featured published post |
| GET | `/api/content/blog/categories` | Categories with counts |
| GET | `/api/content/blog/posts/{slug}` | Full post + up to two related posts |
| POST | `/api/content/blog/subscribe` | Newsletter email + optional `source` |

Blog card fields: `id`, `slug`, `title`, `excerpt`, `category`, `image`,
`author`, `author_role`, `read_min`, `featured`, `published_at`.

## Careers

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/content/careers/departments` | Departments |
| GET | `/api/content/careers/jobs` | Open jobs grouped by department; optional `dept` |
| GET | `/api/content/careers/jobs/{id}` | Open job detail |
| POST | `/api/content/careers/jobs/{id}/apply` | Application: `name`, `email`, and optional `phone`, `linkedin`, `portfolio`, `message` |

## Errors

- `404` — post/job not found or no longer open.
- `422` — invalid email/name or other validation failure.
- `201` — subscription/application created.

## Rules

- Do not submit real personal data in examples.
- Subscriptions are idempotent by email.
- Job applications are not idempotent; do not retry blindly after a timeout.
- Only open jobs accept applications.

## Related

- [Public content overview](../../01-features/content/overview.md)
- [OpenAPI](../openapi.yaml)
