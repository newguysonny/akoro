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

## Open questions (block Phase 1)

1. **Activity types in v1** — recommend `self_study`, `assignment`, `project` first; `multi_stage` (journey blocks) and `live_course` later. Confirm?
2. **Audience authority** — agent proposes (resolved candidates shown in preview, human confirms/edits)? Or audience always picked fresh by the instructor in the modal?
3. **Drafts visible outside chat in v1** — workbench strip from day one, or chat-only first?
