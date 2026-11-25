# Phase 2 OpenAPI Coverage

| Field | Value |
| --- | --- |
| Date | 2026-11-25 |
| Contract | `akoro-documentation/02-api/openapi.yaml` |
| Paths | 34 |
| Operations | 35 |
| Production-verified | 23 |
| Sandbox-verified | 21 (overlaps production) |
| Validation-only | 2 |
| Not fully exercised | 8 |
| Runtime routes / OpenAPI coverage | 1,270 routes / 35 of 35 documented |

The runtime route comparison is generated in
`docs/audits/phase-2-route-coverage.md` by the boot-safe extractor.

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
| `register` | 201 verification-required; disposable user cleaned by migration |
| `forgotPassword` | 200 generic response |
| `getExtractionStatus` | 200 on an existing demo learner record |

## Sandbox verification

On 2026-11-25 at build `8083074a`, 19 read/auth operations returned 200, and
the records write path created a paste record, received a cited answer, deleted
the record, and verified cleanup.

Later sandbox attempts to run course-video, auth/2FA and content writes were
blocked at the edge by Cloudflare `429` and Render
`hibernate-rate-limited`. No writes were attempted in that round.

## Validation-only

| Operation | Result | Why |
| --- | --- | --- |
| `submitContact` | 422 on empty body | Avoid writing test messages |
| `submitPilotApplication` | 422 on empty body | Avoid writing test applications |

## Not fully exercised

| Operation | Missing test |
| --- | --- |
| `verifyEmail` | Requires a real emailed code |
| `verifyLogin` | Requires a login challenge |
| `resendCode` | Requires a live challenge |
| `twoFactorLogin` | Requires a non-demo 2FA-enabled account |
| `twoFactorSetup` | Requires an eligible session or setup token |
| `resetPassword` | Requires a reset code or token |
| `subscribeToBlog` | Writes a subscriber; no delete route |
| `applyToCareerJob` | Writes an application; no delete route |

The sandbox test scripts for these paths are prepared in
`akoro-documentation/scripts/` but were not executable while the edge challenge
was active.

## Next

1. Run the remaining write tests when the sandbox is reachable: course video,
   auth challenge/2FA/password-reset flows.
2. For blog subscription and job application, either add a cleanup route or
   keep success verification limited to an isolated sandbox database.
3. Add response-schema assertions to the verification gate.
4. Document or explicitly exclude the 11 public route candidates that are
   outside the current Tier-1 OpenAPI surface.
