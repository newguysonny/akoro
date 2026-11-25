# Phase 2 OpenAPI Coverage

| Field | Value |
| --- | --- |
| Date | 2026-11-25 |
| Contract | `akoro-documentation/02-api/openapi.yaml` |
| Paths | 34 |
| Operations | 35 |
| Production-verified | 20 |
| Sandbox-verified | 21 (19 read/auth + 2 record writes) |
| Validation-only | 2 |
| Not fully exercised | 11 |

This is a manual verification matrix, not yet a runtime route-coverage test. It
must be replaced by the runtime Express route comparison in Phase 3.

## Verified on production

| Operation | Verification |
| --- | --- |
| `login` | Demo learner sign-in, 200 |
| `refreshSession` | Cookie refresh, 200 |
| `listRecords` | Authenticated list, 200 |
| `requestRecordUploadUrl` | Presigned URL, 200, no PUT |
| `listPublishedCourses` | 200 |
| `listLiveSessions` | 200 |
| `listFeaturedInstructors` | 200 |
| `getPublishedCourse` | 200 |
| `listPublishedProgrammes` | 200 |
| `getPublishedProgramme` | 200 |
| `getPublishedProgrammeCourse` | 200 |
| `getPharmdProgramme` | 200 |
| `getPharmdCourse` | 200 |
| `listBlogPosts` | 200 |
| `getFeaturedBlogPost` | 200 |
| `listBlogCategories` | 200 |
| `getBlogPost` | 200 |
| `listCareerDepartments` | 200 |
| `listCareerJobs` | 200 |
| `getCareerJob` | 200 |

## Validation-only

| Operation | Result | Why |
| --- | --- | --- |
| `submitContact` | 422 on empty body | Avoid writing test messages |
| `submitPilotApplication` | 422 on empty body | Avoid writing test applications |

## Not yet exercised

| Operation | Missing test |
| --- | --- |
| `register` | Disposable account + cleanup |
| `verifyEmail` | Requires a real emailed code |
| `verifyLogin` | Requires a login challenge |
| `resendCode` | Requires a live challenge |
| `twoFactorLogin` | Requires a 2FA-enabled test account |
| `twoFactorSetup` | Requires an eligible session/setup token |
| `forgotPassword` | Would send email; needs disposable account |
| `resetPassword` | Requires a reset code/token |
| `getExtractionStatus` | Polled on sandbox, but `done` was not observed; ask succeeded |
| `subscribeToBlog` | Writes subscriber; needs cleanup |
| `applyToCareerJob` | Writes application; needs cleanup |

## Next

1. Run the remaining write tests with cleanup: course video, blog subscription,
   job application, and auth challenge/2FA/password-reset flows.
2. Run `getCareerJob` on sandbox when a job exists.
3. Replace this matrix with runtime route-table coverage.
4. Add response-schema assertions to the verification gate.

## Runtime route coverage status

A true `app._router.stack` extractor is not run in this phase. `akoro-api/app.js`
performs top-level migrations, context preflight and `httpServer.listen`, so
importing it in a docs script would boot the service instead of only reading its
route table.

The current substitute is:

- the Phase 0 static route inventory (`docs/audits/phase-0/route-inventory.csv`);
- the explicit Tier-1 public allow-list (`public-route-candidates.csv`);
- real HTTP smoke against production for read operations;
- the manual 35-operation matrix above.

Phase 3 should add a boot-safe route extractor (for example, a separate router
module that does not run migrations or listen) and compare it with OpenAPI in CI.

## Sandbox follow-up

On 2026-11-25 the sandbox came back at build
`8083074ae47b10348f19e64448f5869f9abfa404`. The disposable write smoke created a
paste record, received a cited answer, deleted the record, and verified cleanup.
See `docs/audits/phase-2-sandbox-verification.md`.
