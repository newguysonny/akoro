# AI activity creation with human-in-the-loop (instructor app) — draft plan

> Status: PROPOSED (brainstorm v1). Not built yet. Written after mapping every
> seam this feature touches; all file references verified against the branch.

## The one-sentence shape

The instructor's AI chat gains creation tools that can prepare an activity
draft using the activities bench's own data shapes — but **assigning is never
a tool**: the agent's done-message carries a Preview button, the instructor
previews (and can edit) it, and the Assign button inside that preview is the
only path that touches learners. Agents propose; humans commit.

## Why this is safe by construction

Today `POST /api/self-study` (the bench) creates **and assigns in one shot** —
targets are upserted, learners are notified and dinged immediately. That is the
"potentially dangerous action". The HITL design split is therefore:

- agent-safe: writing a **private draft** (nobody notified, nothing assigned)
- human-only: turning a draft into a real assignment (the Assign button)

The model has no tool that reaches `self_study_assignments` or
`self_study_targets`. Not "isn't allowed to" — *has no tool that can*.

## Current seams (verified)

| Seam | Fact |
|---|---|
| Instructor chat endpoint | `ChatPage.jsx` posts JSON to `/api/adaptive/chat/agent` with `role: 'instructor'`; the server independently resolves role from `req.user.role` (chat.js ~L1692) |
| Instructor tools today | **None** — `/agent` passes `tools: []` for non-students (chat.js ~L1785). We are adding the first instructor tool loop. |
| Tool loop | `runAgentToolLoop` + `executeChatTool` + `CHAT_TOOLS`/`openAiChatTools`; `toolExecutions` entries carry `{tool, success, requestId, sideEffecting}` and already travel in the non-streaming JSON reply (chat.js ~L1866) — so the chat UI can react without any streaming work |
| Creation payload | `POST /api/self-study` body: `{title, subject, topic, subtopics[], objectives{}, instructions, difficulty, due_at, course_id, classroom_id, usernames[], user_ids[], whole_class, type ∈ self_study|assignment|project|live_course|multi_stage, details{}}` — the draft must store exactly this shape so assign can replay it |
| AI plan generator | `POST /api/self-study/plan` → `nana.generateSubtopics` + `generateObjectives` — the same generator the workbench form uses; the draft tool should reuse it so AI output matches the bench's shape |
| Audience resolution | `resolveStudents({usernames, user_ids, classroom_id, course_id, whole_class})` already exists — reuse for draft-time candidate resolution; the human confirms in preview |
| Role gate | `TEACHER_ROLES` + `requireRole` on every bench route; instructor app is English-only (no i18n pass needed) |
| HITL precedent | `submit_tool_request` (request-queue pattern) and the learner's autonomy opt-in — but neither approves side effects; this feature adds the first real approval gate |
| Standing rule | Never fork a second form (BattleForm rule) — preview/edit must reuse `ActivityForm` (ActivitiesPage.jsx L112), not a parallel editor |

## Tools — 3 (+1 optional)

| # | Tool | Kind | What it does |
|---|---|---|---|
| 1 | `prepare_activity` | writes a draft (side-effecting) | Takes `{type, subject, topic, title?, subtopics?, objectives?, instructions?, difficulty?, due_hint?, audience_hint?}`. Server fills gaps via the nana plan generator, resolves audience hints to candidates (`resolveStudents`/classroom lookup by name), inserts an `activity_drafts` row, returns `{draftId, title, type, subject, audienceLabel}`. Execution entry gains a small `data` echo so the chat can render the Preview button. |
| 2 | `list_activity_drafts` | read-only | The instructor's pending drafts — lets the agent answer "what did I prepare?" and re-attach a Preview button in a later message. |
| 3 | `discard_activity_draft` | safe | Marks a pending draft discarded (a draft has no audience, so discarding touches nobody). |
| 4 | `list_my_classrooms` (optional, phase 3) | read-only | Only if we want the agent to browse classes/subjects conversationally instead of resolving hints server-side. Recommend deferring. |

**Never a tool:** assign, edit, publish. Editing happens in the preview UI
(human), assigning is the Assign button (human).

## New HTTP endpoints — 5

All under the self-study module, `requireRole(TEACHER_ROLES)`, ownership-checked
(`created_by === req.user.id`):

1. `GET /api/self-study/drafts` — pending drafts (chat reload + workbench badge later)
2. `GET /api/self-study/drafts/:id` — full draft for the preview modal
3. `PATCH /api/self-study/drafts/:id` — human edits before assign (re-validates like the bench: type, subject, topic)
4. `POST /api/self-study/drafts/:id/assign` — **the approval**. Body: audience + due override → re-resolves students server-side → runs the *same* insert/targets/notify/socket path as the bench (extract that path into a shared `createAssignment()` service both the bench route and this endpoint call — one code path, no fork) → draft becomes `assigned` with `assignment_id` set → returns the assignment + assigned count
5. `DELETE /api/self-study/drafts/:id` — discard

The `prepare_activity` tool does **not** need an HTTP endpoint — the executor
calls the shared `createActivityDraft()` service in-process (same pattern as
`createLearnerToolRequest`).

## States

**Server — draft lifecycle (4):**

```
draft ──(assign)──▶ assigned   (terminal, assignment_id set)
  ├──(discard)─▶ discarded     (terminal)
  └──(TTL 7d)──▶ expired       (lazy sweep on read; no cron needed for v1)
```

**Preview modal (5):** `loading → ready ⇄ editing → assigning → assigned | error`
(discarded returns to the chat with the button disabled).

**Chat message states per draft (3):** `Preview available → Previewed/edited →
Assigned ✓ (n learners)` or `Discarded`.

**Tool-loop states:** reuse the existing `toolExecutions` semantics —
`prepare_activity` joins the `sideEffecting` list; success/failed flows through
`observation.success` exactly like `create_task`.

## Data model — 1 migration

`migrations/2026-activity-drafts.sql` (register in manifest.json):

```sql
CREATE TABLE IF NOT EXISTS activity_drafts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id     UUID,
  type          TEXT NOT NULL,                 -- ACTIVITY_TYPES (no live_course for v1)
  title         TEXT NOT NULL,
  subject       TEXT NOT NULL,
  topic         TEXT NOT NULL,
  subtopics     JSONB NOT NULL DEFAULT '[]',
  objectives    JSONB NOT NULL DEFAULT '{}',
  instructions  TEXT,
  difficulty    TEXT NOT NULL DEFAULT 'intermediate',
  due_hint      TEXT,                          -- 'Friday at 1 PM' as the agent heard it
  payload       JSONB NOT NULL DEFAULT '{}',   -- the exact bench-shaped create body assign will replay
  audience      JSONB NOT NULL DEFAULT '{}',   -- resolved candidates + label for preview
  status        TEXT NOT NULL DEFAULT 'draft', -- draft|assigned|discarded|expired
  assignment_id UUID,                          -- set on assign
  source        TEXT NOT NULL DEFAULT 'ai_chat',
  session_id    UUID,                          -- the chat session that produced it
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_activity_drafts_instructor ON activity_drafts(created_by, status);
```

Guards: cap ~20 open drafts per instructor (oldest auto-expires); assign
re-validates everything the bench validates (type enum, topic/subject/title,
audience resolution) — the draft is a proposal, never trusted input.

## Instructor app UI — 2 components + 1 message tweak

1. **ChatPage.jsx**: on a successful `prepare_activity` execution in
   `toolExecutions` (with its `data` echo), render a **Preview** button under
   the agent bubble; after assign/discard, swap the button's state (the modal
   reports back). No streaming changes — instructors are non-streaming today.
2. **ActivityPreviewModal.jsx** (new): fetches the draft, renders the brief
   exactly as learners will see it (title/subject/topic/subtopics/objectives/
   instructions/difficulty/due) + audience summary chip; **Edit** toggles the
   reused `ActivityForm` prefilled from the draft (BattleForm rule: no forked
   editor); **Assign** (audience picker when the draft has no resolved class)
   and **Discard** in the footer; assigned state shows the count + link to
   `/activities`.
3. Optional phase 3: a pending-drafts strip on the Activities workbench
   (approval outside chat), mirroring NowGrading.

## chat.js wiring

- `openAiInstructorTools()` — the 3 tool definitions, returned only when
  `role === 'instructor'`; `/agent` passes it instead of `[]`
- `executeChatTool` gains the 3 cases, each hard-gated
  `if (role !== 'instructor') return { error }` (defense in depth — student
  tools and instructor tools can never cross)
- `prepare_activity` added to the `sideEffecting` list
- `tutorSystemPrompt` instructor branch (+ HITL honesty addendum): "you prepare
  drafts; you never assign, notify, or claim an activity is live — the
  instructor previews and assigns"
- `get_agent_capabilities`: instructor branch lists the new tools
- `TOOL_OBSERVATION_GUIDE` extended to instructors so the reply confirms from
  the tool result ("Draft ready — awaiting your preview", not "I've assigned it")

## Tests — 1 contract file (~5 tests)

`migrations/activity-drafts.contract.test.mjs`, in the established style:

1. migration pins (table, status enum, assignment_id, index, manifest)
2. instructor tools exist / student tool set untouched (role cross-gating)
3. assign endpoint = the bench path (shared service, notify + `self_study_assigned` emit), `TEACHER_ROLES` + ownership 404/403
4. assign is never registered as a chat tool; `prepare_activity` is side-effecting
5. ChatPage renders Preview from `toolExecutions`; preview modal has Assign + Discard + reused ActivityForm (no forked editor)

## Build order

- **Phase 1 — backend core:** migration + shared draft/assign services + tool defs + executor cases + role-gated tool loop + 5 endpoints + contract tests
- **Phase 2 — instructor UI:** ChatPage button + ActivityPreviewModal (states above)
- **Phase 3 — polish:** workbench drafts strip, `list_my_classrooms`, multi_stage support, TTL cron if lazy sweep proves insufficient

Effort feel: Phase 1 ≈ the suggestions feature (moderate); Phase 2 ≈ the
Submissions modal (the biggest single piece, because of the form reuse).

## Decisions (locked by product, then built)

1. **All six workbench types** are draftable — `self_study`, `assignment`, `project`, `live_course`, `multi_stage`, `battle`. Journeys stage through the shared create path; battles complete through the one shared BattleForm inside the preview.
2. **Audience comes from the instructor's prompt** — `audience` is a required tool input; when it's missing the tool returns `audience_required` / `needsClarification` and the agent asks instead of guessing. Resolved candidates + counts are shown in the preview.
3. **Preview is side-by-side with the chat** (not a modal): the chat column narrows, a 430px panel opens beside it (`ActivityPreviewPanel`); below ~1100px it becomes a full-screen overlay. Assign and Discard live in the panel footer; Edit reuses `ActivityForm` pointed at the draft-assign endpoint.

## Implemented (this branch)

- `migrations/2026-activity-drafts.sql` + manifest entry
- `modules/self-study/createAssignment.js` — the ONE create path (validation, `resolveStudents`, insert, targets, notify, socket ding); `POST /api/self-study` is now a thin wrapper
- `modules/self-study/drafts.js` — draft lifecycle (draft → assigned | discarded | expired), nana plan-fill, audience resolution + clarification, journey staging, 20-open-draft cap
- 5 endpoints under `/api/self-study/drafts…` (list / get / patch / assign / discard), `TEACHER_ROLES` + ownership
- chat.js: `INSTRUCTOR_TOOLS` (prepare_activity / list_activity_drafts / discard_activity_draft), role cross-gating in `executeChatTool`, instructor tool loop armed in `/agent`, `INSTRUCTOR_HITL_GUIDE` (never claims assigned), draft echo on `toolExecutions`
- Instructor UI: `ActivityPreviewPanel.jsx`, ChatPage Preview buttons + side-by-side split, `ActivityForm` prefill (`initial`) + `savePayload` seam — no forked form
- Contracts: `activity-drafts.contract.test.mjs` (6 tests); activity-workbench pins updated to the shared service

Still open (phase 3): `list_my_classrooms` tool, TTL cron if the lazy sweep/cap proves insufficient.

## Production hardening + premium layer (shipped)

Hardening:
- **Race-safe assign** — claim-first (`UPDATE … WHERE status='draft'` wins before any creation); losers get 409; failed creations and battle drafts **release the claim** so the human can retry.
- **Lazy 7-day TTL** — `expireStaleDrafts` sweeps stale pending drafts on read; no cron.
- **Prepare rate cap** — 10/hour/instructor (each prepare runs the LLM plan generator).
- **Precise due times** — `due_at` (ISO, create_task convention) alongside the `due_hint` label; unresolvable times stay hints, past dates rejected. Shown as a resolved "Due … set" row in preview.
- **Task-run drafts nudge the instructor** — `channel: "task_run"` from the gateway stores `source` and files a bell notification (`activity_draft_prepared` → /activities); chat drafts stay bell-free (they carry their own Preview button).
- **Kill-switch** — `AKORO_ACTIVITY_DRAFTS_ENABLED=false` removes the draft tools from the chat loop AND the gateway catalogue in one move.

Premium:
- **Streaming status** — the instructor chat now speaks SSE (`?stream=1`): "Checking your Akoro study data…" style status events render under the typing dots; one honest JSON fallback if the stream never starts.
- **`list_my_classrooms`** — the agent confirms class names/counts before preparing; never fuzzy-guesses an audience.
- **Audience names** — picked audiences resolve up to 8 real usernames into the preview (chips + "+N more").
- **Revision chips** — `revise_activity_draft` stamps `payload.last_change`; the panel shows "✏️ what changed · time" so re-preview is a glance.

## Bigger bets (scoped, next)

- **Recurring routines, human-approved** — "Every Friday, prep a multiplication drill battle": a routines table + weekly scheduler that PREPARES drafts; the human still assigns each one (HITL-consistent automation).
- **Batch flows** — "Prep this week's activities" → multiple drafts in one turn → a queued preview strip.
- **Outcomes → drafts** — `check_activity_outcomes` over GET /:id/analytics: "your osmosis assignment averaged 54% — prepare a revision self-study?" 

## Assignment feedback + conversational revision (shipped)

- **Assign/discard lands in the conversation** (Q1): resolving a preview pushes a chat message ("✅ Assigned — the learners on this draft have been notified…"), so the instructor sees the outcome and the agent carries it in history next turn. The LEARNERS are always notified by the platform itself at assign time (notification + live ding) — no agent relay involved, or needed.
- **Conversational revision** (Q2): `get_activity_draft` (read the real plan before editing) + `revise_activity_draft` (model writes the revised content; server validates shape and persists — pending drafts only, topic immutable). "Question 2 too difficult" → agent reads the draft, rewrites entry 2, the Preview button re-renders, and an open side-by-side panel refreshes in place via a `revision` signal. The python gateway serves both tools to teacher task runs as well.

## Follow-up (shipped same branch)

- **Universal no-guess clarification** — `clarify()` is the one shape every tool returns for an unstated required input (`needsClarification/missing/question`); the base prompt (both roles) now carries the missing-details rule, `create_task`, `schedule_chat_follow_up`, `cancel_scheduled_chat_follow_up` and `prepare_activity` all clarify instead of guessing/failing, and `get_agent_capabilities` admits the behaviour. The python teaching agent's rules carry the same line.
- **Python agent inherits the activities tools** through the private gateway (`modules/agent-tools/routes.js`): `teacher_task` scope appends `prepare_activity` / `list_activity_drafts` / `discard_activity_draft` after the task tools (catalogue cap reserves room), and `/invoke` routes them to `executeChatTool(…, { role: "instructor" })` — drafts touch the principal's own account, never the task's course scope, and never become learner write-confirmable tools.
- **Workbench drafts strip** — `ActivitiesPage` shows pending AI-prepared drafts (from chat or python task runs) with Preview → `ActivityPreviewPanel` in a modal; nothing reaches a learner without the instructor's Assign.
