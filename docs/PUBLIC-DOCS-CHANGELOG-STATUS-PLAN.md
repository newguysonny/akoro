# Akoro Public Docs, API Reference, Changelog and Status Plan

| Field | Value |
| --- | --- |
| Status | Phase 4 substantially complete — docs live at `docs.akoro.ng` (apps and operate guides, error catalog, data dictionary, versioning policy, generated API reference, changelog feeds, search, analytics); Tier-1 OpenAPI coverage closed (36 operations, marketplace deferred to Tier 2); Instatus status page wired via `/status` |
| Owner | Platform / Documentation |
| Created | 2026-11-25 |
| Scope | Public documentation site, API reference, product/API changelog, public status page |
| Related | `AGENTS.md`, `reference/Grand Plan.md`, `docs/`, `akoro-api/modules/*/README.md` |
| Target surfaces | `docs.akoro.ng`, `status.akoro.ng`, changelog route under docs or `akoro.ng` |
| Implementation | `akoro-docs/` (Next.js + Fumadocs); generated OpenAPI operation pages under `/docs/api-reference/<operationId>`; search API; changelog RSS/JSON feeds + PR draft workflow; docs CI; `/status` redirect scaffold |
| Status provider | Instatus Starter now; Pro later for `status.akoro.ng` and 30-second checks |
| Deployment | Vercel project deployed at `docs.akoro.ng`; documented in `akoro-docs/DEPLOYMENT.md` |
| Parent plan | `docs/PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md` — this document is the public-surface detail of the larger Platform Documentation System |

> This plan is the public presentation layer of the Platform Documentation
> System. The canonical repository, feature templates, capability registry,
> agent context-loading model and self-validation rules are defined in
> `docs/PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md`.

---

## 1. Executive summary

Akoro currently has deep internal documentation — module READMEs, engineering
guarantees, security checklists, runbooks and a large `docs/` folder — but no
public documentation surface. Developers, instructors, school administrators and
partners have no single place to learn:

- what the platform does;
- how to authenticate and call the API;
- what every request parameter and response field means;
- what changed and when;
- whether the platform is currently healthy.

This plan defines a public documentation system with three connected surfaces:

1. **Docs** — concepts, getting started, app guides, backend architecture and a
   generated API reference.
2. **Changelog** — product and API changes, including breaking changes and
   migration notes.
3. **Status** — component health, incidents, maintenance and uptime history.

The recommended implementation is:

- a separate `akoro-docs/` Next.js application using Fumadocs;
- MDX content plus an OpenAPI 3.1 spec as the API source of truth;
- deployment on Vercel at `docs.akoro.ng`;
- a managed status provider at `status.akoro.ng` so status survives an Akoro
  outage;
- changelog entries generated from pull-request labels and approved by an
  editor;
- CI gates for broken links, undocumented public routes, invalid OpenAPI and
  stale examples.

The first release should cover Tier-1 public endpoints and the core getting
started path. It should not attempt to document every internal module.

---

## 2. Scope and non-goals

### 2.1 In scope

- Public docs site with navigation, search, dark mode, mobile layout and
  on-page table of contents.
- Getting started and authentication guides.
- API reference with request parameters, response fields, errors, examples and
  constraints.
- App feature documentation for Learner, Instructor, School and Admin.
- Backend architecture and operational documentation suitable for external
  developers and partners.
- Product changelog and API changelog.
- Public status page, component monitors, incident publishing and uptime
  history.
- CI, preview deployments, content ownership and review process.

### 2.2 Out of scope for v1

- Public self-service developer accounts, OAuth client registration or API key
  management.
- Auto-generated SDKs for every language.
- Full documentation of internal admin, agent-console, task and workflow
  endpoints.
- A community forum or comments system.
- Self-hosted status infrastructure.
- Localisation. Content structure should allow it later, but English only in
  v1.
- Rewriting the API into a versioned gateway. This plan defines the policy; the
  implementation is a separate engineering task.

---

## 3. Current state

### 3.1 Repository surfaces

| Surface | Path | Notes |
| --- | --- | --- |
| API | `akoro-api/` | Express, modular route files under `modules/*/routes.js` |
| Learner app | `akoro-learner/` | Vite + React, deployed to Vercel |
| School app | `akoro-school/` | Vite + React, deployed to Vercel |
| Instructor app | `akoro-instructor/` | Vite + React, deployed to Vercel |
| Admin app | `akoro-admin/` | Vite + React, deployed to Vercel |
| Design system | `design-system/` | Shared tokens and components |
| Media worker | `media-worker/` | Cloudflare Container, queue/fan-out encode lane |
| Embed worker | `embed-worker/` | Embedding/vector support |
| RunPod worker | `runpod-worker/` | Extraction engine |
| Internal docs | `docs/` | Engineering, security, cost and runbook notes |
| Plan | `reference/Grand Plan.md` | Product and architecture plan |

### 3.2 Existing documentation assets

- `docs/ENGINEERING_GUARANTEES.md`
- `docs/SECURITY_CHECKLIST.md`
- `docs/llm-cost-model.md`
- `docs/learner-smoke-test.md`
- `docs/UI-AUDIT-learner-2026-09.md`
- `docs/CHAT-COMMANDS.md`
- `akoro-api/modules/*/README.md`
- `reference/Grand Plan.md`

These are valuable but internal. They are written for maintainers, not for an
external developer trying to make a first API call.

### 3.3 Gaps

- No public docs domain.
- No machine-readable API contract.
- No consistent error-code catalogue.
- No public changelog or RSS feed.
- No public status page or incident history.
- No CI check that documented routes still exist.
- No clear separation between public endpoints and internal/admin endpoints.
- No versioning or deprecation policy for `/api`.
- No docs ownership or review SLA.

---

## 4. Goals and success metrics

### 4.1 Goals

1. A developer can authenticate and make a first successful API call from the
   docs alone.
2. Every Tier-1 endpoint has request parameters, response fields, errors and a
   tested example.
3. Product and API changes are visible within one business day.
4. Users can tell whether an outage is Akoro-wide or specific to their app.
5. Documentation cannot silently drift from the deployed API.
6. Internal runbooks remain internal; public docs expose only supported
   surfaces.

### 4.2 Success metrics

| Metric | Target |
| --- | --- |
| Tier-1 public endpoint coverage | 100% |
| Examples validated in CI | 100% of Tier-1 examples |
| Docs search success | > 80% |
| First API call completed from docs | Measured via sandbox demo flow |
| Support tickets caused by missing docs | Trend down after launch |
| Changelog freshness | Published within 1 business day |
| Status page availability | Independent of Akoro API |
| Incident first update | Within 15 minutes for SEV-1 |
| Accessibility | WCAG 2.2 AA for docs pages |
| Lighthouse performance | >= 90 on docs landing and reference pages |

---

## 5. Principles

1. **Docs are a product surface**, not an afterthought. They get an owner, a
   release process, analytics and quality gates.
2. **The API contract is the source of truth.** Reference pages are generated
   from OpenAPI, not hand-copied from route files.
3. **Public by allow-list.** Only explicitly supported endpoints are published.
4. **Examples must run.** Every example uses demo data and is validated against
   the sandbox where possible.
5. **Status must be independent.** The status page cannot depend on the API,
   database or Render service it reports on.
6. **Changelog is continuous.** Entries are drafted from PRs, not reconstructed
   from memory at release time.
7. **One design language.** Docs reuse Akoro tokens, typography and spacing.
8. **Progressive depth.** Tier-1 first; internal and legacy modules later or
   never.
9. **No secrets in docs.** Demo credentials only; redact tokens and personal
   data.
10. **Mobile and search first.** Many instructors and school admins will read
    docs on a phone.

---

## 6. Recommended architecture

### 6.1 Surfaces and domains

| Surface | Domain | Owner |
| --- | --- | --- |
| Docs | `docs.akoro.ng` | Docs lead |
| API reference | `docs.akoro.ng/api` | API owners per domain |
| Changelog | `docs.akoro.ng/changelog` or `akoro.ng/changelog` | Product + Docs |
| Status | `status.akoro.ng` | On-call + Platform |
| Status badge | Embedded in docs footer/header | Docs |

Recommended top-level navigation:

```text
Docs | API | Changelog | Status
```

The Vercel screenshots use `Build / Learn / Getting Started` as top tabs. For
Akoro, four top-level items are clearer. `Build` and `Learn` become sections in
the docs sidebar rather than separate top tabs.

### 6.2 Stack decision

**Recommended:** Next.js + Fumadocs on Vercel.

| Option | Pros | Cons | Decision |
| --- | --- | --- | --- |
| Next.js + Fumadocs | MDX, OpenAPI support, search, dark mode, good mobile nav, active ecosystem | New framework in repo | Recommended |
| Nextra | Simpler MDX docs | Less first-class OpenAPI experience | Viable fallback |
| Docusaurus | Mature, versioning | Heavier, React app conventions differ from Akoro | Not recommended |
| VitePress | Fast, simple | Vue-based, no existing Vue expertise | Not recommended |
| Custom Vite app | Fits current apps | Rebuilds search, nav, MDX, OpenAPI, accessibility | Avoid |

A separate app is preferred over embedding docs in `akoro-learner`:

- independent deploy and rollback;
- no coupling to the learner bundle;
- no risk to product builds;
- separate analytics and access controls;
- easier preview deployments for content review.

### 6.3 Proposed repository layout

```text
akoro-docs/
  app/
    (docs)/...
    api/...
    changelog/...
    layout.tsx
  content/
    docs/
      start/
      build/
      apps/
      operate/
      reference/
    changelog/
  openapi/
    openapi.yaml
    domains/
      auth.yaml
      records.yaml
      courses.yaml
      stream.yaml
      public-catalog.yaml
  components/
    api/
    docs/
    changelog/
  lib/
  public/
  package.json
  next.config.ts
  vercel.json
```

Existing `docs/` remains internal. If it becomes confusing, rename it to
`reference/internal-docs/` in a later cleanup; do not mix public MDX into it.

### 6.4 Deployment

- Vercel project connected to the monorepo, root directory `akoro-docs`.
- Production domain `docs.akoro.ng`.
- Preview deployment for every docs PR.
- Status page separate provider, custom domain `status.akoro.ng`.
- Redirects from old paths if any public links exist.
- Uptime monitor for the docs site itself.

### 6.5 Search and analytics

- Pagefind for v1: static, fast, no external dependency.
- Algolia DocSearch only if search quality or scale demands it.
- Privacy-friendly analytics (Vercel Analytics or Plausible).
- Track: page views, search terms with no results, feedback votes, code-copy
  events, outbound API links.
- Do not collect API tokens or request bodies.

---

## 7. Information architecture and page inventory

### 7.1 Sidebar structure

```text
Start
  Getting started
  Fundamentals
  Authentication
  Environments and demo accounts
  Errors and rate limits
  API versioning and deprecations

Build
  API overview
  Requests, pagination and filtering
  File uploads
  Webhooks and callbacks
  Realtime and sockets
  Media and encoding
  Records and extraction
  Retrieval and search
  AI and agent features

Apps
  Learner
  Instructor
  School
  Admin
  Feature matrix

Operate
  Architecture
  Deployments
  Observability
  Backups and recovery
  Security
  Runbooks
  Status and incidents

Reference
  API reference
  Error catalog
  Data dictionary
  Changelog
  Status
  Roadmap
```

### 7.2 Proposed public URL map

| URL | Page |
| --- | --- |
| `/` | Docs landing |
| `/start/getting-started` | First request in 10 minutes |
| `/start/authentication` | Auth, portal header, 2FA, demo accounts |
| `/start/environments` | Production, sandbox, local |
| `/start/errors` | Error envelope and stable codes |
| `/start/versioning` | Versioning and deprecation |
| `/build/api-overview` | Base URL, content types, conventions |
| `/build/uploads` | Presigned R2 upload flow |
| `/build/webhooks` | Signatures, retries, idempotency |
| `/build/media` | Encode queue, variants, status |
| `/build/retrieval` | Search and embeddings |
| `/apps/learner` | Learner capabilities |
| `/apps/instructor` | Instructor capabilities |
| `/apps/school` | School capabilities |
| `/apps/admin` | Admin capabilities |
| `/operate/architecture` | System diagram and boundaries |
| `/operate/observability` | Health, logs, metrics |
| `/operate/security` | Security model for integrators |
| `/reference/api` | Generated API reference |
| `/reference/errors` | Error catalogue |
| `/changelog` | Product and API changes |
| `/status` | Link/embed to status provider |

### 7.3 Page template

Every docs page should use a consistent template:

```text
Title
One-sentence purpose
Who this is for
Prerequisites
Main content
Examples
Common errors
Related links
Last updated
Was this helpful?
```

API operation pages use a different template; see section 8.4.

### 7.4 Navigation rules

- Maximum three levels in the sidebar.
- Every page has one canonical parent.
- No orphan pages.
- Use sentence case for titles.
- Use verb-first titles for tasks: “Upload a file”, not “File uploads”.
- Keep legacy or internal content out of the public nav.
- Surface search on mobile before the nav.

---

## 8. API documentation plan

### 8.1 Coverage tiers

The API has many route modules. Publish by tier, not all at once.

| Tier | Modules / domains | Public? | Timing |
| --- | --- | --- | --- |
| Tier 1 | `auth`, `records`, `courses` (stream/media), `programmes`/public catalog, `contact`, payment webhooks | Yes | v1 |
| Tier 2 | learner goals, self-study, adaptive chat, communities, blogs, instructor, school | Yes, with role notes | v1.1 |
| Tier 3 | admin, agent console/network, tasks, workflows, voice, verify | Limited or internal | Later |
| Private | internal secrets, admin security operations, agent internals, raw callbacks | No | Never public |

Tier-1 v1 scope:

- Authentication and session lifecycle.
- Library records: create, upload URL, complete upload, list, get, preview,
  extraction status.
- Courses: list/manage, lessons, video upload URL, upload complete, encode
  status, playback URL.
- Public catalog/programmes: published courses, instructors, live sessions.
- Contact and partner forms.
- Payment webhooks if they are intended for external integrators; otherwise
  document as internal.
- Common errors, pagination, rate limits.

### 8.2 Source of truth: OpenAPI 3.1

Use a curated OpenAPI 3.1 specification as the contract:

- one root `openapi.yaml`;
- one file per domain;
- shared schemas in `openapi/schemas/`;
- examples stored with the spec and validated in CI;
- Redocly for linting and bundling;
- Fumadocs OpenAPI integration for rendering.

Why not annotate every Express route:

- roughly 80 `routes.js` files;
- annotations would create large diffs and couple docs to implementation;
- many routes are internal or legacy;
- a curated spec plus a CI route-coverage check catches drift without editing
  every module.

New endpoints should define Zod schemas and generate OpenAPI fragments. Existing
Tier-1 endpoints get hand-written schemas during Phase 2.

### 8.3 OpenAPI layout

```text
openapi/
  openapi.yaml
  domains/
    auth.yaml
    records.yaml
    courses.yaml
    stream.yaml
    catalog.yaml
    contact.yaml
  schemas/
    common.yaml
    errors.yaml
    pagination.yaml
    records.yaml
    courses.yaml
    media.yaml
  examples/
    auth/
    records/
    courses/
    stream/
```

Bundling rules:

- no `$ref` to files outside `openapi/`;
- every operation has `operationId`, `summary`, `tags`, security and responses;
- every request body has a schema and at least one example;
- every 4xx response references the shared error schema;
- every public endpoint is tagged with its domain and audience.

### 8.4 Endpoint page anatomy

Each generated API page must show:

1. **Method and path** with a copy button.
2. **Purpose** — one sentence.
3. **Audience and auth** — required role, portal header, 2FA, token type.
4. **Path parameters** — name, type, required, constraints, example.
5. **Query parameters** — name, type, default, allowed values, example.
6. **Headers** — required and optional, including `X-Akoro-Portal`,
   idempotency key, content type.
7. **Request body** — field tree with types, required, enums, limits.
8. **Response body** — field tree, nullability, example.
9. **Errors** — HTTP status, stable code, meaning, retryability.
10. **Rate limits** — scope and headers.
11. **Example** — curl and JavaScript tabs, plus a server-to-server example.
12. **Related** — concepts, webhooks, changelog entries, guides.

Do not show internal-only fields. Redact secrets and personal data from examples.

### 8.5 Data dictionary

Create a shared data dictionary for objects that appear across domains:

- User, role, portal and session.
- Course, module, lesson, enrolment.
- Record/material, file, preview, extraction page, chunk.
- Video, source, HLS variant, encode job.
- Programme, faculty, department.
- Payment, transaction, refund, payout.
- Notification, webhook delivery, idempotency key.
- Pagination envelope, error envelope, rate-limit headers.

Each entry includes:

- field name and type;
- required/optional and default;
- allowed values;
- PII classification;
- stability (stable, beta, internal);
- example;
- owning module.

### 8.6 Authentication documentation

Cover:

- login/logout and session cookie behavior;
- `X-Akoro-Portal` for learner/instructor/school/admin;
- 2FA and demo-account bypass;
- token/session lifetime and refresh behavior;
- CSRF expectations for browser clients;
- role and ownership checks;
- sandbox demo accounts and their limits;
- how to obtain a token for server-to-server examples without exposing secrets.

Never publish production credentials.

### 8.7 Errors, pagination, idempotency and limits

Define and document:

- one error envelope;
- stable machine-readable error codes;
- HTTP status mapping;
- validation error shape with field paths;
- pagination and cursor semantics;
- filtering and sorting allow-lists;
- rate-limit scope, headers and retry guidance;
- idempotency keys for writes;
- retryability and backoff;
- request size and file-size limits;
- timeouts for long-running jobs.

### 8.8 Uploads, media, webhooks and realtime

Uploads:

- presigned PUT flow;
- allowed MIME types and size limits;
- URL expiry;
- complete-upload call;
- staging and deletion;
- fallback behavior.

Media:

- course-video queue and fan-out;
- `queued`, `encoding`, `completed`, `failed` states;
- progress and retry semantics;
- variant ladder;
- playback URL shape;
- source deletion after encode.

Webhooks:

- signature header and verification;
- replay protection;
- retry schedule;
- idempotent consumers;
- event catalogue and payload versions.

Realtime:

- socket authentication;
- event names and payloads;
- reconnect behavior;
- unsupported browser fallback.

### 8.9 Versioning and deprecation

Recommended policy:

- canonical public base path `/api/v1`;
- `/api` remains an alias for existing clients;
- additive changes are allowed in v1;
- breaking changes require a new major version;
- deprecation notice minimum 90 days;
- `Deprecation` and `Sunset` response headers;
- changelog entry and migration guide for every breaking change;
- docs version selector for current and previous major.

This policy must be decided before the first public API page ships.

### 8.10 Examples and “Try it”

- Every Tier-1 example uses a demo account and sandbox data.
- Examples live next to the OpenAPI operation.
- CI validates JSON examples against schemas.
- Phase 1: static examples only.
- Phase 2: “Try it” against `sandbox.akoro.ng` for GET and safe writes.
- Never allow “Try it” to mutate production.
- Clearly label destructive examples.

### 8.11 CI route coverage

Add a script that:

1. Loads the Express route table or scans `modules/*/routes.js`.
2. Normalises paths and methods.
3. Compares against OpenAPI `paths`.
4. Fails when a public route is undocumented and not on an allow-list.
5. Fails when an OpenAPI path does not exist in the code.
6. Reports coverage by tier.

This is the main defence against docs drift.

### 8.12 OpenAPI skeleton example

```yaml
openapi: 3.1.0
info:
  title: Akoro API
  version: 1.0.0
servers:
  - url: https://api.akoro.ng/api/v1
    description: Production
  - url: https://sandbox.akoro.ng/api/v1
    description: Sandbox
tags:
  - name: Auth
  - name: Records
  - name: Courses
  - name: Stream
paths:
  /records:
    get:
      tags: [Records]
      operationId: listRecords
      summary: List the caller's library records
      security:
        - sessionCookie: []
      parameters:
        - $ref: '#/components/parameters/Portal'
        - $ref: '#/components/parameters/Limit'
        - $ref: '#/components/parameters/Cursor'
      responses:
        '200':
          description: A page of records
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RecordList'
        '401':
          $ref: '#/components/responses/Unauthorized'
```

The exact routes and schemas are verified in Phase 0/2; the snippet shows the
required shape.

---

## 9. App and backend feature documentation

### 9.1 App feature matrix

Document each app with:

| Area | Learner | Instructor | School | Admin |
| --- | --- | --- | --- | --- |
| Onboarding | Yes | Yes | Yes | Yes |
| Courses | Enrol/read | Create/manage | Curriculum | All |
| Library | Upload/read | Share | School library | All |
| Agents/AI | Chat/study | Authoring | Oversight | Platform |
| Media | Watch | Upload/encode | Approve | Operate |
| Assessments | Take | Author/grade | Results | All |
| Payments | Pay | Earnings | Fees | Reconciliation |
| Admin | No | Limited | School admin | Full |

The final matrix is filled from the code during Phase 0; do not guess
capabilities in public docs.

### 9.2 Backend architecture docs

Public-friendly architecture pages:

- request lifecycle and module boundaries;
- authentication and authorisation model;
- Postgres schema domains;
- R2 storage and presigned uploads;
- media encode queue and fan-out;
- extraction pipeline and OCR;
- embeddings and retrieval;
- background jobs, queues and schedules;
- caching and rate limiting;
- observability and health;
- failure and retry semantics.

Do not publish internal secrets, exact infrastructure credentials, admin
runbooks or attack surface details.

### 9.3 Environments and data

- Production `api.akoro.ng`.
- Sandbox `sandbox.akoro.ng` with its own database.
- Local development.
- Demo accounts and reset policy.
- Data retention and deletion for sandbox data.
- Test data must be cleaned up after examples.

---

## 10. Changelog plan

### 10.1 Streams and taxonomy

Two streams on one page:

1. **Product changelog** — features, improvements, fixes, UX, security.
2. **API changelog** — new endpoints, fields, behaviour, deprecations, breaking
   changes.

Tags:

```text
feature
improvement
fix
security
api:additive
api:deprecation
api:breaking
docs
```

Audience tags:

```text
learner
instructor
school
admin
developer
partner
```

### 10.2 Entry format

```md
---
title: Faster course-video publishing
date: 2026-12-01
type: feature
audience: [instructor]
apps: [instructor]
api: none
version: 1.0.0
breaking: false
---

Instructors now see encode progress per rendition and can keep uploading while
previous videos are queued.

**What changed**
- Course videos are queued instead of rejected when the encoder is busy.
- Progress is visible on the lesson page.

**Action required**
None.

[Read the media docs](/build/media)
```

### 10.3 Workflow and automation

1. Developer opens PR and adds one changelog label.
2. GitHub Action generates a draft entry from the PR title/body.
3. Author fills in impact and action required.
4. Docs/product editor approves.
5. Merge publishes the entry and regenerates feeds.
6. Security entries can be published manually without a public PR.

Do not auto-publish raw commit messages.

### 10.4 Feeds and distribution

- HTML changelog page with filters.
- RSS feed.
- JSON feed for partners and status widgets.
- Optional email digest and Slack/Discord webhook.
- Link every entry to affected docs.

### 10.5 API change policy

- Additive changes: normal changelog entry.
- Deprecations: entry plus migration guide, 90-day window, headers.
- Breaking changes: major version, migration guide, at least two notices.
- Security fixes: coordinated disclosure; entry after remediation.

### 10.6 Sample API entries

```md
## 2026-12-03 — API

**Added** `POST /api/v1/stream/upload-url` for direct-to-R2 course uploads.

**Deprecated** `POST /api/v1/stream/upload` for files over 64 MB. Use the
presigned flow. Sunset: 2027-03-01.

**Migration** [Direct upload guide](/build/uploads)
```

---

## 11. Status and incidents

### 11.1 Provider decision

Recommended: managed provider such as Instatus, Better Stack or Atlassian
Statuspage.

Why:

- status must remain available when Akoro, Render, Vercel or R2 is down;
- subscriptions, incident history and uptime calculations are built in;
- no on-call engineer should maintain status infrastructure during an outage.

Do not self-host the status page on the API or the same Render service.

### 11.2 Components

| Component | User-facing meaning |
| --- | --- |
| Learner app | `app.akoro.ng` |
| Instructor app | `instructor.akoro.ng` |
| School app | School portal |
| Admin app | Admin portal |
| API | `api.akoro.ng` |
| Authentication | Sign-in, sessions, 2FA |
| Database | Persistent data and reads/writes |
| File storage | R2 uploads, downloads, previews |
| Media encoding | Course-video queue and HLS |
| Extraction/OCR | PDF/image/audio processing |
| AI providers | Chat, embeddings, transcription |
| Email/SMS | Notifications and password resets |
| Payments | Checkout, webhooks, payouts |

### 11.3 Monitors and thresholds

| Monitor | Frequency | Timeout | Alert threshold |
| --- | --- | --- | --- |
| API `/health` | 60s, 3 regions | 5s | 2 consecutive failures |
| API deep health | 5m | 15s | 1 failure |
| Learner login smoke | 5m | 30s | 2 consecutive |
| Instructor login smoke | 5m | 30s | 2 consecutive |
| School login smoke | 5m | 30s | 2 consecutive |
| Admin login smoke | 5m | 30s | 2 consecutive |
| Media worker `/edge-health` | 60s | 5s | 2 consecutive |
| Media worker `/healthz` | 5m | 30s | 2 consecutive |
| R2 read/write probe | 5m | 15s | 2 consecutive |
| Encode queue oldest job | 1m | — | > 15 min |
| Extraction backlog | 5m | — | > configured threshold |
| Payment webhook failures | 5m | — | > 1% over 15 min |
| AI provider errors | 5m | — | > 5% over 15 min |

Deep checks must be authenticated and must not expose secrets publicly.

### 11.4 Incident lifecycle

```text
Investigating → Identified → Monitoring → Resolved
```

Severity:

| Severity | Definition | Update cadence |
| --- | --- | --- |
| SEV-1 | Full outage, data loss, security incident, payments broken | Every 15 min |
| SEV-2 | Major feature unavailable for many users | Every 30 min |
| SEV-3 | Degraded performance or limited feature | Every 60 min |
| SEV-4 | Minor issue or cosmetic | Daily |

Every public incident records:

- affected components;
- start time in UTC;
- customer impact;
- current status;
- mitigation;
- next update time;
- resolution and postmortem link when applicable.

### 11.5 Incident templates

**Investigating**

> We are investigating reports of [impact] affecting [components]. Sign-in and
> [other unaffected areas] remain available. Next update by [time].

**Identified**

> We have identified the cause as [cause]. We are applying [mitigation]. Some
> users may still see [impact]. Next update by [time].

**Monitoring**

> A fix has been deployed and metrics are recovering. We are monitoring for
> [duration] before resolving. Next update by [time].

**Resolved**

> This incident is resolved. [Impact] occurred from [start] to [end] UTC. A
> postmortem will be published within [X] business days.

### 11.6 Maintenance and postmortems

- Schedule maintenance windows in advance.
- Show maintenance separately from incidents.
- Postmortem required for SEV-1 and SEV-2.
- Postmortem includes timeline, impact, root cause, detection, response,
  contributing factors and action items with owners/dates.
- Publish a redacted public version; keep sensitive details internal.

### 11.7 Subscriptions and integration

- Email subscription.
- RSS/Atom feed.
- Optional SMS/Slack for enterprise partners.
- Status badge component in docs and apps.
- Link from error pages: “Check Akoro status”.

---

## 12. Content operations

### 12.1 Ownership and RACI

| Role | Responsible for |
| --- | --- |
| Docs lead | Site, IA, style, editorial, CI, search, analytics |
| API domain owner | OpenAPI schemas, examples, endpoint accuracy |
| App owner | Feature guides and screenshots |
| Platform/on-call | Status components, monitors, incidents, postmortems |
| Design | Layout, components, accessibility |
| Security | Public-content review, redaction, disclosure policy |

Review SLA: two business days for normal docs PRs; same day for security or
breaking-change docs.

### 12.2 Authoring and review

1. Author writes MDX or OpenAPI in a branch.
2. Preview deployment is generated.
3. Domain owner reviews technical accuracy.
4. Docs lead reviews style and IA.
5. Security reviews anything with auth, data or infrastructure detail.
6. CI must pass.
7. Merge publishes.

### 12.3 Style guide

- Second person, present tense.
- Short sentences and scannable headings.
- Explain why before how.
- Use consistent product names.
- Use sentence case.
- Use ISO dates and UTC timestamps.
- Use code fences with language tags.
- Do not use screenshots for information that changes often; use them for
  orientation only.
- Every page ends with related links and feedback.

### 12.4 Versioning and archival

- API reference follows the API major version.
- Product docs describe the current release; changelog preserves history.
- Deprecated pages remain accessible until sunset plus 90 days.
- Archive old guides with a banner and a link to the replacement.
- Never delete a URL without a redirect.

### 12.5 Security review

- Demo accounts only; no production credentials.
- Redact tokens, cookies, internal hostnames and personal data.
- Do not document internal-only endpoints.
- Do not publish admin attack surface or secret rotation details.
- Review screenshots for leaked account data.
- Follow coordinated disclosure for security incidents.

---

## 13. CI/CD and quality gates

### 13.1 Required checks

- Docs build succeeds.
- Internal links and anchors resolve.
- External links return 2xx/3xx (allow known exceptions).
- OpenAPI validates and bundles.
- Every public route is documented or allow-listed.
- Every documented route exists in code.
- Examples validate against schemas.
- No secrets or forbidden patterns in content.
- Accessibility checks on key pages.
- Lighthouse budgets on landing and one API page.
- Spellcheck and style lint.

### 13.2 Preview and release

- Every docs PR gets a Vercel preview URL.
- Reviewers approve content and preview.
- Merge to the main branch deploys production.
- Post-deploy smoke: homepage, search, one API page, changelog RSS, status link.
- Roll back by reverting the docs commit; no API deployment required.

### 13.3 SEO, accessibility and AI discoverability

- `sitemap.xml`, `robots.txt`, canonical URLs.
- Open Graph/Twitter images per page or section.
- Structured data for articles and breadcrumbs.
- `llms.txt` summarizing docs for AI agents.
- RSS/JSON feeds for changelog and status.
- WCAG 2.2 AA: keyboard nav, focus states, contrast, reduced motion.
- Code blocks: copy button, language label, horizontal scroll.
- Tables: responsive or scrollable, not clipped.

---

## 14. Delivery plan

### 14.1 Phases

| Phase | Deliverables | Estimate |
| --- | --- | --- |
| 0. Discovery | Route inventory, tiering, stack/status/spec decisions, URL map | 2 days |
| 1. Foundation | Docs app, layout, nav, search, 10 core pages, deploy, feedback | 1 week |
| 2. Tier-1 API reference | OpenAPI for auth/records/courses/stream/catalog, examples, CI coverage | 2 weeks |
| 3. Changelog and status | Templates, feeds, monitors, incident process, status page | 1 week |
| 4. Coverage and guides | Tier-2 domains, app guides, error catalogue, versioning docs | 3 weeks |
| 5. Polish | Ask AI, analytics review, version selector, feedback loop | 1 week |

One engineer plus content/review support: approximately 8–9 weeks for a solid
v1, with some phases parallelisable.

### 14.2 Phase 0 tasks

- Enumerate every `routes.js` file and route.
- Classify public, role-gated, internal and private.
- Confirm which apps and features are public.
- Decide OpenAPI source and ownership.
- Decide versioning policy.
- Choose status provider.
- Reserve domains.
- Agree content owners and review SLA.
- Produce the first sidebar and URL map.

### 14.3 Dependencies

- Domain/DNS access for `docs.akoro.ng` and `status.akoro.ng`.
- Vercel project permissions.
- Status provider account and billing.
- API owner availability for schemas and examples.
- Security review for auth/data docs.
- Decision on `/api/v1` and deprecation policy.

### 14.4 Acceptance criteria for v1

- Docs site deployed at `docs.akoro.ng` with search and mobile nav.
- Getting started, auth, errors and environments pages complete.
- 100% of Tier-1 public endpoints documented.
- Every Tier-1 example validates in CI.
- Changelog page, RSS and JSON feed live.
- Status page live with components, monitors and one test incident drill.
- CI blocks broken links and undocumented public routes.
- Accessibility and Lighthouse budgets pass on key pages.
- Security review signed off.
- Rollback and ownership documented.

---

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Docs drift from API | Developers follow wrong contract | OpenAPI source + route-coverage CI + example validation |
| Scope explosion | Launch slips | Tiered coverage; Tier 1 only |
| Internal endpoint leaked | Security risk | Public allow-list; security review |
| Status page depends on Akoro | Status unavailable during outage | Managed external provider |
| No clear owner | Stale docs | Named owners and review SLA |
| Changelog becomes a commit log | Low signal | Editor-approved entries, impact/action fields |
| Versioning debt | Breaking changes surprise clients | Decide `/api/v1` and 90-day policy before launch |
| Screenshots expose data | Privacy/security | Demo data and screenshot review |
| Search returns nothing useful | Poor adoption | Track zero-result queries and tune content |
| Docs site itself goes down | Support load | Uptime monitor and static fallback |

---

## 16. Decisions and open questions

### 16.1 Recommended defaults

| Decision | Recommendation |
| --- | --- |
| Docs framework | Next.js + Fumadocs |
| Repo | New `akoro-docs/` app |
| Hosting | Vercel, `docs.akoro.ng` |
| API contract | OpenAPI 3.1 YAML, curated by domain |
| API versioning | `/api/v1` canonical, `/api` alias, 90-day deprecation |
| Status provider | Instatus or Better Stack; Statuspage if enterprise required |
| Search | Pagefind v1; Algolia later if needed |
| Changelog source | PR labels + GitHub Action draft + editor approval |
| Internal docs | Keep `docs/` internal; do not publish automatically |
| Public endpoint policy | Allow-list, Tier 1 first |

### 16.2 Open questions

- Which public domain is preferred for the changelog: docs subpath or main
  marketing site?
- Does Akoro need partner-facing API keys in v1, or only session auth?
- Which payment webhooks are public contract versus internal implementation?
- Is a public API version selector needed at launch, or only the current major?
- Who is the on-call owner for status updates outside engineering hours?
- Which AI provider statuses should be public components, given provider
  outages may only affect some features?
- Is localisation required within 12 months? If yes, reserve locale-aware
  content paths now.

---

## 17. Appendices

### A. Proposed domains and URLs

```text
https://docs.akoro.ng/
https://docs.akoro.ng/start/getting-started
https://docs.akoro.ng/reference/api
https://docs.akoro.ng/reference/errors
https://docs.akoro.ng/changelog
https://docs.akoro.ng/changelog/rss.xml
https://docs.akoro.ng/changelog/feed.json
https://status.akoro.ng/
```

### B. API module inventory by tier

Verify exact route counts in Phase 0.

| Tier | Modules |
| --- | --- |
| 1 | `auth`, `records`, `courses` / stream, `programmes`, `public-catalog`, `contact` |
| 2 | `learner-goals`, `self-study`, `adaptive-learning`, `communities`, `blogs`, `instructor`, `school`, `profiles` |
| 3 | `admin`, `agentConsole`, `agent-network`, `agent-proposals`, `agent-ratings`, `agent-tools`, `tasks`, `workflows`, `voice`, `verify` |
| Private | internal callbacks, secret-guarded routes, admin security operations |

### C. Status monitor table

| Component | Probe | Owner |
| --- | --- | --- |
| API | `/health` + deep check | Platform |
| Learner | Synthetic login + dashboard | Learner owner |
| Instructor | Synthetic login + course list | Instructor owner |
| School | Synthetic login + portal | School owner |
| Admin | Synthetic login | Admin owner |
| Database | Deep health query | Platform |
| R2 | Signed write/read/delete probe | Platform |
| Media worker | `/edge-health`, `/healthz`, queue age | Media owner |
| Extraction | Backlog and failure rate | Records owner |
| AI providers | Provider health + error rate | AI owner |
| Email/SMS | Send test | Platform |
| Payments | Webhook and checkout probe | Payments owner |

### D. Changelog frontmatter

```yaml
---
title: ""
date: YYYY-MM-DD
type: feature | improvement | fix | security | api
audience: [learner, instructor, school, admin, developer, partner]
apps: [learner, instructor, school, admin]
api: none | additive | deprecation | breaking
version: ""
breaking: false
---
```

### E. Changelog labels

```text
changelog:feature
changelog:improvement
changelog:fix
changelog:security
api:additive
api:deprecation
api:breaking
docs
```

### F. Glossary

| Term | Meaning |
| --- | --- |
| Record | A library material: PDF, image, audio, video, paste or link |
| Extraction | Text/OCR/transcript processing of a record |
| Encode | Turning a course-video source into HLS renditions |
| Variant | One rendition such as 360p or 1080p |
| Fan-out | One container per rendition, coordinated by the API queue |
| Tier-1 endpoint | Public, supported and documented in v1 |
| Stable code | Machine-readable error code that will not change silently |
| Sandbox | `sandbox.akoro.ng`, isolated database for examples |
| Status component | A user-facing service shown on the status page |

---

## 18. Definition of done

This plan is complete when:

- the docs site is live and owned;
- Tier-1 endpoints are generated from a validated OpenAPI contract;
- every public route has a CI coverage decision;
- the changelog publishes product and API changes through an owned workflow;
- the status page is independent, monitored and has an incident drill on record;
- security has reviewed public content;
- the team knows who updates docs, who publishes incidents and how rollback
  works.
