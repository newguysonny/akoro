# Phase 2 Public API Verification

| Field | Value |
| --- | --- |
| Date | 2026-11-25 |
| Target | Newly documented Tier-1 public GET operations |
| Environment | Production `https://api.akoro.ng` |
| Mutations | None |

---

## Results

All checks were unauthenticated, read-only GETs.

| Operation | Path | Result |
| --- | --- | --- |
| Published courses | `/api/courses/published?limit=2` | 200 `success,courses,count` |
| Published course detail | `/api/courses/{id}/full` | 200 `success,course` |
| Live sessions | `/api/live-sessions?limit=2` | 200 `success,sessions,count` |
| Featured instructors | `/api/instructors/featured?limit=2` | 200 `success,instructors,count` |
| Programme catalogue | `/api/programmes/catalogue` | 200 `success,data` |
| Programme detail | `/api/programmes/catalogue/{id}` | 200 `success,data` |
| Programme course | `/api/programmes/catalogue/courses/{id}` | 200 `success,data` |
| PharmD programme | `/api/pharmd/programme` | 200 `success,data` |
| PharmD course | `/api/pharmd/courses/{code}` | 200 `success,data` |
| Featured blog post | `/api/content/blog/posts/featured` | 200 `success,data` |
| Blog categories | `/api/content/blog/categories` | 200 `success,data` |
| Blog list | `/api/content/blog/posts?limit=2` | 200 `success,data,meta` |
| Blog post | `/api/content/blog/posts/{slug}` | 200 `success,data` |
| Career departments | `/api/content/careers/departments` | 200 `success,data` |
| Career jobs | `/api/content/careers/jobs` | 200 `success,data` |
| Career job | `/api/content/careers/jobs/{id}` | 200 `success,data` |

## Still untested

- Sandbox: still pending; the hibernation limiter blocked earlier requests.
- Write paths: register/verify, upload completion, record creation, ask, contact,
  pilot, blog subscribe, job apply, course upload.
- Auth challenge flows beyond demo login.
- Webhook signature flows.

## Notes

- `programmes/catalogue/{id}` and `courses/{id}` returned data with nested
  sections/courses that should be expanded in the OpenAPI schemas during the
  next pass.
- Blog/careers response shapes matched the document-level expectations.
- No test data was created.
