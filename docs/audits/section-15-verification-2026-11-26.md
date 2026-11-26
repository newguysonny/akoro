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
| Permission verification | `sandbox-permissions-smoke.mjs` (new) | 6 of 7 PASS: unauthenticated 401, learner→admin 403, cross-learner preview 404, file 403, list isolation. 1 FAIL: cross-learner ask (below) | Partial — 1 finding |
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
2. **Cross-learner record ask (permission finding).** Any learner can ask
   grounded questions against any other learner's non-private records and
   receives answers citing their content. In code this is the deliberate
   Discover rule (`modules/records/access.js`), but no API path can mark a
   record private (`createRecord` never sets the flag; PATCH does not allow
   it), so in practice all library content is cross-askable — which
   contradicts the documented model ("the learner's own record",
   `modules/records/service-ask.js`). Decision needed: default records to
   private, add a privacy control, or amend the documented permission model.
   The permissions smoke keeps the refusal expectation as its gate.
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
