# Phase 2 OpenAPI Coverage

| Field | Value |
| --- | --- |
| Date | 2026-11-25 |
| Contract | `akoro-documentation/02-api/openapi.yaml` |
| Paths | 34 |
| Operations | 35 |
| Production-verified | 20 |
| Validation-only | 2 |
| Not yet exercised | 13 |

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
| `createRecord` | Requires a small upload + cleanup |
| `getExtractionStatus` | Requires a disposable record |
| `askRecord` | Creates ask history; needs cleanup |
| `subscribeToBlog` | Writes subscriber; needs cleanup |
| `applyToCareerJob` | Writes application; needs cleanup |

## Next

1. Add disposable test fixtures and cleanup endpoints/scripts.
2. Run the write matrix on sandbox when the hibernation limiter clears.
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
