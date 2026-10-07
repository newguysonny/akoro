# Learner Full Autonomy — Design Plan

Status: PROPOSAL (no code yet) · Author: session with the repo owner · Date: 2026-09-12

## 0. The idea in one sentence

The learner's agent gets a background "study brain": it reads the learner's goals,
performance signals and calendar, **proposes** helpful next steps (tasks, sessions,
check-ins, new goals), and — only after the learner **approves** — executes them
through the exact same tools/APIs the chat already uses.

> Standing principle this must not break: **the agent proposes; the human
> disposes.** Nothing reaches the learner's time, chat, or wallet without an
> explicit tap. (Same HITL contract as instructor activity assignment.)

---

## 1. Workflow or tool? — Answer: a workflow whose hands are tools

| Layer | What it is | Existing precedent |
|---|---|---|
| **Autonomy Workflow** (new) | A server-owned, queue-driven cycle: gather signals → reason → write **Proposals**. Runs *without* any chat turn, on a schedule + event triggers. | BullMQ workers today: autonomy reviews, chat follow-ups, tasks worker |
| **Tools** (existing) | The ONLY execution path. Approval of a proposal calls the same tool functions the chat loop calls (`create_task`, `schedule_chat_follow_up`, …). | `executeChatTool` — one authority, already the rule |
| **Chat** (existing) | The conversation surface where the learner can question/edit anything ("why this task?") and the daily proactive nudge arrives. | `/api/adaptive/chat/agent` |

Why not "just a tool": a tool only runs inside a chat turn someone started — it
cannot *initiate*. Full autonomy's whole value is acting between conversations.
Why not a free-running agent loop: an unsupervised multi-tool loop is
unbudgetable and unpredictable for a learner product. The compromise: the
workflow **reasons with a structured prompt** (JSON proposals out — cheap,
bounded, deterministic) and only touches real tools **after approval**.
Validation of feasibility (calendar conflicts, duplicates) reuses read tools
server-side.

---

## 2. What exists already (build on, don't fork)

- `agent.goal` — ONE primary goal (select list) in settings → becomes the seed of a real goals model.
- `agent_suggestions` (kind: task|goal|conversation, open→accepted(task_id)/dismissed) — an approval inbox already exists; it becomes the **Proposal Inbox**.
- `learner_agent_autonomy` + `learner_autonomy_task_reviews` — Level-1 autonomy (due-task check-ins) with claim/stale-release/idempotent delivery. The new workflow rides the same patterns.
- `scheduled_chat_follow_ups` — durable scheduled chats (the approval target for "study with me Tuesday 5pm").
- Decay engine (`calculateDecayedConfidence`, `getNextReviewDate`), gradebook, past-questions accuracy, academic calendar, streaks/XP — the **signal buffet**.
- `lib/agentActivity.js` (just shipped) — the header stream that makes the background brain visible ("Reviewing your goals…").
- Coins/metering (`lib/aiModel.js`) — every LLM call is metered per user already.

## 3. Autonomy levels (learner chooses, in Settings → Agent)

| Level | Name | What the agent may do | Ships in |
|---|---|---|---|
| 0 | Off | Nothing. | exists |
| 1 | Due-task nudges | One check-in chat when a precisely-due task is due. | **exists today** |
| 2 | **Planner (the PR)** | Nightly/weekly cycle → Proposals inbox (tasks, sessions, goals, practice). Nothing executes without approval. | this plan |
| 3 | Trusted scheduler | Approved *recurring* patterns re-propose automatically (e.g. "yes, every Tuesday") — still no chat without approval. | phase 2 |
| 4 | Auto-pilot (low-risk only) | Auto-creates self-study tasks below a size cap; everything else still proposed. | future, opt-in |

Default = current setting. Moving to Level 2 is an explicit consent step with a
plain-language explainer (what it reads, what it may propose, weekly budget).

## 4. Data model (three tables + one column)

```sql
edu.learner_goals (
  id UUID PK, user_id UUID → users,
  title TEXT NOT NULL,                -- "Pass WAEC Biology with A"
  metric TEXT,                        -- optional measurable ("avg 70% on past questions")
  target_date DATE, exam TEXT,        -- ties into academic calendar countdowns
  status TEXT DEFAULT 'active' CHECK (IN ('active','paused','achieved','dismissed')),
  source TEXT DEFAULT 'learner' CHECK (IN ('learner','agent')),  -- agent ones start as proposals
  progress_note TEXT, updated_at, created_at
)

edu.agent_proposals (
  id UUID PK, user_id UUID,
  kind TEXT CHECK (IN ('task','session','goal','practice','battle','plan_digest')),
  title TEXT, rationale TEXT,         -- the WHY, shown on the card
  payload JSONB NOT NULL,             -- exactly the tool's input shape
  status TEXT DEFAULT 'proposed' CHECK (IN ('proposed','approved','dismissed','expired','executed','failed')),
  executed_ref UUID,                  -- task_id / follow_up_id after approval
  run_id UUID,                        -- → autonomy_runs (traceability)
  expires_at TIMESTAMPTZ DEFAULT now()+7d,
  created_at, decided_at
)

edu.autonomy_runs (
  id UUID PK, user_id, trigger TEXT,  -- 'nightly' | 'event:grade' | 'event:streak' | 'manual'
  started_at, finished_at, proposals_created INT,
  tokens_used INT, cost_usd NUMERIC, summary TEXT
)
```

`agent_suggestions` keeps working (chat-sourced); the nightly cycle writes
`agent_proposals`. Migration can later unify the two behind one inbox API.

## 5. The cycle (the "study brain")

**Triggers:** nightly per opted-in learner (staggered), plus events: grade
posted, task overdue ×2, streak broken, goal target within N days, battle
scheduled. Queue: `autonomy-cycle` (BullMQ, same worker hygiene as today:
drainDelay/stalledInterval tuned for the Redis free quota).

**Steps (one cycle ≈ 1–2 LLM calls — bounded):**
1. **Gather** (pure DB reads, no model): goals + progress, decay priorities
   (top-5 weakest topics), recent task completion rate, upcoming exams,
   past-question accuracy by topic, calendar for the next 7 days, pending
   proposal count.
2. **Reason** (1 metered call, `response_format: json_object`, max_tokens cap):
   prompt = profile (goal field, subjects, exam board, year group) + signals +
   **house rules** → outputs `{ summary, proposals: [ { kind, title, rationale,
   payload, suggested_for } ], goal_updates: [...], new_goal_drafts: [...] }`.
   House rules: ≤3 proposals per run; ≤5 pending total; respect quiet hours;
   never propose during school hours; every rationale must cite a signal
   ("you scored 40% on Photosynthesis practice"); no duplicates of pending/
   recent proposals; nothing that costs money (battles/coins) without saying so.
3. **Validate** server-side (no model): dedupe vs pending+30-day history;
   calendar conflict check via existing reads; payload schema-check per kind.
4. **Persist** proposals + run row; emit `agent:activity` ("Reviewed your
   goals — 2 suggestions ready"); one notification (digest-style, not per
   proposal) with inbox deep-link.

**Approval execution (HITL):** `POST /api/agent/proposals/:id/approve` →
switch(kind) → the EXISTING tool functions: task→`createTask` core,
session/check-in→`scheduleChatFollowUp` core, practice→create self-study task,
goal→insert into `learner_goals` + mark suggestion accepted. Failure → proposal
`failed` + toast, never silent. Dismiss stores an optional reason byte
(`too much | not useful | wrong time`) that the next cycle's prompt reads —
the agent learns taste, not just facts.

## 6. Education-tailored behaviours the signals unlock

- **Exam countdown planner** — WAEC/JAMB dates from the academic calendar; the
  weekly plan weights topics by exam proximity × weakness.
- **Weakness radar → practice proposals** — decay engine + past-question
  accuracy produce "your 3 weakest topics" with one-tap practice tasks
  (spaced repetition: `getNextReviewDate` decides *when* to resurface).
- **Streak guardian** — after a missed day: no guilt copy; a 10-minute recovery
  task proposal sized to the time they actually have.
- **Goal decomposer** — "Pass WAEC Biology" → milestone map (per-term topics →
  weekly tasks); milestones live as goal progress notes the cycle reports on.
- **Battle readiness** — if a battle is scheduled on a weak topic, propose a
  15-min warm-up task beforehand (labelled, never auto-created at L2).
- **Weekly digest (transparency report)** — one proposed "plan_digest"
  entry/week: what the agent reviewed, what it suggests, progress vs goals —
  this is the answer to "what is it doing behind the scenes?" (plus the live
  header stream already shipped).
- **Celebration** — goal achieved → proposes a reward battle + next goal draft.
- **Teacher visibility (school tier, later)** — optional share of the goal map
  with the class teacher; nothing learner-private leaks by default.

## 7. Guardrails (non-negotiable)

1. **Approval for anything that touches time/chat** — an approved proposal
   creates exactly the approved thing, once (`executed_ref` idempotency).
2. **Budget** — weekly token/coin ceiling per learner for autonomy cycles
   (read from coins metering; over budget → skip cycle, log, notify at 80%).
3. **Frequency** — ≤1 cycle/night, ≤3 proposals/cycle, ≤5 pending, TTL 7 days.
4. **Quiet hours + school hours** respected (timezone from profile; Africa/Lagos default).
5. **No money moves** — battles/paid items can be *proposed*, never auto-executed at L2/L3.
6. **Explainability** — every proposal card shows rationale + the signal that
   triggered it; the weekly digest shows cycle history (runs, proposals, decisions).
7. **Kill switch** — Level 0 instantly pauses cycles; pending proposals stay
   but nothing new is generated.
8. **Redis quota hygiene** — the cycle queue joins the existing worker tuning
   (`drainDelay`, `stalledInterval`); a nightly cycle per learner is O(n) jobs
   per day, not the 5s-poll tax that burned the 500k quota.

## 8. Build order (each shippable alone)

1. **Goals model** — `learner_goals` table + settings sheet upgrade (multi-goal,
   from the single `agent.goal` seed) + goals in the agent's system context.
2. **Proposal inbox** — `agent_proposals` + list/approve/dismiss API + inbox UI
   in the agent tab (badged) + approval executing through existing tools.
3. **The cycle** — nightly queue + signal gatherer + structured reasoning call +
   validation + persistence + activity/notification. (Task suggestions migrate
   to proposals: accepted → task, with rationale.)
4. **Event triggers** — grade/streak/exam hooks; weakness radar + streak
   guardian behaviours; weekly digest.
5. **Level 3** — approved recurring patterns ("every Tuesday 5pm") re-propose.
6. **Level 4** (future) — capped auto-execute for low-risk self-study tasks.

## 9. Decisions (LOCKED 2026-09-12 — repo owner)

1. **Approval granularity** — per proposal. No "approve all".
2. **Quiet hours** — 20:00–07:30 Africa/Lagos default. School-hours rule: hard-coded off 07:30–15:00 weekdays for proposes-timing (sessions/check-ins), generation may run nightly.
3. **Budget** — owner deferred; default: skip a learner's cycle if the previous 7 days' autonomy calls exceed a generous gpt-4o-mini ceiling (tunable env `AKORO_AUTONOMY_WEEKLY_BUDGET_USD`, default $0.50), notify at 80%.
4. **Goal kinds** — ALL education-related goals: exam targets (WAEC/JAMB/NECO), subject mastery, AND habit goals ("study 30 min daily"). Anything not educational is out of scope for the agent.
5. **Teacher/school visibility** — explicitly OUT of v1; revisit later.
6. **Inbox location (RESOLVED)** — the existing **Suggestions list in the agent tab** (To do / Done / Suggestions) IS the inbox. Autonomous proposals land there alongside chat-sourced suggestions; only on approval does anything execute — scheduling a session/follow-up or starting a chat, through the existing tools. No new top-level surface.

## 10. Open questions (remaining, non-blocking)

- Whether proposals and chat-sourced `agent_suggestions` unify into one table now or behind one inbox API later (default: later — the inbox UI already reads one endpoint; the cycle can write `agent_suggestions`-compatible rows for v1 if simpler).

## 10. Increment log

- **Step 1 — goals model (shipped `bcd1fe0`):** `edu.learner_goals`, `/api/goals` CRUD (cap 10 active), top-5 goals into the agent system prompt, Settings → Agent Goals UI.
- **Steps 2+3 — inbox + cycle (shipped `e4a3ee6`):** `edu.agent_proposals` + `edu.autonomy_runs`; `/api/agent/proposals` approve (replays `executeChatTool` 1:1, claim-first idempotent) / dismiss (taste reason); nightly 21:00–22:00 Africa/Lagos stagger, DB-only signals, one metered `json_object` call, server-side validation (≤3/run, ≤5 pending, 30-day dedupe, quiet hours 20:00–07:30 Lagos); level-2 planner toggle in the sessions drawer; proposals in the Suggestions inbox.
- **Steps 4+5 — event triggers, richer signals, agent↔agent consult:** event triggers on task-done / community submission / self-study complete / battle end (best-effort seam, ≥4h pace, ≤2 event runs/day); signals now include the honest completion streak, recent chat topics, battle/review scores, and class work due this week; `consult_peer_agents` tool — the learner's agent asks up to two peer agents' personas for ideas (only the sanitized question travels; contact details rejected; the asking learner's budget meters every call; `AKORO_AGENT_PEER_CONSULT_ENABLED` kill-switch). Peer agents never see learner data — they lend ideas, not facts.
