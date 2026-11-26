# Security Review — Public Documentation Surface

| Field | Value |
| --- | --- |
| Status | Review complete — **not** a sign-off (see §8) |
| Date | 2026-11-26 |
| Scope | `akoro-docs/content/` (the Fumadocs source published as docs.akoro.ng), plus `akoro-docs/openapi/akoro.yaml` and `akoro-docs/public/llms.txt` |
| Branch reviewed | `kilo/modular-storm-thz` |
| Parent plan | `docs/PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md` (§17, §20: "Security has reviewed permissions, data and public content") |
| Method | Full-tree download of the public source; secret-pattern scans; page-by-page read of the start / build / apps / learn / operate / reference sections; comparison against `akoro-documentation/02-api/authentication.md` and `authorization.md`; `akoro-docs/scripts/validate-public-docs.mjs` run |

---

## 1. Purpose

The platform plan's acceptance criteria require that security has reviewed the
public documentation surface before it is treated as done. This review checks
the public docs against the site's own allow-list rule — stated on
`docs/index.mdx`, `build/api-overview.mdx` and the changelog: the public
surface covers auth, the published catalogue, blog/careers, contact and pilot
intake, plus authenticated Library/course access; admin, school ERP,
agent-internal and verification routes are **not** public.

This is a documentation review only. No public content was changed, and no
runtime behaviour was tested.

## 2. Summary

| Severity | Count |
| --- | --- |
| High | 1 |
| Medium | 4 |
| Low | 6 |
| Info | 3 |

No secret values, credentials, tokens or connection strings were found
anywhere in the public tree (§5). The material risk is not leaked secrets; it
is **allow-list drift**: the Learn and Operate sections — written from module
code in the same style as the internal knowledge base — publish route maps and
internal mechanics for surfaces the allow-list excludes. The most actionable
context is timing: at the last live check the Learn section was not yet in the
deployed docs.akoro.ng build, so most findings can be corrected in source
before the pending redeploy publishes them.

## 3. Findings

| # | Severity | File | Finding |
| --- | --- | --- | --- |
| F1 | **High** | `akoro-docs/content/docs/learn/agent-network.mdx` | Full route map and internal mechanics of a non-allow-listed surface (detail §3.1) |
| F2 | Medium | `akoro-docs/content/docs/learn/agent-chat.mdx` | Agent-console mechanism and agent-runtime internals published |
| F3 | Medium | `akoro-docs/content/docs/learn/battles.mdx`, `learn/teaching-sessions.mdx` | Full route maps of non-Tier-1 authenticated surfaces, incl. worker internals |
| F4 | Medium | `akoro-docs/content/docs/learn/practice.mdx` | Proctoring integrity thresholds published (flag ≥ 0.4, terminate ≥ 0.85) |
| F5 | Medium | `akoro-docs/content/docs/start/versioning.mdx` | Undecided versioning/deprecation policy published as "agreed" |
| F6 | Low | `akoro-docs/content/docs/operate/observability.mdx`; `learn/battles.mdx` | Internal diagnostic / module health endpoint paths published |
| F7 | Low | `akoro-docs/content/docs/apps/school.mdx` | Internal scale figures disclosed (route and table counts) |
| F8 | Low | `akoro-docs/content/docs/apps/admin.mdx`; `operate/architecture.mdx` | Internal capability areas enumerated (AI spend, model routing, evaluations, verification gate, prompt configuration) |
| F9 | Low | `akoro-docs/content/docs/build/library.mdx`; `build/uploads.mdx` | Storage implementation detail disclosed (Supabase fallback path and cap) |
| F10 | Low | `akoro-docs/content/docs/learn/study-prep.mdx`; `learn/exam-prep.mdx` | Internal feature-flag names published (`AKORO_STUDY_PREP_ENABLED`, `AKORO_EXAM_PREP_CONFIDENCE_ENABLED`) |
| F11 | Low | `akoro-docs/content/docs/build/media.mdx`; `build/webhooks.mdx` | Non-Tier-1 endpoint paths published (instructor `/api/stream/*` flow; Paystack webhook endpoints incl. legacy verify and payouts webhook) |
| F12 | Info | `akoro-docs/content/docs/learn/payments.mdx` | Pricing-endpoint / platform-markup existence mentioned (no figures) |
| F13 | Info | `akoro-docs/content/docs/start/authentication.mdx`; `operate/security.mdx` | Cookie names and full portal value list (incl. `admin`, `agent`) published — client-visible by design |
| F14 | Info | `akoro-docs/content/docs/changelog.mdx`; `content/changelog.json` | Changelog content is clean and restates the allow-list; status page is an external Instatus link with no internal content |

### 3.1 F1 — Agent network route map (High)

`learn/agent-network.mdx` documents, from the module code, roughly 25 routes
across `/api/agent-network/*` (search, online-count, settings, blocks,
reports, challenges, challenge-requests, messages, inbox, daily battles,
league, buddies, circles) and `/api/adaptive/marketplace/*` (list, listings,
search, checkout, verify, webhook, review, my-agents) plus
`/api/adaptive/ratings`. It also describes internal mechanics: the presence
heartbeat cadence (about once a minute; a two-and-a-half-minute online
window), the protected-learner check and message shaping that keep peer
replies safe, the default agents' names, and that reply ratings are "stored
for evaluation and is never part of a prompt".

The page itself records why it sits outside the allow-list: the surface "is
not yet in the capability registry", the internal feature documentation lists
it as not yet documented, and it is "described here from the module code and
routes, not from a published API contract". The site's own stated public
surface (auth, catalogue, content/intake, Library, course access) does not
include it.

Mitigating factors, recorded for calibration: every route named is an
authenticated learner-app route whose paths are also discoverable from the
shipped client bundle; no credential, secret or personal data appears; the
marketplace webhook is signature-authenticated, as the page states. The
finding is rated High on the allow-list standard — a complete route map plus
anti-abuse mechanics for an undocumented internal surface — not on credential
exposure. Recommended remedy: reduce the page to the product-level overview
(what the network is, privacy choices learners control) and remove the route
tables and machinery paragraphs before the redeploy, or move the page to the
internal knowledge base.

### 3.2 F2 — Agent console and runtime internals (Medium)

`learn/agent-chat.mdx` is a Tier-3 (agent runtime) subject written for the
public site. Its sharpest item: "**Agent console** — with the console key, a
turn runs in dry mode where side-effecting tools are simulated rather than
executed." No key value or usage credential appears, but the page confirms to
any reader that a privileged console credential exists and what it unlocks.
The same page publishes runtime internals that have no integrator audience:
tool-area selection, forced-tool behaviour, kill switches, the reply
scrubbing and claim-checking pipeline, and socket identity-overwrite
behaviour. Recommended remedy: remove the console bullet entirely and cut the
page back to learner-visible behaviour.

### 3.3 F3 — Battles and teaching-session route maps (Medium)

`learn/battles.mdx` lists the main routes of a 43-endpoint module and a
"Worker lifecycle" section naming the BullMQ queue (`battles`, Redis-backed)
and all seven internal job names with their duties, plus settlement field
names (`xp_pool`, `xp_prize`). `learn/teaching-sessions.mdx` tabulates the
`/api/adaptive/teaching/*` and `/api/teaching/workflows` routes, including the
teacher review queue (`GET /api/adaptive/teaching/ladders`,
`PATCH /api/adaptive/teaching/ladders/:id` — approve/reject), an
instructor-side moderation surface. Same class as F1, rated Medium: the
surfaces are core learner product (not an undocumented beta), and the worker
detail is the main excess.

### 3.4 F4 — Proctoring thresholds (Medium)

`learn/practice.mdx` publishes the assessment-integrity decision table
verbatim: `flagged` at cheat probability at or above 0.4, `terminated` at or
above 0.85, and the proctoring frame cadence (roughly every two seconds).
Integrity controls lose value when their thresholds are public; a candidate
who knows the flag line can behave to stay under it. Recommended remedy:
describe verdicts qualitatively ("sessions may be flagged or terminated for
integrity reasons") without numbers.

### 3.5 F5 — Versioning policy overstated (Medium)

`start/versioning.mdx` states: "The recommended policy below is agreed for
the public surface." The internal record disagrees:
`akoro-documentation/11-changes-releases/migrations/api-migrations.md` states
canonical `/api/v1` versioning "is proposed, not implemented, and the
decision is still open". Publishing a 90-day sunset commitment (with `Sunset`
header behaviour) as agreed, before the decision is taken, creates a public
commitment the platform has not made. This is a permissions/governance
accuracy finding, not a leak. Recommended remedy: reword to "proposed" until
the §22 decision is taken, matching the internal register.

### 3.6 Low findings (F6–F11)

- **F6** — `operate/observability.mdx` publishes `GET /api/tasks/health`
  labelled "Internal diagnostic" and notes health endpoints do not require a
  session; `learn/battles.mdx` publishes `GET /api/battle/health` as a
  "public health check". Path disclosure only; what those endpoints return
  was not verified in this review (see §7).
- **F7** — `apps/school.mdx`: "more than 170 API route declarations and 128
  management tables" — internal scale figures with no public-docs purpose.
- **F8** — `apps/admin.mdx` and `operate/architecture.mdx` enumerate internal
  capability areas (AI operations: model routing, spend, evaluations;
  "Agent capabilities and prompts — runtime configuration"; "the verification
  gate"). Category level only, no routes or values; both pages correctly
  state these surfaces are not public API.
- **F9** — `build/library.mdx` and `build/uploads.mdx`: "The Supabase
  fallback is capped at 5 MB" reveals the storage fallback architecture
  behind the Tier-1 upload flow.
- **F10** — Feature-flag names in `learn/study-prep.mdx` and
  `learn/exam-prep.mdx`. Configuration naming only; the flags gate learner
  product surfaces whose beta status is legitimately public.
- **F11** — `build/media.mdx` documents the instructor `/api/stream/*`
  publish flow; `build/webhooks.mdx` tabulates the Paystack webhook
  endpoints (`/api/webhooks/paystack`, legacy `/api/payments/verify`,
  `/api/payouts/webhook`). The HMAC-SHA512 signature scheme described is
  Paystack's own public integration contract; the endpoints are
  signature-authenticated by design. Recorded because the paths sit outside
  the Tier-1 list, not because the scheme disclosure is unsafe.

### 3.7 Info findings (F12–F14)

- **F12** — `learn/payments.mdx` notes a pricing endpoint exposes "the
  current coin value, the platform markup and a few example costs". No
  figures, percentages or commission values appear anywhere in the payments
  pages; the 30-day default refund window stated there is a customer-facing
  policy, not an internal.
- **F13** — Cookie names (`akoro_access_<portal>`, `akoro_refresh_<portal>`)
  and the full portal list are published in `start/authentication.mdx`.
  These are set on every client browser and are visible to any user; the
  public text matches the internal authentication document almost verbatim.
  No action recommended.
- **F14** — The changelog (page and JSON feed) contains one entry, about the
  docs launch itself, and restates that school ERP, admin and agent-internal
  routes remain internal. The status surface is a link to the hosted status
  page (akoro.instatus.com); no status internals are in the content tree.

## 4. Permissions accuracy (public claims vs internal record)

The public authentication, security and errors pages were compared against
`akoro-documentation/02-api/authentication.md` and `authorization.md`:

- **Consistent:** portal-scoped sessions; role and ownership decided
  server-side; "a client can never grant itself a role"; 403 as final;
  404 as "not found or not visible" (matching the internal rule that private
  records return 404 to non-owners); CORS restricted to explicit origins;
  rate-limit/retry guidance.
- **No RLS overstatement:** nothing on the public site claims row-level
  security or database-level enforcement. This matters because the internal
  record is explicit that RLS is *not* the enforcement layer (service-key
  data client; backend checks enforce). The public pages make no contrary
  claim.
- **No media-access overstatement:** the internal authorisation prose claims
  course media is enrolment-checked before any playback URL is issued; the
  public `build/media.mdx` makes no access-control claim for playback at
  all, so the public surface does not repeat the stronger claim. (The
  internal wording itself is tracked separately as a known open item and is
  outside this review's scope.)
- **One overstatement found:** the versioning policy (F5) — a decision
  recorded internally as open is presented publicly as agreed.
- `reference/api.mdx` lists exactly the Tier-1 allow-list (auth, records,
  catalogues, content and intake) and correctly marks `/api/v1` as planned;
  it is the model the Learn/Operate pages drift from.

## 5. Secret and credential scan (clean)

Patterns scanned across all 46 public-source files (content, OpenAPI copy,
llms.txt, scripts): token/key prefixes (`sk-`, `sk_live`, `AKIA…`, `ghp_`,
`xox…`), PEM headers, JWT shapes (`eyJ…`), bearer <redacted> strings,
password/secret assignment shapes, connection strings
(`postgres://`, `mongodb+srv`, `redis://`, `mysql://`), and the internal
secret names `AGENT_CONSOLE_KEY`, `INTERNAL_SECRET`, `SUPABASE_SERVICE_KEY`,
`PAYSTACK_SECRET`, `RUNPOD`.

- **No matches for any secret value or credential pattern.**
- The only email address in the tree is the placeholder
  `learner@example.com` (`start/getting-started.mdx`).
- Demo accounts are referenced without credentials
  (`start/environments.mdx`); no demo password appears anywhere. (The demo
  password is known to circulate in chat history; it is **not** in the
  public docs, and keeping it out is the correct state.)
- The agent-console *mechanism* is described in prose (F2) but no key value,
  header name or usage credential is given.
- Hostnames published are the public ones (`api.akoro.ng`,
  `sandbox.akoro.ng` — the tester-facing sandbox, published deliberately in
  the environments page). No `onrender.com` hosts, no internal service
  URLs, no cost/pricing internals (no provider names or rates in the public
  tree; the AI-provider and DeepSeek material lives only in the internal
  knowledge base).

## 6. Validation run

`akoro-docs/scripts/validate-public-docs.mjs` was run against the downloaded
tree (with the internal OpenAPI source linked alongside, so its staleness
check was active): **passed — 72 routes checked.** All local `/docs` links
resolve, `public/llms.txt` paths resolve, `content/changelog.json` parses,
and the committed `openapi/akoro.yaml` is byte-identical to the internal
source. The validator checks link/contract integrity only; it has no
allow-list or content-classification check, which is how the §3 drift
passes CI today (see §7).

## 7. Residual risks and limits of this review

- **Source, not deployment.** The review covers the branch source. The live
  site has lagged the branch before; if the pending redeploy publishes this
  source unchanged, F1–F5 go (or stay) live with it. Conversely the root
  `meta.json` page list omits `learn`, so the Learn section's exact live
  reachability (nav vs direct URL) was not established here — direct-URL
  exposure should be assumed.
- **Runtime behaviour unverified.** What `GET /api/tasks/health` and
  `GET /api/battle/health` actually return was not tested; F6 assumes the
  endpoints return no sensitive detail. If either returns diagnostics
  beyond liveness, F6 rises in severity.
- **Generated pages.** The Fumadocs-generated `/docs/api-reference/*` pages
  derive from the committed OpenAPI copy, which this review verified is the
  Tier-1 contract and identical to the internal source; the generated pages
  themselves were not re-rendered.
- **No classification gate exists.** Nothing in CI distinguishes public from
  internal content. The durable fix for the F1/F3 class is a mechanical
  allow-list check (e.g. route-prefix and internal-term scanning in
  `validate-public-docs.mjs`), not reviewer vigilance.
- **Review ≠ verification of enforcement.** Permissions *claims* were
  checked against the internal documents, not against running code; the
  sandbox regression evidence for enforcement lives with the verify gate.

## 8. Sign-off

This review records findings only; it does not approve the public surface.
Remediation of F1–F5 (or explicit acceptance of them) is a decision for the
platform owner.

## 9. Remediation (2026-11-26)

Applied in source on the same branch, before the pending redeploy. The
sign-off in §8 is unchanged: remediation is recorded here, approval remains
the platform owner's.

| # | Change |
| --- | --- |
| F1 | `learn/agent-network.mdx` rewritten as a product overview: the full route map (`/api/agent-network/*`, `/api/adaptive/marketplace/*`, `/api/adaptive/ratings`) and the internal mechanics (presence-heartbeat cadence and online window, protected-learner check, message shaping, default-agent and rating-storage detail) are removed. Discovery, challenges, buddies, daily battles, circles, the marketplace, and the learner-controlled privacy and safety settings remain, in product terms. |
| F2 | `learn/agent-chat.mdx`: the agent-console bullet is removed in full, along with the runtime internals (tool-area selection, forced-tool behaviour, kill switches, the scrubbing/claim-check pipeline detail, socket identity-overwrite). The page now describes learner-visible behaviour: tools, confirm-before-change, grounding, and reply checks in plain terms. |
| F3 | `learn/battles.mdx`: the Endpoints section and the Worker lifecycle section (BullMQ queue name and all seven internal job names) are removed, along with settlement field names; series actions and how a battle runs are described in prose. `learn/teaching-sessions.mdx`: the Endpoints table — including the teacher review-queue `GET`/`PATCH` ladder routes and the syllabus-ingestion routes — is removed; the review queue is described as an in-app teacher surface. |
| F4 | `learn/practice.mdx`: the verbatim proctoring thresholds (flag ≥ 0.4, terminate ≥ 0.85) and the frame cadence are removed. Verdicts are described qualitatively, and proctoring is described as building a picture from what it observes, with sustained serious concerns ending the exam. |
| F5 | `start/versioning.mdx`: the policy is now headed "Proposed versioning policy" and states it is "proposed, not yet agreed or implemented" with the decision still open, matching `akoro-documentation/11-changes-releases/migrations/api-migrations.md`. The deprecation lifecycle is labelled proposed throughout. |
| F6 | `operate/observability.mdx`: the `GET /api/tasks/health` row is removed; `learn/battles.mdx`: the `GET /api/battle/health` line went with the Endpoints section (F3). |
| F7 | `apps/school.mdx`: the internal scale figures (route-declaration and table counts) are removed. |
| F8 | `apps/admin.mdx` and `operate/architecture.mdx`: the internal capability-area enumeration (model routing, spend, evaluations, verification gate, agent capabilities/prompts runtime configuration) is replaced with a general "AI operations" description. |
| F9 | `build/library.mdx` and `build/uploads.mdx`: the Supabase storage-fallback sentence (and its 5 MB cap) is removed. |
| F10 | `learn/study-prep.mdx` and `learn/exam-prep.mdx`: the feature-flag names (`AKORO_STUDY_PREP_ENABLED`, `AKORO_EXAM_PREP_CONFIDENCE_ENABLED`, `AKORO_ADAPTIVE_WORKFLOWS_ENABLED`) are removed; the status notes now say the surfaces are enabled by default. |
| F11 | `build/media.mdx`: the `/api/stream/*` publish flow is rewritten as the instructor-app flow with no endpoint paths. `build/uploads.mdx`: the same stream flow in its Course video section is likewise rewritten (same finding class). `build/webhooks.mdx`: the legacy `/api/payments/verify` and `/api/payouts/webhook` rows are removed; the unified `/api/webhooks/paystack` endpoint is kept — it is the documented webhook in the internal Tier-1 API docs (`akoro-documentation/02-api/webhooks.md`). |
| F12–F14 | Info findings; no change, as recommended. |

**Durable guard.** `akoro-docs/scripts/validate-public-docs.mjs` now carries
the mechanical allow-list check recommended in §7: every `/api/...` path
mentioned in the content must match an operation in `openapi/akoro.yaml`
(after `{param}`/`:param` normalisation) or an explicit, justified
`ALLOWLIST` entry in the script. The allow-list has eight entries: the
planned `/api/v1` prefix; the two Google OAuth browser-redirect endpoints;
the unified Paystack webhook above (documented in the internal Tier-1 API
docs but not modelled as an OpenAPI operation); and the four mount points of
registry-backed beta learner surfaces whose Learn pages document relative
paths (Study Prep, Exam Prep, Self-study, Communities). Verified both ways:
the extended validator fails on the pre-remediation tree (70 findings,
covering the F1/F3/F6/F11 path classes) and passes on the remediated tree
(72 routes checked, no link regressions).

Sign-off: pending (Matt)
