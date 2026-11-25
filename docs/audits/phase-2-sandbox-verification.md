# Phase 2 Sandbox Verification

| Field | Value |
| --- | --- |
| Date | 2026-11-25 |
| Environment | `https://sandbox.akoro.ng` |
| Build | `8083074ae47b10348f19e64448f5869f9abfa404` |
| Sandbox state | Live; database and Redis healthy |
| Mutations | One paste record, created and deleted |

---

## Read/auth surface

All checks returned 200:

- published courses
- course detail
- live sessions
- featured instructors
- programme catalogue
- programme detail
- programme course
- PharmD programme
- PharmD course
- featured blog post
- blog categories
- blog list
- blog post
- career departments
- career jobs
- login
- refresh
- records list
- records upload URL (no PUT)

`career jobs` was empty on sandbox, so the individual job-detail operation
could not be exercised there.

## Write path

The disposable write smoke:

1. Signed in as the sandbox demo learner.
2. Created a paste record: `docs-smoke-<timestamp>`.
3. Polled extraction.
4. Asked "What produces ATP in the cell?".
5. Received an answer with **1 citation**.
6. Deleted the record.
7. Verified the record was no longer listed.

**Cleanup verified. No test data left.**

## Re-run attempt at 18:34 UTC — blocked by an edge challenge, then hibernation rate limit

The sandbox could not be reached by any client available in this environment.
No request created a record, course, video, user, subscriber or application, so
no cleanup was required.

| Probe | Result |
| --- | --- |
| `GET https://sandbox.akoro.ng/health` | `429` |
| `POST https://sandbox.akoro.ng/api/auth/login` (empty body) | `429` |
| Node `fetch` with a desktop browser User-Agent | `429` |
| Headless Chromium (Playwright) | `429` |
| Headed Chromium under Xvfb, TLS verification disabled | `429` |

Response headers on the `429`:

```text
Cf-Mitigated: challenge
Cf-Cache-Status: DYNAMIC
Server: cloudflare
Content-Type: text/html; charset=UTF-8
```

There was **no** `X-Render-Routing: hibernate-rate-limited` header on those
initial probes, so the first responses were a Cloudflare edge
challenge/rate-limit response, not the Render hibernation limiter. The rendered
page read "Too Many Requests"; the HTML for non-browser clients was the
"Just a moment..." interstitial. The challenge never issued a `cf_clearance`
cookie, and the challenge frame did not render an interactive Turnstile widget
(the document was 169 bytes), so waiting 60 seconds in the browser did not clear
it.

A single cool-down retry at **18:41 UTC** returned the same `429` but now with
the specific hibernation limiter:

```text
HTTP/1.1 429 Too Many Requests
Content-Type: text/plain; charset=utf-8
X-Render-Routing: hibernate-rate-limited
Cf-Cache-Status: DYNAMIC
Server: cloudflare
```

Body: `Too Many Requests`. Per the run rules, the sandbox was not polled again
after seeing `hibernate-rate-limited`.

The verification gate's alternate sandbox route is also down. On the same day,
`GET https://api.akoro.ng/api/verify/scenarios` (production gate, build
`8083074a`) reported:

```json
{"enabled":true,"url":"https://akoro-sandbox.onrender.com","reachable":false,
 "sha":null,"problem":"The sandbox gate answered 503 — it is down or restarting."}
```

Production itself answered `200` on `/health` at the same build, but this task
deliberately does not run write probes against production.

### Prepared scripts (dry-run clean, not executed against sandbox)

| Script | Scope | Status |
| --- | --- | --- |
| `akoro-documentation/scripts/sandbox-course-video-smoke.mjs` | Course create → 2s MP4 → `upload-url` → PUT → `upload-complete` → status poll (8 min cap) → watch URL → delete video + course → verify | Not executed; edge blocked |
| `akoro-documentation/scripts/sandbox-auth-smoke.mjs` | Admin-created disposable user, local TOTP setup/enable/login/disable, registration probe, forgot/reset validation, verified user deletion | Not executed; edge blocked |
| `akoro-documentation/scripts/sandbox-content-validation.mjs` | Blog subscribe / job apply validation-only, admin list read-back, no writes | Not executed; edge blocked |

The TOTP helper in the auth script was checked locally against
`akoro-api/modules/auth/totp.js` for five random secrets; the generated codes
verified. That is a helper check, not an API verification.

### Endpoint facts recorded from source review (not runtime-verified)

- Admin user cleanup is real: `POST /api/admin/users/create` and
  `DELETE /api/admin/users/:id` exist, and `GET /api/admin/users/:id` lets the
  script assert a `404` after deletion.
- `blog_subscribers` and `job_applications` expose admin **read** routes
  (`GET /api/content/admin/blog/subscribers`,
  `GET /api/content/admin/careers/applications`) but no delete route. Successful
  subscribe/apply writes therefore have no cleanup path from the public/admin
  API, which is why the content script is validation-only.
- Content validation helpers return `400`, not `422`; auth express-validator
  failures return `422`.

## Validation-only

- `POST /api/contact` with an empty body: `422`, no write.
- `POST /api/public/pilot-applications` with an empty body: `422`, no write.

## Still not exercised

The 18:34 UTC attempt did not reach the API, so every item below remains
unexercised in this round, including the three prepared scripts:

- Registration and email verification.
- Login challenge/resend code.
- 2FA login/setup.
- Forgot/reset password.
- Blog subscription.
- Job application.
- Full course-video upload/encode/delete.
- Extraction status completion semantics (the earlier write smoke did not
  observe a confirmed `done`, but the subsequent ask succeeded).

## Notes

- The sandbox health endpoint reports `"env":"production"` while serving the
  isolated sandbox database; treat it as the sandbox environment.
- The script used for the record path:
  `akoro-documentation/scripts/sandbox-write-smoke.mjs`.
- All four scripts refuse to run outside `sandbox.akoro.ng` and require
  `--confirm`; a no-flag run is a dry run with no HTTP requests.
