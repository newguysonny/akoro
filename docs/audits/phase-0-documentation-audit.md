# Phase 0 Documentation Audit

| Field | Value |
| --- | --- |
| Status | Phase 0 complete — audit only, no documentation implementation started |
| Date | 2026-11-25 |
| Scope | Discover what exists before writing the Platform Documentation System |
| Parent plan | `docs/PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md` |
| Public subplan | `docs/PUBLIC-DOCS-CHANGELOG-STATUS-PLAN.md` |
| Artifacts | `docs/audits/phase-0/*.csv` |

---

## 1. Purpose

Phase 0 answers one question before any public docs are written:

> What does Akoro actually have, who can use it, and what must be documented
> first?

This audit inventories routes, apps, features, data models, integrations,
existing documentation and gaps. It deliberately does **not** claim that every
observed route is production-ready or publicly supported. Statuses in this
document are provisional until verified by domain owners and contract tests.

---

## 2. Method and limitations

### 2.1 Method

Static scans were run against the repository:

- Express route declarations in `akoro-api/modules/**/*.js`.
- Mount points in `akoro-api/app.js`.
- React routes in `akoro-{learner,instructor,school,admin}/src/App.jsx`.
- Table definitions in `akoro-api/migrations/*.sql`.
- Environment keys in `akoro-api/.env.example`.
- Dependencies in `akoro-api/package.json`.
- READMEs and existing docs under `akoro-api/modules/*/README.md` and `docs/`.
- Test files under the API, learner, instructor, school and admin apps.

### 2.2 Limitations

- Route counts are **static declarations**, not a deduplicated runtime Express
  route table.
- Some paths are constructed dynamically, use regex, or are mounted by nested
  routers; the scan is a floor, not an exact OpenAPI surface.
- Access classification by line-level middleware is approximate. Many routes
  are protected by router-level guards (`router.use(authenticateToken)`),
  helper middleware or key guards. The CSV includes the source snippet so a
  human or runtime extractor can verify each route.
- Feature status is based on code presence, comments, tests and UI strings. It
  is not a product sign-off.
- No production traffic, customer data or private credentials were used.
- No runtime route-table extraction was performed in this phase.

### 2.3 Reproducibility

The audit used static scans and generated the CSVs listed in section 14. Phase 1
should replace the heuristic access classification with a runtime Express route
table and a docs coverage test.

---

## 3. Scale summary

| Metric | Count | Notes |
| --- | ---: | --- |
| API modules | 49 | Every module has a README |
| Modules with route declarations | 41 | Some modules are services only |
| Top-level `routes.js` files | 34 | Many modules split routes across files |
| API route declarations | 1,114 | Static scan; includes nested routers |
| App routes | 411 | 55 learner, 56 instructor, 245 school, 55 admin |
| SQL migrations | 321 | Boot-applied schema and demo groups |
| Database tables | 434 | Across six schemas |
| API test files | 418 | Module-local total: 311 |
| Learner test files | 44 | Source-contract/UI tests |
| Instructor test files | 1 | Sparse compared with API |
| School test files | 2 | Sparse compared with surface area |
| Admin test files | 0 | No app-local tests found |
| Environment keys | 132 | `.env.example` |
| Module READMEs | 49 | Maintainer-focused |
| Existing `docs/` files | 10 | Includes plans and internal notes |

This is not a small documentation job. It is a platform with a full school ERP,
a large learner AI/learning surface, an instructor console, an admin console,
a media pipeline and an agent runtime.

---

## 4. Route inventory

### 4.1 Modules by route declarations

| Module | Routes | Tier | Observation |
| --- | ---: | --- | --- |
| school | 177 | Tier 2/3 | Full school ERP; must be documented by module group, not endpoint |
| admin | 172 | Tier 3 | Internal admin; publish only safe summaries |
| adaptive-learning | 107 | Tier 2 | Learner AI, teaching, study prep, exam prep, assessments, marketplace |
| courses | 89 | Tier 1 | Mixed public catalogue, learner, instructor, payments, media |
| battle | 45 | Tier 2 | Learner competition surface |
| records | 43 | Tier 1 | Library, extraction, ask/grounding, study material |
| self-study | 43 | Tier 2 | Assignments, drafts, routines, grading |
| vouchers | 38 | Tier 2 | Voucher products, wallets, settlements |
| agent-network | 36 | Tier 2/3 | Agent discovery, messaging, challenges |
| instructor | 32 | Tier 2 | Instructor dashboard and management |
| profiles | 30 | Tier 2 | User/profile surfaces |
| agent-tools | 27 | Tier 3 | Agent tool execution and confirmations |
| programmes | 26 | Tier 1 | Public catalogue + admin curriculum management |
| tasks | 24 | Tier 3 | Task automation and admin tools |
| agentConsole | 22 | Tier 3/private | Key-guarded console; never public API docs |
| communities | 21 | Tier 2 | Study groups and activity |
| content | 21 | Tier 1 | Public blog/careers + admin CRUD |
| auth | 16 | Tier 1 | Registration, login, 2FA, OAuth, reset |
| materials | 15 | Tier 2 | Library/chat uploads into folders |
| past-questions | 15 | Tier 2 | WAEC/NECO/JAMB/NCEE bank |
| course-builder | 13 | Tier 2 | Instructor course creation |
| self-tooling | 12 | Tier 3 | Learner-built tools |
| curriculum | 11 | Tier 2 | NERDC-style curriculum bank |
| pharmd | 9 | Tier 1 | Public PharmD catalogue + learner progress |
| workflows | 9 | Tier 3 | Workflow events/dashboard |
| wallet | 8 | Tier 2 | Learner balance and transactions |
| agent-proposals | 6 | Tier 3 | Full-autonomy proposal inbox |
| teaching | 6 | Tier 2 | Direct teaching workflow |
| verify | 6 | Tier 3/private | Key-guarded verification gate |
| autonomy | 5 | Tier 3 | Autonomy runs |
| blogs | 5 | Tier 2 | Learner-authored blogs |
| learner-goals | 4 | Tier 2 | Educational goals |
| voice | 4 | Tier 3 | Transcription/speech |
| agent-ratings | 3 | Tier 3 | Agent ratings |
| capability-requests | 3 | Tier 3 | Capability requests |
| contact | 3 | Tier 1 | Public contact intake + admin inbox |
| hfmirror | 3 | Tier 3/private | Hugging Face mirror console |
| ranking | 2 | Tier 2 | Leaderboards |
| billing | 1 | Tier 1/provider | Subscription checkout and webhook |
| pilot-applications | 1 | Tier 1 | Public pilot-school application |
| webhooks | 1 | Tier 1/provider | Unified Paystack webhook |

Full data: `docs/audits/phase-0/module-inventory.csv`.

### 4.2 Route declarations by tier

| Tier | Route declarations | Meaning |
| --- | ---: | --- |
| Tier 1 | 210 | Candidate public/core API documentation |
| Tier 2 | 608 | Authenticated learner/instructor/school areas |
| Tier 3 | 296 | Admin, agent internals, private consoles |
| Total | 1,114 | Static declarations |

Tier 1 does **not** mean 210 public endpoints. It means 210 declarations across
modules that need a public-facing or core developer story. Many are
role-gated, and the public subset is much smaller.

### 4.3 Public route candidates

The static scan identified public, setup-token, provider-signed and key-guarded
entry points. Full list:
`docs/audits/phase-0/public-route-candidates.csv`.

High-level groups:

| Group | Examples | Auth model |
| --- | --- | --- |
| Auth | register, login, verify, refresh, 2FA login, forgot/reset, Google OAuth | Public, rate-limited |
| Public catalogue | `/api/courses/published`, `/api/courses/:idOrSlug/full`, `/api/live-sessions`, `/api/instructors/featured` | None |
| Programmes | `/api/programmes/catalogue`, `/catalogue/:id`, `/catalogue/courses/:id` | None |
| PharmD | `/api/pharmd/programme`, `/courses/:code`, `/topics/:id/file` | None |
| Marketplace | listings, search, verify reference, payment callback | None or reference-based |
| Content | blog posts, categories, subscribe, careers, job apply | None |
| Intake | `/api/contact`, `/api/public/pilot-applications` | None |
| Health | `/health`, `/api/tasks/health` | None |
| Provider webhooks | `/api/webhooks/paystack`, `/api/payments/verify`, `/api/payouts/webhook`, marketplace webhook | Signature |
| Key-guarded | `/api/verify`, `/api/agent-console`, `/api/hf`, internal ticks/stream callbacks | Shared secret |

Approximately **40 public entry points** are candidates; exact count must be
confirmed with a runtime route table before publication.

### 4.4 Access findings

- Most modules are protected by JWT and/or role guards.
- `admin`, `school`, `instructor`, `agent-tools`, `agentConsole`, `verify` and
  `hfmirror` contain privileged surfaces that must not be public.
- Public catalogue routes are explicitly implemented before admin guards in
  `programmes`, `courses`, `pharmd` and `content`.
- Webhooks rely on signature verification, not JWT.
- Internal callbacks and verification/console routes rely on shared secrets.
- The line-level heuristic could not classify 259 declarations. These require
  manual or runtime verification; many are protected by router-level guards.

**Do not publish from the route CSV alone.** The public allow-list must be
explicit and reviewed.

---

## 5. App and feature inventory

### 5.1 App route counts

| App | Routes | Dominant areas |
| --- | ---: | --- |
| Learner | 55 | Dashboard, library, AI protégé, teaching, study/exam prep, communities, battles, wallet, public marketing |
| Instructor | 56 | Courses, course builder, students, submissions, assessments, tasks, wallet, documents, management |
| School | 245 | Full school ERP: students, staff, academics, fees, HR, exams, inventory, transport, hostel, website builder |
| Admin | 55 | Platform operations, billing, agents, content, analytics, approvals |
| Total | 411 | |

Full data: `docs/audits/phase-0/app-route-inventory.csv`.

### 5.2 Feature inventory (provisional)

`implemented` here means "code and tests/routes observed"; it is not production
sign-off. `beta` means the surface exists but is broad, recent, partial or has
"coming soon" states. `planned` means not in the observed code.

| Area | Evidence | Provisional status | Docs tier |
| --- | --- | --- | --- |
| Authentication, sessions, 2FA, Google OAuth, password reset | `auth` 16 routes, 9 tests | Implemented | Tier 1 |
| Roles/portals (learner/instructor/school/admin) | Auth rules, app guards, `X-Akoro-Portal` | Implemented | Tier 1 |
| Learner dashboard and onboarding | Learner routes `/`, `/onboarding`, `/app` | Implemented | Tier 2 |
| AI protégé / agent chat / teaching sessions | `adaptive-learning` 107 routes, chat/teaching modules, verify scenarios | Implemented/beta | Tier 2 |
| Study Prep, Exam Prep, Decay Review | `adaptive-learning` routes/tables; verify scenarios | Implemented/beta | Tier 2 |
| Practice and assessments | `assessment_sessions`, past questions, learner/instructor assessment pages | Implemented | Tier 2 |
| Library uploads, extraction, reader, ask, study material | `records` 43 routes, 37 tests, extraction/retrieval modules | Implemented | Tier 1 |
| Learner memory, concept state, goals, progress | `learner_concept_state`, `learner_agent_memories`, goals routes | Implemented/beta | Tier 2 |
| Communities | `communities` 21 routes, app pages | Implemented | Tier 2 |
| Battles and agent network | `battle` 45 routes, `agent-network` 36 routes | Implemented/beta | Tier 2/3 |
| Self-study assignments, drafts, routines, grading | `self-study` 43 routes, 16 tests | Implemented/beta | Tier 2 |
| Instructor course creation, live/on-demand courses | `course-builder` 13 routes, `courses` pages | Implemented/beta | Tier 2 |
| Instructor students, submissions, assessments, tasks | Instructor routes; self-study/tasks APIs | Implemented | Tier 2 |
| Course media upload, queue/fan-out encode, HLS, subtitles | `stream.js`, `mediaEncodeQueue.js`, `media-worker`, `videos` tables | Implemented/beta | Tier 1/2 |
| School ERP: admissions, students, attendance, academics, fees, HR, payroll, exams, timetable, library, inventory, transport, hostel, assets, website, settings | 245 app routes, 177 API declarations, 128 `mgmt` tables | Beta | Tier 2/3 |
| Admin operations: users, instructors, schools, courses, approvals, content, analytics, billing, agents, prompts, evals | 55 app routes, 172 API declarations | Implemented/beta | Tier 3 |
| Programmes and curriculum | `programmes` 26, `curriculum` 11, tables | Implemented | Tier 1/2 |
| Past questions / exam bodies | `past-questions` 15, `past_questions` tables | Implemented | Tier 2 |
| PharmD programme | `pharmd` 9, app pages; some learner course states "coming soon" | Implemented/beta | Tier 1 |
| Payments, wallets, payouts, vouchers, subscriptions | `vouchers` 38, wallet 8, Paystack modules, billing | Implemented/beta | Tier 1/2 |
| Notifications: email, SMS, push, in-app | Notifications module, Resend/SendGrid/Twilio/VAPID | Implemented | Tier 2 |
| Public content: blog, careers, contact, pilot applications | `content` 21, `contact` 3, `pilot-applications` 1 | Implemented | Tier 1 |
| Agent runtime, tools, memory, proposals, autonomy, ratings, self-tooling | Agent modules, 100+ agent tables, verify scenarios | Implemented/beta | Tier 3 |
| Verification gate, agent console, HF mirror | Key-guarded modules | Implemented/internal | Tier 3/private |
| Public docs site, API reference, changelog, status page | Not in code | Planned | Program |

### 5.3 Partial / coming-soon observations

Examples found in UI or comments:

- Learner PharmD course content: "Courses for [year] are coming soon".
- Some learner teaching media: playable/rendered episodes "coming soon"; audio
  "coming soon".
- Some battle activity tabs: create activity/agent session "coming soon".
- Admin billing/tiers pages reference Phase 3/5 work; some features are
  intentionally not rendered until the gateway exists.

These must be marked `beta` or `planned` in docs. They must not be described as
available capabilities.

### 5.4 Feature inventory conclusion

The codebase contains far more than an API. The documentation must be
capability-centred and grouped by domain. A flat endpoint catalogue would be
unusable for learners, instructors, schools, admins or agents.

---

## 6. Data model inventory

### 6.1 Scale

| Schema | Tables | Meaning |
| --- | ---: | --- |
| `edu` | 183 | Learning, agents, curriculum, records, school extensions, workflows |
| `mgmt` | 128 | School ERP |
| public schema (`public.*`) | 26 | Billing, subscriptions, coins, contact, settings |
| unqualified tables (default `public`) | 76 | Core users, courses, lessons, videos, payments, battles, tasks |
| `vouchers` | 15 | Voucher products, wallets, settlements, webhooks |
| `content` | 6 | Blog, jobs, applications |
| Total | 434 | 321 migrations |

Full data: `docs/audits/phase-0/table-inventory.csv`.

### 6.2 Core entity groups

| Domain | Core tables | Notes |
| --- | --- | --- |
| Identity | `users`, `refresh_tokens`, `revoked_tokens`, `user_settings`, `profiles`-adjacent tables | Auth and portal roles |
| Courses | `courses`, `course_modules`, `lessons`, `enrollments`, `lesson_progress`, `videos`, `video_progress`, `live_sessions`, `certificates`, `reviews` | Learner/instructor core |
| Library | `edu.records`, `edu.record_artifacts`, `edu.record_chunks`, `edu.record_chat_messages`, `edu.pdf_extraction_cache`, `edu.library_folders`, `edu.library_folder_items`, `edu.material_ingests` | Upload, extraction, retrieval |
| Learning | `edu.study_prep_sessions`, `edu.study_prep_topics`, `edu.adaptive_sessions`, `edu.assessment_sessions`, `edu.learner_concept_state`, `edu.learner_concept_evidence`, `edu.learner_goals`, `edu.workflow_instances`, `edu.workflow_events` | Learning engine and evidence |
| Agent | `edu.agent_runs`, `edu.agent_run_steps`, `edu.agent_tool_invocations`, `edu.agent_tools`, `edu.agent_tool_requests`, `edu.agent_tool_write_confirmations`, `edu.agent_proposals`, `edu.learner_agent_memories`, `edu.capability_grants` | Runtime, tools, memory, approvals |
| Curriculum | `edu.curriculum_*`, `edu.syllabus_*`, `edu.past_questions`, `edu.past_papers`, `edu.programmes`, `edu.programme_*`, `edu.pharmd_*` | Content hierarchy |
| School | `mgmt.*` (128), `edu.school_*`, `school_profiles`, `school_teachers` | Full ERP and school settings |
| Payments | `payments`, `payment_items`, `payment_events`, `payouts`, `instructor_earnings`, `public.coin_*`, `public.subscriptions` | Paystack and wallet |
| Content | `content.blog_*`, `content.jobs`, `content.job_applications` | Public site |

### 6.3 Relationship example

```text
Learner (users)
  -> enrollments -> courses -> course_modules -> lessons -> videos
  -> lesson_progress / video_progress
  -> study_prep_sessions -> study_prep_topics
  -> adaptive/assessment sessions
  -> learner_concept_state -> learner_concept_evidence
  -> learner_goals
  -> learner_agent_memories
  -> workflow_instances -> workflow_events
```

### 6.4 Data sensitivity

High-sensitivity domains:

- learner identity and contact data;
- school student records, admissions, health, behaviour, fees, payroll;
- payment and payout data;
- agent conversations, memories and proposals;
- audit logs and verification evidence;
- API keys and vouchers.

Public docs must never use real learner/school data. Examples require demo
accounts and sandbox data.

### 6.5 Data documentation gap

There is no data dictionary, no documented ownership per table, no lifecycle
document, and no public entity-relationship documentation. The agent
documentation cannot reliably answer "what does this field mean?" from 434
tables alone.

---

## 7. Integrations and environment

### 7.1 Environment scale

- 132 environment keys in `akoro-api/.env.example`.
- Feature flags control learning/agent behaviour (`AKORO_*_ENABLED`).
- Production requires Supabase, JWT keys and Redis; missing critical env vars
  stop production boot.

### 7.2 Integration inventory

| Integration | Role | Configuration | Failure/fallback notes |
| --- | --- | --- | --- |
| Supabase | Postgres client, storage fallback, some platform data | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_RECORDS_BUCKET` | Records fallback bucket for small files when R2 unavailable |
| Postgres/Supavisor | Primary database, migrations | `DATABASE_URL`, `DB_READ_URL`, `MIGRATION_DATABASE_URL` | Boot migrations, advisory lock |
| Redis / BullMQ | Queues, workers, socket adapter | `REDIS_URL`, queue flags | Background jobs and media fan-out queue |
| Cloudflare R2 | Primary records/media/HLS storage | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | Supabase fallback for small records; breaker-protected |
| OpenCode Go / OpenAI / Anthropic | Chat and reasoning models | `OPENCODE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, model registry | Provider adapters, breakers, fallbacks |
| DeepSeek OCR | Scanned PDF/image extraction | `DEEPSEEK_API_KEY`, `DEEPSEEK_OCR_BASE_URL` | Vision-model fallback via `RECORDS_OCR_FALLBACK` |
| Deepgram | STT/TTS | Deepgram SDK/env | Voice routes and verify scenarios |
| RunPod | Embeddings and extraction worker | `RUNPOD_API_KEY`, `EMBEDDINGS_PROVIDER`, endpoint config | OpenAI embeddings fallback |
| Hugging Face | Model mirror console | `@huggingface/hub`, key-guarded console | Internal |
| Paystack | Checkout, subscriptions, payouts, vouchers | `PAYSTACK_*` | Signature verification, unified webhook dispatcher, breakers |
| Resend / SendGrid | Transactional email | `RESEND_*`, `SENDGRID_*`, SMTP | Notification delivery |
| Twilio | SMS | `TWILIO_*` | Notification delivery |
| Web Push | Browser push | `VAPID_*` | Subscription table |
| Zoom / Google Meet / Teams | Live course sessions | OAuth client IDs/secrets | Meeting integration |
| Google OAuth | Sign-in | `GOOGLE_CLIENT_*`, callback | Auth |
| Vercel | App deployments and domain automation | `VERCEL_TOKEN`, project/team IDs | Admin/app-center operations |
| Cloudflare media worker | HLS encode/extract container | `MEDIA_WORKER_URL`, `INTERNAL_SECRET` | Queue/fan-out, direct fallback |
| Render | API hosting | `render.yaml` | Auto-deploy on commit |
| Python agent service / lead-scout | Auxiliary services | `PYTHON_AGENT_SERVICE_URL`, `LEAD_SCOUT_URL`, secrets | Service-to-service |
| Socket.IO | Realtime chat/workflows | Redis adapter | Reconnect and auth |

### 7.3 Integration documentation gap

No integration document explains configuration, data shared, failure modes,
fallbacks, rate limits, or ownership. `env.example` and code comments are the
only sources.

---

## 8. Existing documentation coverage

### 8.1 What exists

| Asset | Coverage | Limitation |
| --- | --- | --- |
| `akoro-api/modules/*/README.md` | 49/49 modules | Maintainer-focused; not public, not status-tagged |
| `docs/ENGINEERING_GUARANTEES.md` | Engineering invariants | Internal |
| `docs/SECURITY_CHECKLIST.md` | Security review | Internal |
| `docs/llm-cost-model.md` | AI cost model | Internal |
| `docs/learner-smoke-test.md` | Learner smoke path | Internal |
| `docs/CHAT-COMMANDS.md` | Agent/chat commands | Internal |
| `docs/UI-AUDIT-learner-2026-09.md` | Learner UI audit | Historical |
| `reference/Grand Plan.md` | Product/architecture direction | Internal, broad |
| `docs/PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md` | Documentation strategy | Plan |
| `docs/PUBLIC-DOCS-CHANGELOG-STATUS-PLAN.md` | Public docs plan | Plan |
| `docs/README.md` | Docs index | Internal |

### 8.2 Coverage by documentation category

| Category | Existing state | Gap |
| --- | --- | --- |
| Platform overview | Scattered across READMEs and plans | No single public overview |
| Features | App code, module READMEs, UI | No standard feature docs or status labels |
| API | 1,114 declarations; no OpenAPI | No contract, reference, error catalogue or examples |
| Architecture | Module READMEs, `reference/Grand Plan.md` | No consolidated system/data/agent architecture |
| Learning methodology | Code, verify scenarios, learner UI | No methodology docs |
| Data models | 321 migrations, 434 tables | No data dictionary or entity docs |
| Agents | Deep code, verify scenarios, agent modules | No capability registry, workflows or context-loading contract |
| Integrations | Env and code | No integration docs or fallback matrix |
| Engineering | `AGENTS.md`, docs | No public/local development guide |
| Security/governance | `SECURITY_CHECKLIST.md` | No public governance/data classification |
| Quality | 418 API tests | No test strategy/quality docs |
| Changes/releases | None | No changelog, release notes, migrations or upgrade guides |
| Status | None | No status page or incident process |
| Search/discovery | None | No docs index, `llms.txt` or retrieval layer |

### 8.3 Documentation strengths

- Every module has a README, which is a strong starting point.
- Tests are extensive in critical domains, especially records, self-study,
  auth, battle and admin.
- The verification gate already provides executable scenarios for complex
  agent/learning behaviour.
- Existing plans define the architecture and public docs direction.

### 8.4 Documentation weaknesses

- Internal READMEs do not tell an external developer how to authenticate, call
  an endpoint, recover from an error, or know whether a feature is stable.
- There is no machine-readable API contract.
- There is no single capability catalogue.
- The school ERP alone is too large to document endpoint-by-endpoint.
- Many statuses are implicit in code comments or UI "coming soon" strings.
- There is no docs validation against the route table.

---

## 9. Proposed documentation tiers

### 9.1 Tier 1 — public/core developer surface

Candidate modules:

- `auth`
- `records`
- `courses` (published catalogue, learner course access, stream/media)
- `programmes` (catalogue subset)
- `pharmd` (catalogue subset)
- `contact`
- `content` (public reads and intake)
- `pilot-applications`
- `billing` / `webhooks` (provider-facing only)

Tier-1 scope:

- 210 route declarations.
- Roughly 40 public entry points.
- Core authenticated flows: library uploads, course access, media status.
- Auth, errors, pagination, uploads, webhooks, rate limits and versioning.

Tier-1 exclusions:

- admin imports and controls;
- school ERP;
- agent console/verify/HF mirror;
- internal ticks and worker callbacks;
- marketplace agent listings, unless product decides they are public API.

### 9.2 Tier 2 — authenticated product surfaces

- Learner learning/teaching/study/exam/practice/memory.
- Instructor course/assignment/grading/student management.
- School portal/ERP (grouped).
- Communities, battles, agent network, self-study, past questions, curriculum,
  wallet, vouchers, profiles, notifications.

### 9.3 Tier 3 / private

- Admin operations.
- Agent runtime internals, tools, proposals, autonomy, ratings, self-tooling.
- Tasks, workflows, voice, HF mirror.
- Verify gate and agent console.
- Internal callbacks and secret-guarded routes.

### 9.4 Documentation grouping for school ERP

Do not create 177 endpoint pages. Group by school module:

1. Admissions and front office.
2. Student records and wellbeing.
3. Attendance and behaviour.
4. Academics: classes, sections, subjects, timetable, syllabus.
5. Exams, marks, report cards, CBC.
6. Fees, accounts, income, expenses, challans.
7. HR: staff, payroll, leave, appraisals.
8. Library.
9. Inventory and procurement.
10. Transport.
11. Hostel.
12. Assets.
13. Communications: notices, events, broadcasts, gallery.
14. Website builder and domains.
15. Settings, roles, backups, audit.
16. AI help/chat.

Each group gets one overview, one workflow, and only the critical endpoint
reference.

---

## 10. Five candidate workflows for v1

These are proposed Phase 1 workflows. They combine capabilities and expose the
documentation gaps most likely to block developers and agents.

1. **Sign in and maintain a session**
   - Register/login → verification/2FA → refresh → portal header → logout.

2. **Upload a library record and use it**
   - Request upload URL → PUT to R2 → complete upload → wait for extraction →
     read/ask → generate study material → verify ownership.

3. **Plan and complete a Study Prep session**
   - Create session → confirm plan → start topic → practice → submit → results
     → next eligible transition.

4. **Publish a course video**
   - Create course/lesson → request direct upload → complete → queue encode →
     poll status → publish/play HLS.

5. **Discover and execute an agent capability**
   - Read capability registry → inspect API/tool contract → check permissions →
     execute → verify side effect → handle failure.

Optional school workflow:

6. **Onboard a school student**
   - Create/enrol student → assign class → fees → attendance → view progress.

---

## 11. Gaps and risks

| Gap/Risk | Severity | Impact | Mitigation |
| --- | --- | --- | --- |
| No OpenAPI contract | Critical | Public API docs would drift immediately | OpenAPI 3.1 for Tier 1; CI route coverage |
| No public/private allow-list | Critical | Internal/admin endpoints could leak | Explicit allow-list; security review |
| No capability registry | Critical | Agents cannot know what exists | Build `capability-registry.yaml` |
| Feature status implicit | High | Planned features mistaken for available | Status vocabulary + review |
| 259 unclassified route guards | High | Access labels may be wrong | Runtime route-table extraction |
| 434 tables, no data dictionary | High | Agents misread fields/relationships | Core entity docs first |
| No workflow docs | High | Agents combine endpoints incorrectly | Five v1 workflows |
| No docs CI | High | Docs rot after deploys | Link/schema/example/route checks |
| School ERP breadth | High | Documentation scope explosion | Group by module; Tier 2/3 |
| Learner/school PII | High | Privacy/security leak in examples | Demo data, security review |
| Agent permissions confusion | High | Docs treated as authorization | Backend enforcement + warning |
| Coming-soon features | Medium | False capability claims | `beta`/`planned` labels |
| 411 app routes / 1,114 API declarations | Medium | Readers cannot navigate | Capability-centred IA |
| Existing READMEs drift | Medium | Conflicting truth | Source-of-truth precedence |
| No changelog/status | Medium | Users lack release/incident clarity | Public subplan |
| No aggregate API test runner | Medium | Coverage hard to report | Add docs/test coverage report |
| 132 env vars | Medium | Setup docs missing | Environment reference |
| API authentication for partners unclear | Medium | Cannot publish integration guide | Decide session vs keys |
| Auto-deploy changes code often | Medium | Docs must ship with code | PR docs checklist + CI |

---

## 12. Decisions required before Phase 1

### 12.1 Recommended defaults

| Decision | Recommendation |
| --- | --- |
| Tier 1 modules | auth, records, courses (public/core), programmes catalogue, pharmd catalogue, content public, contact, pilot, payment webhooks |
| School ERP | Tier 2/3, grouped by module; not v1 public reference |
| Public docs framework | Next.js + Fumadocs in `akoro-docs/` |
| Canonical docs location | `akoro-documentation/` in the monorepo for v1 |
| API contract | OpenAPI 3.1 YAML |
| API versioning | `/api/v1` canonical, `/api` alias, 90-day deprecation |
| Status provider | Instatus or Better Stack |
| Capability registry | `capability-registry.yaml` with explicit statuses |
| Public auth for partners | Session cookie first; API keys only if a real partner need exists |
| v1 workflows | The five listed in section 10 |

### 12.2 Open questions

- Is the school ERP partner-facing in v1, or internal/beta only?
- Are marketplace agent listings a public API surface?
- Are admin endpoints ever partner-facing?
- Which five workflows are mandatory for v1?
- Who owns each Tier-1 module's API schemas and examples?
- Does Akoro need external API keys in v1, or only session auth?
- Which status provider is approved and budgeted?
- Is `akoro-documentation/` a monorepo folder or a separate repository?
- Is `/api/v1` approved?
- What is the approval policy for agent-proposed documentation updates?

---

## 13. Phase 1 entry criteria

Phase 1 should not start until:

- Tier-1 modules and public allow-list are approved.
- The five v1 workflows are selected.
- `/api/v1` policy is approved.
- Docs repository location and public framework are approved.
- Status provider is selected.
- Domain owners are assigned for Tier 1.
- Security approves the public/private boundary.
- A runtime route-table extractor is planned to replace line-level heuristics.
- Templates for feature, endpoint, workflow and data model docs are approved.

### 13.1 Phase 1 deliverables

1. `akoro-documentation/` structure.
2. `README.md`, `AGENTS.md`, `llms.txt`.
3. Feature/endpoint/workflow/data-model templates.
4. `documentation-index.json` schema and first entries.
5. `capability-registry.yaml` schema and first verified entries.
6. Tier-1 OpenAPI skeleton.
7. Runtime route-table extractor and docs coverage report.
8. Public docs shell (optional in parallel).

---

## 14. Audit artifacts

| Artifact | Contents |
| --- | --- |
| `docs/audits/phase-0/route-inventory.csv` | 1,114 static route declarations with file, line, method, path and source/guard snippet |
| `docs/audits/phase-0/module-inventory.csv` | 49 modules with route counts, tier, tests, README/index presence |
| `docs/audits/phase-0/app-route-inventory.csv` | 411 frontend routes with app and source line |
| `docs/audits/phase-0/table-inventory.csv` | 434 tables with migration origin |
| `docs/audits/phase-0/public-route-candidates.csv` | Public/setup/provider/key-guarded entry-point candidates |

These are audit inputs, not public docs. Do not publish them directly.

---

## 15. Phase 0 conclusion

Akoro has a large, capable platform with a strong internal engineering culture
but no external knowledge system.

The first documentation release should not attempt to document 1,114 route
declarations or 434 tables. It should:

1. Publish a small Tier-1 public/core surface.
2. Build a capability registry and five complete workflows.
3. Document the data models that those workflows touch.
4. Validate every published endpoint against the running code.
5. Keep the school ERP and admin console out of v1 public reference until their
   product status and privacy boundary are decided.

The most important next step is not the public website. It is the machine-readable
foundation: `AGENTS.md`, `openapi.yaml`, `capability-registry.yaml`,
`documentation-index.json`, and the first five workflow documents.
