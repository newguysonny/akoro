# Section 15 verification record — 2026-11-26

Evidence for the Platform Documentation System Plan §15 (self-validating
documentation), gathered on the sandbox (`https://sandbox.akoro.ng`, build
`13dbcb1b`) and in CI configuration on 2026-11-26. Each check in the plan's
table is listed with its mechanism and its current evidence.

| Check | Mechanism | Evidence (2026-11-26) | State |
| --- | --- | --- | --- |
| OpenAPI validation | `validate-docs.mjs` parses `02-api/openapi.yaml` and resolves all `$ref`s | Passes (35 paths) | Verified |
| Endpoint verification | Runtime route table vs OpenAPI (`akoro-api/scripts/export-routes.mjs` + `route-coverage.mjs --check` in CI) | 36/36 documented operations present in the runtime table, 0 missing (`docs/audits/phase-2-route-coverage.md`) | Verified |
| Schema verification | OpenAPI request/response schemas are the contract the route-coverage job and the public reference generation consume | Public OpenAPI copy byte-identical to the internal source (public-docs validator) | Verified |
| Example verification | Sandbox smoke suites in `akoro-documentation/scripts/` | Write path PASS; content validation PASS (success paths blocked by design — no delete endpoint); auth 14 PASS / 0 FAIL / 2 blocked-by-design (see below); course video BLOCKED (see below) | Partial — see open items |
| Link verification | `validate-docs.mjs` resolves every local Markdown link; public-docs validator resolves public links | Both pass (174 internal documents, 72 public routes) | Verified |
| Workflow verification | The five documented workflows in `13-examples/workflows/` executed on the sandbox | records-upload-and-ask PASS (write smoke); auth-sign-in PASS (auth smoke); agent-capability PASS (verify run `7b145bcf`, 2026-11-25); study-prep PASS (dedicated smoke: create 201 → read → cancel, 2026-11-26); course-video-publish BLOCKED (encoding, below) | 4 of 5 verified |
| Permission verification | `sandbox-permissions-smoke.mjs` (new) | All probes pass under the confirmed model: unauthenticated 401, learner→admin 403, cross-learner preview 404, file 403, list isolation, and cross-learner ask grounded 200 (free owner = public by design; see open item 2) | Verified (Premium-owner branch unprobed) |
| Capability verification | `capability-registry.yaml` statuses vs sandbox evidence | Agent chat, battles, agent network and study prep upgraded to `sandbox-verified`; remainder stay `code-observed` until evidenced | Ongoing |
| Index verification | `validate-docs.mjs` checks `documentation-index.json` paths and IDs | Passes | Verified |
| Status verification | Registry rule: `implemented` requires production evidence | Enforced by the validator's status/verification vocabularies | Verified |
| Secret scanning | `validate-secrets.mjs` over both documentation trees | Clean on 208 files; proven against seeded fakes (6 findings, correct file:line). CI wiring is in the pending `docs.yml` update | Verified (CI step pending upload) |

## Open items

1. **Course-video encoding has no consumer on the sandbox.** Upload works
   (HTTP 202, `encodingStatus: queued`) but nothing processes the queue:
   `MEDIA_WORKER_URL` is not set on the sandbox API service, so jobs land in
   the legacy BullMQ `video-encoding` queue whose only consumer is the
   standalone `akoro-api/worker.js` (a VPS process), and no such process runs
   against the sandbox — confirmed by `/health` (`redisQuota.workers` lists
   no video worker). Operator fix, either: set `MEDIA_WORKER_URL` on the
   sandbox API service (Render) so the in-API fan-out coordinator drives the
   Cloudflare media worker, or run `worker.js` against the sandbox
   environment. Until then the course-video-publish workflow cannot be
   verified end to end on the sandbox.
2. **Cross-learner record ask — model confirmed, docs amended.** The
   permission model (confirmed by Matt, 2026-11-26) is: **uploads are public
   for free users and private for Premium subscribers.** The code implements
   exactly this (`modules/records/access.js`: a record is cross-askable only
   when it is not private and its owner holds no active Premium entitlement;
   a Premium subscriber's uploads never leave their library). The smoke's
   original refusal expectation was written against the older documented
   model; the endpoint documentation and the smoke now state the confirmed
   model (free→free ask expects a grounded 200; the Premium-owner 404 branch
   is documented but unprobed — no Premium demo account exists). One part of
   the model was **not yet built** at the time of the pass: a Premium
   subscriber's choice to set a record public. **Built later the same day**
   (Matt's go-ahead; commit `18e307a7`): `records.discoverable` (migration
   `2026-record-discoverable.sql`) honoured by the access rule, the ask and
   content paths, the Discover feed, platform search and study-material
   gather/copy; the owner sets it via `PATCH /api/records/:id`. Live proof
   on sandbox build `18e307a7` (`sandbox-premium-sharing-smoke.mjs`): the
   choice surface passes all checks — default false, non-boolean 400,
   non-owner 403, owner round-trip, free visibility unchanged.
   **Addendum (same day): the Premium-gated transitions are now
   live-probed — and the probe exposed a real privacy bug.** A Premium
   tester was seeded on the sandbox exactly as a real checkout writes
   (a `customers` row + a subscription keyed by `learner_user_id`), yet
   `activePremiumUserIds` still matched nobody, for two stacked reasons:
   the helper ran its tiers/subscriptions queries through the `edu`
   schema client while billing writes both tables in the **public**
   schema, and it selected `user_id`, a column checkout fulfillment
   never populates. The Premium privacy rule had therefore never fired
   for any real subscriber — Premium uploads were public like free
   users'. Fixed in `8b718410` (column) and `41ba9a18` (schema; the
   helper now uses the default public client). With the fixes live,
   `sandbox-premium-sharing-smoke.mjs` passes all 9 checks: the owner's
   plan reads Premium; an unshared Premium record refuses another
   learner's ask (404) and stays out of Discover; sharing opens both
   (200, in feed); unsharing restores the gate; free visibility is
   unchanged throughout. Production already runs `41ba9a18`, so the
   privacy rule is in force there too. The behavioural tests remain in
   `discoverable.contract.test.mjs` (14/14, stub now mirrors the real
   subscription row shape).
3. **Two auth probes are blocked by design.** The 2FA login challenge and
   the password-reset success path both require reading an emailed code.
   Demo-domain accounts (`@demo.akoro.app`) bypass the email code — and the
   same bypass skips the 2FA gate — while non-demo accounts stop at the
   unreadable code. Exercising either probe needs a sandbox mail trap or a
   readable test mailbox (operator provisioning).

## Method note

All runs were sandbox-only, used demo accounts, and cleaned up after
themselves (created users, records, courses, videos and sessions were
deleted or cancelled and verified gone; zero residue).
