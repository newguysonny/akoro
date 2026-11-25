# Phase 1 Capability Verification

| Field | Value |
| --- | --- |
| Date | 2026-11-25 |
| Target | Seeded Tier-1 capabilities in `akoro-documentation/capability-registry.yaml` |
| Sandbox result | Blocked by platform hibernation rate limit |
| Production result | Non-destructive smoke passed |

---

## 1. Sandbox

Requested:

```text
GET https://sandbox.akoro.ng/api/courses/published?limit=2
```

Result: `429 Too Many Requests`

Response headers included:

```text
X-Render-Routing: hibernate-rate-limited
Cf-Cache-Status: DYNAMIC
Server: cloudflare
```

A single retry after 45 seconds returned the same `429` and the same
`hibernate-rate-limited` routing header. The sandbox was not polled further to
avoid deepening the limiter.

**Conclusion:** sandbox verification is pending. Wait for the hibernation
limiter to clear, or use the verification-gate run pinned to the target SHA.

## 2. Production smoke

Non-destructive checks against `https://api.akoro.ng` using the demo learner
account. No records were created, no files were uploaded, and no contact or
pilot applications were written.

| Capability | Check | Result |
| --- | --- | --- |
| `courses.list_published` | `GET /api/courses/published?limit=2` | 200, `success,courses,count` |
| `programmes.list_catalogue` | `GET /api/programmes/catalogue` | 200, `success,data` |
| `pharmd.get_programme` | `GET /api/pharmd/programme` | 200, `success,data` |
| `content.list_blog_posts` | `GET /api/content/blog/posts?limit=2` | 200, `success,data,meta` |
| `auth.login` | demo learner sign-in | 200, `success,data` |
| `auth.refresh` | refresh using the login cookies | 200, `success,data` |
| `records.list` | `GET /api/records` with session | 200, `success,data` |
| `records.request_upload` | `POST /api/records/upload-url` for a 1 KB PDF; no PUT | 200, `success,data` |
| `courses.get_published` | `GET /api/courses/{id}/full` using a returned course id | 200, `success,course` |
| `contact.submit` | Invalid empty body only | 422 validation; no write |
| `pilot.apply` | Invalid empty body only | 422 validation; no write |
| `records.ask` | Not tested | Unchanged; write side effect avoided |

## 3. Registry updates

Marked `production-verified` on 2026-11-25:

- `auth.login`
- `auth.refresh`
- `records.list`
- `records.request_upload`
- `courses.list_published`
- `courses.get_published`
- `programmes.list_catalogue`
- `pharmd.get_programme`
- `content.list_blog_posts`

Still `code-observed`:

- `records.ask` — needs a controlled test record and a cleanup path.
- `contact.submit` — only validation was tested; no message was written.
- `pilot.apply` — only validation was tested; no application was written.

## 4. Remaining verification work

1. Retry on sandbox after the hibernation limiter clears, pinned to the target
   build SHA.
2. Run the full `auth.login` → `records.list` → `records.ask` flow with a
   disposable record and delete it afterwards.
3. Verify `contact.submit` and `pilot.apply` success with test data that is
   removed after the check.
4. Add these checks to documentation CI or the verification gate.
5. Compare live responses with `02-api/openapi.yaml` and update schemas where
   the smoke exposed differences.
