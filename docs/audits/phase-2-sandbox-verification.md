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

## Validation-only

- `POST /api/contact` with an empty body: `422`, no write.
- `POST /api/public/pilot-applications` with an empty body: `422`, no write.

## Still not exercised

- Registration and email verification.
- Login challenge/resend code.
- 2FA login/setup.
- Forgot/reset password.
- Blog subscription.
- Job application.
- Full course-video upload/encode/delete.
- Extraction status completion semantics (the write smoke did not observe a
  confirmed `done`, but the subsequent ask succeeded).

## Notes

- The sandbox health endpoint reports `"env":"production"` while serving the
  isolated sandbox database; treat it as the sandbox environment.
- The script used: `akoro-documentation/scripts/sandbox-write-smoke.mjs`.
- The script refuses to run outside `sandbox.akoro.ng`.
