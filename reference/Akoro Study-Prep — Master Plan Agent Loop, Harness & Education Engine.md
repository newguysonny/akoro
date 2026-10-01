# Akoro Study-Prep — Master Plan (Agent Loop, Harness & Education Engine)

This is the build plan for the exam-prep / study-prep workflow: the conversion of today's single-topic
exam-prep confidence loop into a **real agent loop** — an LLM Study Agent that *proposes*, a deterministic
**Harness** that *validates and executes*, and a deterministic **Education Engine** that *scores*.

Source material (all five files in `reference/exam-prep-worflow/`, all read in full):

| Tag | File | Role |
|---|---|---|
| **S1** | `Exam prep session simulation withagentharness loop.md` | Slow-motion walkthrough of one full session; the loop semantics and plan-card UX |
| **S2** | `Exam-prep-with-harness and loop.md` | The architectural critique of v2 `deliberate()`; the three-way separation (agent / harness / engine) |
| **S3** | `exam prep with context layer and configuration files.md` | The agent context layer: configurable `.md` workspace + Context Manager |
| **S4** | `Akoro Study-Prep Session Loop — v2.1.md` | Full spec: state machines, data model, §8 changes to existing code, cost/concurrency rules |
| **S5** | `Akoro Study-Prep Session Loop — v2.1 (agent + harness).md` | **Newest (commit e43cf23).** Layered lifetimes, agent intent, tool registry, agent-loop runner, revised build order |

**Precedence when the two v2.1 docs disagree:** S5 (newest commit) wins. Where S4 has detail S5 lacks
(`sequence` column, `duration_ms`, `plan.validate`, `topic.flag`, `session.replan`, 40-tool-call session guard,
generation fan-out bound), we take the **union** — nothing from either doc is dropped. The one true conflict —
`deliberate()` retired (S4) vs. rescoped (S5) — is resolved per S5: **`deliberate()` survives as harness-owned
narration only, never agent cognition** (§4.7).

Standing engineering guarantees (unchanged by this plan): one response envelope, stable machine-readable
`code` on 4xx, 500 only for genuine server faults, statuses hardcoded English, records server-side,
`gateway_authorization` never exposed to clients, exact UI fidelity to prototypes.

---

## 1. The Model

### 1.1 Three roles, one loop (S2, S5)

```
LEARNER GOAL ("prepare me for my whole-term Basic Science exam")
        │
        ▼
┌──────────────────┐   proposes ONE structured action per iteration
│  STUDY AGENT     │   (+ bounded intent field). Stateless. Never writes.
│  (LLM)           │
└────────┬─────────┘
         │  tool call / proposed action
         ▼
┌──────────────────┐   authn · ownership · state machine · budget · attempt caps
│  HARNESS         │   concurrency · tool permissions · schema validation
│  (code)          │   APPROVE → execute · DENY → structured rejection code
└────────┬─────────┘   sole writer of session + run rows; narrates via deliberate()
         │
         ▼
┌──────────────────┐   score = 3/5 · threshold = 70% · attempts remaining = 2
│ EDUCATION ENGINE │   deterministic scoring, thresholds, mastery evidence.
│  (code, no LLM)  │   The agent uses it; it never replaces it.
└────────┬─────────┘
         │
         ▼
   OBSERVATION  ──► back to the Study Agent ──► … ──► verified learning outcome
```

- **LLM decides** ("I think Water Cycle should come first"), **Harness decides** ("is that allowed?"),
  **Database decides** ("did the transition actually succeed?"). (S1, S2)
- The loop is **Goal → Reason → Act → Observe → Reason → …**. The six cognitive operations
  (research / draft / verification / action / reflection / synthesis) are **activity labels the harness stamps
  on events**, never a forced sequence and never the LLM's private thinking. (S1, S4)
- The LLM may not invent educational policy: max attempts, thresholds, topic caps and wallet rules are
  harness-enforced. A proposal that violates them is rejected with a machine-readable code the agent then
  *observes* and adapts to (e.g. `insufficient_balance` → agent proposes pausing). (S2, S5)

### 1.2 Layered lifetimes (S5)

| Layer | Lifetime | What it is |
|---|---|---|
| **Study session** | Persists across chats, hours–days | `study_prep_sessions` + topics + events; the durable unit |
| **Agent loop** | Bounded, *within one session step* | ≤ 6 iterations, then a terminal action or a pause |
| **Topic workflow** | Existing exam-prep confidence loop (today's `exam-prep-confidence.js`) | Diagnostic → teach-back → retest per topic; becomes the Education Engine's execution arm |
| **Chat turn** | Single exchange | Chat tools can *start* and *read* a session, never drive it |

### 1.3 Session and topic state machines (S4, S5)

```
Session: planning → awaiting_confirmation → topic_active ⇄ replanning ⇄ paused
                                            ↓                ↓
                                     completed | abandoned | cancelled

Topic:   queued → active → understood | flagged_gap | capped_out | deferred
```

- `paused` carries a machine reason (`agent_loop_cap`, `insufficient_balance`, `learner_requested`).
- A deferred topic may be retried **once per session** with attempts reset (Decision 5).
- All transitions are **conditional updates** (`.eq("state", expected)`) — the database is the referee.

---

## 2. Feature Map & Status

Every feature across the five source files, where it lands, and its status.
Status legend: ✅ exists today · 🔧 changed by this plan · 🆕 new.

| Feature | Source | Lands in | Status |
|---|---|---|---|
| Goal object `{goal, subject, class_level, entry_mode}` | S1 | Chat tool `start_study_prep_session` | 🆕 |
| Agent-chosen research order (syllabus → state → prereqs, not hardcoded) | S1, S2 | Agent loop + read tools | 🆕 |
| Structured tool-call JSON, harness-validated | S1, S2, S5 | Tool registry | 🆕 |
| Structured plan proposal (`propose_plan`) + harness verification (prereq order, syllabus membership, ≤12 topics, cost vs wallet) | S1, S4, S5 | Harness `proposePlan` | 🆕 |
| Plan card UI (topics, estimated cost, **Approve & Start** / **Adjust**) | S1 | Learner frontend | 🆕 |
| Human gate on spend (learner confirms; LLM never approves spending) | S1, S2, S4, S5 | Harness + UI | 🆕 |
| Zero coins spent before confirmation | S4, S5 | Harness | 🆕 |
| Diagnostic-first for low-evidence topics; retest with **fresh questions** | S1 | Education Engine / practice.generate | 🔧 (v1 has diagnostic/retest; freshness + evidence-aware choice is new) |
| Server-side scoring from answer key (LLM never scores) | S1, S2, S4, S5 | Education Engine | ✅ (v1 does this; formalized) |
| Strategy library `teach_back · different_analogy · interleave · space_out · escalate_human` | S1, S5 | Harness offer_strategy | 🆕 |
| Teach-back gate: only `learnerConfirmedReady` ("I've taught it back") unlocks retest — no LLM inference of mastery | S1, S4, S5 | Harness | 🔧 (v1 offers teach-back; the hard gate is new) |
| Cap-out → agent proposes `defer_topic` with `reason_code` (e.g. `attempt_cap_reached`) | S2, S5 | Agent + harness | 🆕 |
| Rejections as observations the agent adapts to (`attempt_cap_exceeded`, `insufficient_balance`, `strategy_not_permitted`, …) | S2, S5 | Harness | 🆕 |
| `deliberate()` as harness narration only (decision_node enum, typed facts, `policy_version` templates, snapshot-tested) | S2, S5 | Harness narration | 🆕 (replaces v2's pseudo-cognition) |
| Agent intent field (schema-validated, origin-tagged, ≤240 chars, profanity-filtered, shown as "agent says:") | S5 | Agent loop + events + UI | 🆕 |
| Tool permission levels **read / propose / execute** + `tools/registry.js` | S2, S5 | Tool registry | 🆕 |
| Harness-only operations: `practice.score`, `wallet.charge`, `session.transition`, `evidence.append` — never agent-callable | S2, S4, S5 | Harness internals | 🆕 |
| `plan.validate` dry-run | S4 | Tool registry (read) | 🆕 |
| `topic.flag` (flag knowledge gap), `session.replan` | S4 | Tool registry (propose) | 🆕 |
| Agent-loop runner `study-prep/agent-loop.js`, `runAgentStep`, **maxIterations 6** (harness constant), terminal actions, `agent_loop_cap` → paused "I got stuck — tap to retry or adjust" | S5 | Agent loop | 🆕 |
| ~40 tool-calls-per-session guard (token budget), surfaced as a `harness_reject`/pause | S4 | Harness | 🆕 |
| Append-only `study_prep_events` agent activity log (union schema, §4.1) | S2, S4, S5 | Data model | 🆕 |
| No LLM chain-of-thought storage; bounded `facts`, no raw chat, no answer keys | S2, S4, S5 | Events + engine | 🆕 |
| Session replay from the events table — **never re-runs the LLM** | S4, S5 | Frontend | 🆕 |
| Honest elapsed-time pacing (show real 80 ms, don't pad) | S4, S5 | Frontend | 🆕 |
| Context layer: `.md` workspace (identity / learning / reasoning / policies / strategies / memory) + Context Manager with per-operation selection | S3 | Context layer | 🆕 |
| **Agentic inspection** — the agent decides what to inspect and chains observations into discoveries (weak sub-concept → confusion history → targeted teaching); never a hardcoded sequence | S3 | Agent loop + read tools | 🆕 |
| Files = stable instructions; DB = dynamic truth; tools = controlled access (`.md` never authoritative state) | S3 | Doctrine | 🆕 |
| `learner.get_relevant_memory()` retrieval instead of dumping history | S3 | Read tools | 🆕 |
| Exam-prep service extraction (`startRun/submitAttempt/startRetest/generateAttempt` out of the router) | S4, S5 | `exam-prep-service.js` | 🔧 |
| Submit-race fix (conditional update + status guard + winner check) | S4, S5 | Exam-prep service | 🔧 (race confirmed in today's code, §3) |
| Workflow list grouping: one entry per session, topics nested; other workflows stay visible | S4, S5 | `adaptive-workflows.js` | 🔧 |
| `adaptive_workflow_runs.study_prep_session_id` link column | S4, S5 | Migration | 🆕 |
| `learner_exam_prep_runs.max_attempts` cram override (= 1, depth `diagnostic_only`) | S4, S5 | Harness run creation | 🔧 (column exists; cram sets it) |
| Wallet-first charge; 402 mid-loop → session `paused`, resumable, no lost topic | S4, S5 | Harness + wallet | 🆕 |
| `estimate_session_cost` includes per-loop LLM cost at a **rounded** value | S5 | Estimate | 🆕 |
| Practice generation fan-out bounded (≤ 3–4 concurrent) within the confirmed estimate | S4 | Engine | 🆕 |
| No autonomous sessions, no background daemons, no notifications outside the active session | S4 | Doctrine | ✅ (standing guarantee, restated) |
| Mastery write-back to `learner_concept_state` via deterministic evidence policy (`knowledge_confidence/100` → 0–1 fallback) | S4 | Education Engine | 🔧 |
| Learner repo: syllabus topics, concept state, attempt confusion notes/missed objectives, approved `concept_edges`, past sessions (avoid identical replanning) | S4 | Read tools | 🔧/🆕 |
| JSS1 Basic Science syllabus rows (ingestion = blocker for the resolver) | S4, S5 | Data | ❓ confirm |
| Past-question bank coverage (row counts) before promising verified past questions | S4 | Data | ❓ confirm |
| Chat tools `start_study_prep_session` / `get_study_prep_session` — **plan-only** (start runs one planning loop; no model-callable confirm/advance/generate) | S5 | Chat surface | 🆕 |
| REST surface unchanged (existing exam-prep endpoints; plan-card confirm via REST gate) | S4, S5 | API | ✅/🆕 |
| `AKORO_STUDY_PREP_ENABLED` feature flag | S4, S5 | Config | 🆕 |
| Course resolver, then material resolver (entry modes beyond `syllabus`) | S5 | Entry modes | 🆕 (last phase) |
| Six-topic session leaves other workflows visible | S4, S5 | Workflow list | 🔧 |
| Guardian Angel (verify teach-back claims against approved sources) | S4, S5 | — | 🔒 still open |
| Pace profile (flat default) | S4 | — | 🔒 still open (flat default) |

---

## 3. What Exists Today vs. What This Plan Adds

Grounded in the current tree (verified 2026-10-01):

**Exists today**
- `akoro-api/modules/adaptive-learning/exam-prep-confidence.js` — the v1 single-topic confidence loop:
  `POST /confidence-runs`, `GET /confidence-runs`, `GET /workflows`, `GET /confidence-runs/:runId`,
  `POST /:runId/submit`, `POST /:runId/retest`. Generated exam-style MCQ (3–10 questions, provenance locked to
  `generated_exam_style`), learner-initiated teach-back handoff, `change_approach` on cap-out. Gated by
  `AKORO_EXAM_PREP_CONFIDENCE_ENABLED`. This is the **topic-workflow layer** the new session harness drives.
- `edu.exam_prep_confidence_policies` — per board/subject `pass_threshold`, `max_attempts`, `policy_version`
  with board fallback; default `0.70 / 3 / exam-confidence-v1`. **The policy table the harness reads.**
- `edu.learner_exam_prep_runs` / `edu.learner_exam_prep_attempts` — run status
  `diagnostic_ready → teach_back_required → retest_ready → passed | change_approach`; attempts carry
  `questions`, `answer_key`, `submitted_answers`, `score`.
- `modules/adaptive-learning/adaptive-workflows.js` — durable workflow projection
  (`adaptive_workflow_runs` / `_steps`) with the correct conditional-update transition pattern (a concurrent
  transition wins once; the loser no-ops). **This is the in-repo model for single-writer updates** — and the
  module that needs session grouping + `study_prep_session_id`.
- `edu.syllabus_subjects / syllabus_topics / syllabus_subtopics / syllabus_chunks`,
  `edu.concept_catalog / concept_edges / learner_concept_state / learner_concept_evidence` — the learner repo
  the read tools query. Syllabus grounding already used by `chat.js` / `syllabus.js`.
- Wallet: `lib/coins.js` + `modules/wallet/routes.js` (coins, kobo, Paystack top-up, school→student).
- Frontend: `akoro-learner/src/components/teaching/TeachAgentModal.jsx` — the teach-back surface
  (**unchanged** by this plan; the gate feeds it).
- `akoro-python-agent` — reference implementation of the agent-loop pattern (`tests/test_agent_loop.py`).
- `learner-chat-read-tools.js` — the house pattern for read tools that never expose transcripts/scratchpads.

**Confirmed defect to fix first (S4 §8.2, verified in code):** the `submit` handler's run update lacks an
`.eq("status", run.status)` guard, and the parallel attempt update (`Promise.all`) never checks whether its
conditional update *won* — a double-submit can race. The service extraction (§4.8) fixes this with one
conditional, status-guarded transactional write path.

**Does not exist yet (this plan builds it):** `study_prep_sessions / study_prep_topics / study_prep_events`
tables; tool registry; agent-loop runner; harness; `deliberate()` narration; context layer; study-prep chat
tools; plan card + session UI; `AKORO_STUDY_PREP_ENABLED`.

---

## 4. Build Plan

All new server code lives under `akoro-api/modules/adaptive-learning/study-prep/` (plus
`tools/registry.js` and migrations), on the existing stack: Node/Express, Supabase Postgres, Redis/BullMQ,
`lib/coins.js` wallet.

### 4.1 Data model (Postgres, schema `edu`)

New migration `2026-study-prep-sessions-v1.sql`:

| Table | Columns | Notes |
|---|---|---|
| `study_prep_sessions` | `id, learner_id, goal, subject, class_level, entry_mode ('syllabus' — later 'course', 'material'), status, paused_reason, strategy_policy_version, policy_version, created_at, updated_at, completed_at` | `status` ∈ planning / awaiting_confirmation / topic_active / replanning / paused / completed / abandoned / cancelled. `paused_reason` ∈ agent_loop_cap / insufficient_balance / learner_requested |
| `study_prep_topics` | `id, session_id → study_prep_sessions, syllabus_topic_id, position, status, attempts_used, deferred_retry_used, flagged_reason, created_at, updated_at` | `status` ∈ queued / active / understood / flagged_gap / capped_out / deferred. UNIQUE `(session_id, syllabus_topic_id)`; `position` ≤ 12 enforced by harness + CHECK |
| `study_prep_events` | `id, session_id, topic_id NULL, sequence INT NOT NULL, iteration INT, event_type, tool NULL, action NULL, agent_intent NULL, origin NOT NULL, decision_node NULL, narrative NULL, facts JSONB, thought_type NULL, duration_ms NULL, policy_version, created_at` | Append-only agent activity log. `UNIQUE (session_id, sequence)`. `event_type` CHECK ∈ `agent_tool_call \| agent_action \| harness_decision \| observation \| human_gate \| engine_result` (S5) ∪ `tool_call \| tool_result \| harness_reject` (S4 — mapped onto the S5 set at write time; `harness_reject` is recorded as `harness_decision` with `decision_node = 'harness_rejection'`). `origin` CHECK ∈ `agent_stated_intent \| harness \| engine`. `thought_type` ∈ research / draft / verification / action / reflection / synthesis — **stamped by the harness, never the model**. `facts` bounded: no raw chat, no answer keys |

Altered tables (same migration):

- `adaptive_workflow_runs` **+ `study_prep_session_id UUID NULL`** — links the per-topic workflow projection
  to its session so the workflow list can group one entry per session with nested topics (S4 §8.3).
- `learner_exam_prep_runs` — no schema change needed; the harness sets `max_attempts = 1` (cram mode) and
  otherwise from the policy table at run creation. `study_prep_topic_id UUID NULL` added so attempts roll up
  to a session topic.

Grants follow the house pattern (`service_role` CRUD + `NOTIFY pgrst, 'reload schema'`). RLS: none added —
service-role access only, same as existing `edu` tables.

### 4.2 Tool registry & permission levels (`tools/registry.js`, S2 + S4 + S5 union)

| Tool | Level | Handler | Notes |
|---|---|---|---|
| `syllabus.resolve` | read | resolveSyllabus | From `edu.syllabus_*`; `entry_mode: 'syllabus'`, `scope: 'whole_term'` |
| `learner.get_state` | read | getLearnerState | `learner_concept_state` 0–1; `knowledge_confidence/100` fallback |
| `learner.get_history` | read | getLearnerHistory | Past runs/attempts, confusion notes, missed objectives |
| `learner.get_relevant_memory` | read | getRelevantMemory | S3: targeted retrieval, never a history dump |
| `concept.get_prerequisites` | read | getPrerequisites | `concept_edges` (approved edges only) |
| `content.search` | read | searchContent | Grounded on `getSyllabusGrounding` / `getPastQuestionGrounding` (verified only); internal retrieval `search_approved_content` → `match_syllabus` RPC. **No open web.** Out of the v1 loop (latency); see §4.16 |
| `session.get_state` | read | getSessionState | Session + topics + budget snapshot for the agent |
| `plan.validate` | read | validatePlan | Dry-run of the harness plan checks; returns the same structured result the agent would see |
| `propose_plan` | propose | harness.proposePlan | Terminal action → plan card |
| `offer_strategy` | propose | harness.offerStrategy | Must be from the curated library, else `strategy_not_permitted` |
| `advance_topic` | propose | harness.advanceTopic | Terminal action |
| `defer_topic` | propose | harness.deferTopic | Terminal action; carries `reason_code` |
| `topic.flag` | propose | harness.flagTopic | Marks `flagged_gap` |
| `session.replan` | propose | harness.replan | Back to planning, keeping confirmed topics |
| `conclude_session` | propose | harness.concludeSession | Terminal action → completed |
| `practice.generate` | execute | generatePractice | **cost: true** — wallet charged first inside the harness |
| `practice.submit` | execute | submitAttempt | No cost; Education Engine scores |

Harness-internal, **never in the registry the LLM sees**: `practice.score`, `wallet.charge`,
`session.transition`, `evidence.append`. The agent can *request* practice; only the harness charges and
transitions (S2 §8, S4, S5). Naming convention: dotted names for tools, snake_case for proposed actions.

Every registry entry declares a JSON schema for its arguments; the harness validates before execution and
rejects malformed calls with `tool_schema_invalid`.

### 4.3 Agent loop runner (`study-prep/agent-loop.js`, S5 §8.8)

- `runAgentStep({ sessionId, topicId, goal, maxIterations = 6 })` — one session step = at most 6 iterations
  (harness constant, **not a model choice**).
- Each iteration: build context (§4.6) → one LLM call → parse exactly **one** structured action + optional
  bounded intent → harness validate → execute or reject → append events → observation back to the LLM.
- Terminal actions: `propose_plan` (returns plan to caller), `advance_topic`, `defer_topic`,
  `conclude_session`, or a harness pause (402, loop cap).
- Fail-safes: stub/looping agent past `maxIterations` → session `paused`, reason `agent_loop_cap`, learner
  sees **"I got stuck — tap to retry or adjust."** Never a silent continuation, never partial state.
- Session-level budget guard from S4: ~40 total tool calls per session → pause with the same honest copy.
- The runner is transport-agnostic and takes the LLM client as a dependency, so contract tests drive it with
  a stub agent (no LLM in the test path).

### 4.4 Harness (`study-prep/harness.js`)

Validation order (fail fast, one rejection code per failure):

1. Feature flag `AKORO_STUDY_PREP_ENABLED` (else `study_prep_disabled`).
2. Authentication + session ownership (else 404, `session_not_found`).
3. Tool exists in registry + permission level for this state (else `tool_not_permitted`).
4. Argument schema (else `tool_schema_invalid`).
5. Session/topic state machine (else `invalid_state_transition`).
6. Attempt caps (else `attempt_cap_exceeded`) and the 12-topic cap.
7. Hard plan constraints: syllabus membership, prerequisite order, budget (else `prerequisite_violation`,
   `topic_not_in_syllabus`, `plan_too_large`). **Soft ordering stays the agent's call** — the harness enforces
   hard constraints only, and the Education Engine records outcomes for review (Decision 4).
8. Wallet: `practice.generate` charges **first** via `lib/coins.js`; on insufficient balance the loop gets a
   402 observation → session `paused(insufficient_balance)`, resumable after top-up, no lost topic.
9. Teach-back gate: `practice.generate(mode: 'retest')` requires `learnerConfirmedReady` — only the learner's
   "I've taught it back" sets it. No inference, ever.

Write discipline: the harness is the **sole writer** of session, topic and run rows; every write is a
conditional update (`.eq("status", expected)`) following the `adaptive-workflows.js` pattern; losers no-op
without duplicating events. Practice generation fan-out is bounded ≤ 3–4 concurrent, within the confirmed
estimate.

### 4.5 Education Engine (`study-prep/education-engine.js`, pure functions)

- `scoreAttempt(answerKey, submitted)` → score, correct, total — deterministic; the LLM never scores (S1 §17).
- `applyThreshold(score, passThreshold)` → passed/capped/teach-back routing (policy from
  `exam_prep_confidence_policies`, default 0.70 / 3).
- `masteryWriteBack(topicResult)` → appends `learner_concept_evidence` and updates `learner_concept_state`
  via the deterministic mastery policy (evidence-flagged; `knowledge_confidence/100` → 0–1 fallback).
- Pure, dependency-injected, unit-tested with fixed fixtures — same style as `lib/billingModel.js`.

### 4.6 Context layer (S3)

A workspace of configuration `.md` files under `akoro-agent/` — the **configurable agent brain / context
layer** (repo-tracked, loaded by the harness before the reasoning loop — **never authoritative state**):

```
akoro-agent/
├── AGENT.md                     identity: "You are Akoro Study Agent"
├── identity/SOUL.md             tone and values
├── learning/LEARNING.md         what to consider before teaching (prior knowledge, prerequisites…)
├── learning/{TEACHING,ASSESSMENT,MASTERY}.md
├── reasoning/REASONING.md       what to inspect before deciding (goal, state, evidence, budget…)
├── reasoning/{RESEARCH.md,INSPECTION.md,PLANNING.md}
├── policies/{SAFETY,EDUCATION_RULES,TOOL_RULES}.md
├── strategies/STRATEGIES.md     the curated strategy library
└── memory/MEMORY.md             curated long-term agent knowledge
```

- **Context Manager** (`study-prep/context-manager.js`): `load({ agent, learning, reasoning, research, session })`
  selects the file set **per operation** — planning loads `AGENT + LEARNING + PLANNING + EDUCATION_RULES`;
  research loads `AGENT + RESEARCH + INSPECTION + EDUCATION_RULES`; teaching loads
  `AGENT + LEARNING + TEACHING + MASTERY`; reflection loads `AGENT + ASSESSMENT + MASTERY + REASONING`.
  Never the whole workspace in one prompt (cost + reasoning degradation — S3's explicit trap).
- `buildAgentContext(session)` assembles workspace files + dynamic truth (syllabus, learner state, mastery,
  previous attempts, misconceptions, current session) fetched through the read tools.
- Doctrine: **files = stable instructions; database = dynamic truth; tools = controlled access.** Learner
  memory lives in Postgres and is retrieved (`learner.get_relevant_memory()`), not dumped. New behaviours
  (e.g. a future `LEARNER_PREFERENCES.md`) are added by dropping in a file — the loop is not rewritten.
- **Agentic inspection (S3):** the context layer doesn't just tell the agent *what to do*, it tells it *what
  to consider before deciding* (REASONING.md / INSPECTION.md) — and the agent then inspects on its own
  initiative through the read tools, chaining observations into discoveries. S3's canonical example: the
  agent doesn't merely receive "Teach Water Cycle" — it inspects `learner.get_state`, **observes** weak
  evaporation knowledge (0.35), inspects `learner.get_history`, **observes** the learner repeatedly confuses
  evaporation with transpiration, and only then decides to teach that distinction before attempting another
  full Water Cycle exercise. Each inspection is chosen because of what the previous observation revealed —
  the opposite of v2's fixed research → draft → verification sequence. The loop (§4.3) is what makes this
  possible; the context layer is what makes it *purposeful*.
- Files are validated by a contract test: no learner-identifying data, no policy numbers that belong in the
  policy tables, size budget per file.

**Adoption by existing features — explicit later phase, not automatic.** Nothing existing migrates onto the
context layer during this build (§5). Today's agents assemble context entirely in code — chat's
`tutorSystemPrompt()` in `chat.js` (persona + formatting contract + Think/Research addenda hardcoded as JS
template strings), the persona agents under `agents/` (JS modules; trained-teacher style from DB
orchestration config + pgvector chunks via `training/agentPromptBuilder.js`), and the python agent's
`reasoning/` modules — no `.md` workspace exists yet anywhere. That is correct for this plan's scope: the
context manager + `akoro-agent/` workspace serve the study-prep loop first, behind the flag, with zero
regression risk to live chat, activities, adaptive workflows or autonomy. But the workspace files are
platform doctrine, not study-prep-private, and `contextManager.load({...})` is a generic API — so a
**separate, explicitly-scoped follow-up phase** can migrate existing consumers (e.g. regenerate
`tutorSystemPrompt()`'s blocks from `AGENT.md + LEARNING.md + TOOL_RULES.md`; let the python agent's
reasoning modules read the same files) with its own contract tests. That migration is *out of scope* here
and must never happen implicitly.

> **That follow-up phase now exists as its own mini-plan** (drafted 2026-10-01, after the study-prep loop
> shipped): see `Akoro Context Layer Adoption — Mini-Plan All Agentic Surfaces.md` — extended from
> "chat + persona agents" to all 41 LLM call sites + the python agent, with byte-identical golden gates
> per phase.

### 4.7 `deliberate()` — rescope, not retirement (S2, S5; overrides S4)

`deliberate(decision_node, facts)` remains in the codebase but changes job: it is the **harness's narration
generator**, never the agent's cognition and never a decision-maker.

- Input: a `decision_node` from a closed enum (`harness_rejection` with reasons `insufficient_balance`,
  `attempt_cap_exceeded`, `prerequisite_violation`, `tool_not_permitted`, `strategy_not_permitted`,
  `agent_loop_cap`; plus confirmation, advance, defer, gate nodes) + **typed facts** only.
- Output: a short English narrative + `policy_version`, written to `study_prep_events.narrative` as a
  **cache** — the facts are the truth, the narrative is renderable text.
- Templates are snapshot-tested over harness decisions only (`deliberateNarration.snapshot.test.mjs`).
- What is *not* stored: the LLM's hidden chain-of-thought. The visible trace is "what did the agent just do,
  what did the harness decide, what did it observe" (S5) — activity labels, not thinking theatre (S2).

### 4.8 Changes to existing code (S4 §8 + S5, reconciled)

1. **Extract the exam-prep service** — move `startRun`, `generateAttempt`, `submitAttempt`, `startRetest`
   out of the `exam-prep-confidence.js` router into `modules/adaptive-learning/exam-prep-service.js`.
   The router keeps auth + envelope; the service owns state. No behaviour change; existing tests move with it.
2. **Fix the submit race** — single conditional write path: the run update gains `.eq("status", expected)`,
   the attempt update's win is checked, and the two writes are sequenced (attempt first, run second) so a
   losing concurrent submit returns `attempt_already_submitted` instead of double-scoring.
3. **Workflow list grouping** — `listLearnerWorkflows` groups exam-prep rows by `study_prep_session_id`
   (one list entry per session, topics nested); sessions never crowd out other workflow types.
4. **Controller → agent loop** — the new `study-prep/agent-loop.js` (§4.3) is the only driver of session
   steps; the topic workflow (exam-prep service) is invoked by the harness, not by the router directly.
5. **Harness-only ops** — scoring, charging, transitions, evidence appends move behind the harness.
6. **Teach-back gate** — retest generation requires `learnerConfirmedReady`; `TeachAgentModal.jsx` itself is
   unchanged.
7. **Outcome write-back** — engine appends evidence + updates concept state (§4.5).
8. **Chat surface** — `start_study_prep_session` / `get_study_prep_session` registered as **plan-only** chat
   tools: they can create a planning session and read its state, but confirm / advance / defer / generate are
   **not model-callable** — the learner presses the buttons (S5 §6.3–6.4).

### 4.9 API & chat surface

- **REST:** the existing exam-prep surface is **unchanged**; the plan-card confirm is a REST gate (S4 build
  step 5), concretized as minimal additive learner endpoints, all envelope-compliant:
  `GET /study-prep/sessions/:id` (session + topics + replayable events), `POST /study-prep/sessions/:id/confirm`
  (approve plan), `POST /study-prep/sessions/:id/adjust` (drop/reorder topics pre-confirm),
  `POST /study-prep/sessions/:id/topics/:topicId/teach-back-done` (sets `learnerConfirmedReady`),
  `POST /study-prep/sessions/:id/{pause,resume,cancel}`. All 4xx carry stable machine-readable `code`s from
  the harness rejection set; 402 for wallet-driven pauses; 500 only for genuine faults.
- **Chat tools (LLM-facing, gated by `AKORO_STUDY_PREP_ENABLED`):**
  `start_study_prep_session(goal, subject, class_level, entry_mode)` — creates the session **and runs one
  agent-loop iteration to produce a plan + cost; no generation, no spend** (S5 §6.3);
  `get_study_prep_session(sessionId)` — read-only status. No model-callable confirm, advance, defer or
  practice — those live inside the session loop, not in chat.
- **Feature flag:** `AKORO_STUDY_PREP_ENABLED` gates everything; disabled → `study_prep_disabled` (409),
  matching the house flag pattern.

### 4.10 Frontend (`akoro-learner`)

1. **Plan card** (S1 step 13 fidelity): subject title, topic count, estimated cost (coins, loop cost
   included, rounded), numbered topic list, **[ Approve & Start ] [ Adjust ]**.
2. **Session view:** active topic tracker (queued/active/understood/flagged/capped/deferred), the agent
   activity feed — harness narration in the house style, agent intent rendered as **"agent says:"**, visually
   distinct, never bolded, never factual-styled (Decision 2).
3. **Honest pacing:** real elapsed time per iteration (`duration_ms` from events); an 80 ms short-circuit
   shows as 80 ms. No fabricated thinking pauses.
4. **Replay:** the events table is the source of truth; the UI replays the log exactly and never re-runs the LLM.
5. **Paused states:** `agent_loop_cap` → "I got stuck — tap to retry or adjust."; `insufficient_balance` →
   402-linked top-up flow, session resumable.
6. Existing modals untouched: `TeachAgentModal.jsx` remains the teach-back surface.

### 4.11 Cost, billing & concurrency (S4 §9 + S5)

- **Wallet-first:** `practice.generate` charges before generation; on failure nothing is generated and no
  partial state is written.
- **Zero coins before confirm** — enforced by the state machine, not by UI.
- **Estimate:** `estimate_session_cost` = per-topic generation cost + per-loop LLM cost at a rounded value,
  shown on the plan card so the learner is never surprised (S5 still-open item, adopted as recommendation).
- **Single-writer:** the harness is the only writer; conditional updates everywhere; concurrent confirms
  produce one transition and one winner.
- **Autonomy:** no background daemons, no notifications, no autonomous sessions outside the active
  learner-driven session (standing guarantee).
- **Connection discipline:** all queries go through the configured runtime pool (pool max 5 — see the
  pool doctrine in `config/index.js` / `lib/dbPool.contract.test.mjs`); no ad-hoc clients.

### 4.12 Decision register (S5 §10 + carried; conflicts resolved per §Precedence)

| # | Decision | Resolution |
|---|---|---|
| 1 | Max agent iterations per step | **6** — enough for research → draft → verify → act; bounds cost |
| 2 | Agent intent display | **"agent says:"**, visually distinct from harness narration; never bolded, never factual-styled |
| 3 | Agent proposes outside curated strategy list | Reject with `strategy_not_permitted`; agent re-picks from the list |
| 4 | Valid-but-suboptimal plan | Harness enforces **hard constraints only** (prereqs, caps, budget); soft ordering is the agent's call; engine records outcomes for review |
| 5 | Retry of capped topic | One deferred retry per session, attempts reset |
| 6 | Cram mode | `max_attempts = 1`, depth `diagnostic_only` |
| 7 | Session topic cap | **12** |
| 8 | Loop cap without terminal action | Session `paused(agent_loop_cap)`; learner sees "I got stuck — tap to retry or adjust." Never silent |
| 9 | Replaying a session | Events table is the source of truth; UI replays the log; never re-runs the LLM |
| 10 | `deliberate()` | **Rescoped to harness narration** (S5 newest wins over S4's retirement): decision_node enum + typed facts + `policy_version`, snapshot-tested |
| 11 | Events schema | **Union** of S4 + S5 (§4.1): S5's origin/agent_intent/narrative/event-type set + S4's `sequence UNIQUE`, `thought_type`, `duration_ms` |
| 12 | Tool catalogue | **Union** (§4.2): S5 registry + S4's `plan.validate`, `topic.flag`, `session.replan`, `learner.get_history` |
| 13 | Labels vs ids in facts | Store both; render label, fall back to id |
| 14 | `content.search` in the loop | Start **without** it (syllabus + learner state is enough for a plan); add only if plans are visibly worse |

### 4.13 Contract tests (repo convention: `*.contract.test.mjs`, `node --test`, no LLM in the test path)

- `examPrepService.contract.test.mjs` — service extraction behaviour-preserving; **double-submit race**: two
  concurrent submits → one winner, one `attempt_already_submitted`; concurrent confirm → one transition.
- `studyPrepHarness.contract.test.mjs` — every state-machine transition + every rejection code; prereq
  violation rejected then agent re-proposal accepted; teach-back gate (`retest` without
  `learnerConfirmedReady` → rejected); 12-topic cap; deferred-retry-once; cram `max_attempts = 1`.
- `toolRegistry.contract.test.mjs` — permission levels; harness-only tools absent from the LLM-facing
  registry; argument schema validation.
- `agentLoop.contract.test.mjs` — stub agent: terminal actions; `maxIterations` 6 → `agent_loop_cap` pause
  with no partial state; 402 observation → `paused(insufficient_balance)`, resumable, no lost topic; 40-call
  session guard.
- `educationEngine.contract.test.mjs` — scoring, threshold routing, mastery write-back with fixed fixtures
  (relative dates only — no time bombs; see the pilotModel lesson).
- `studyPrepEvents.contract.test.mjs` — append-only; `sequence` uniqueness; `origin` tagging; every
  `agent_intent` length-capped and origin-tagged — schema test fails if any other LLM-origin string appears
  in events; no answer keys / raw chat in `facts`.
- `deliberateNarration.snapshot.test.mjs` — narration templates over harness decision nodes.
- `contextLayer.contract.test.mjs` — per-operation file selection; size budgets; no state in files.
- `chatTools.contract.test.mjs` — study-prep chat tools are plan-only (confirm/advance/generate not
  model-callable); flag-off → `study_prep_disabled`.
- `adaptiveWorkflows.contract.test.mjs` (extended) — session grouping; six-topic session leaves other
  workflow types visible.

### 4.14 Acceptance tests (S5 §11 list + S4 additions, deterministic fixtures, stubbed agent)

1. Stub agent emits `propose_plan` with a prereq-violating order → harness rejects, agent re-proposes a valid
   order; both `harness_decision` rows snapshotted.
2. Stub agent emits `practice.generate` with `attempts_remaining = 0` → rejected `attempt_cap_exceeded`;
   agent observes and picks `offer_strategy` or `defer_topic`; **no generation cost charged**.
3. Stub agent loops past `maxIterations` → session pauses `agent_loop_cap`; no partial state.
4. Concurrent confirm → one transition, one winner.
5. 402 mid-loop → paused, resumable, no lost topic.
6. Teach-back gate: `practice.generate(mode: 'retest')` without `learnerConfirmedReady` → rejected.
7. Six-topic session leaves other workflows visible in the list.
8. No coins spent before confirm (wallet ledger assertion).
9. Session summary contains only recorded facts, never agent intent.
10. Every `agent_intent` field is length-capped and origin-tagged; schema test fails on any other LLM-origin
    string in events.
11. (S4) Events replay reproduces the session exactly without any LLM call.
12. (S4) Workflow list shows one entry per session with topics nested.
13. (S4) Mastery write-back produces evidence rows + updated `learner_concept_state` per the deterministic
    policy.
14. (S3) Agentic inspection: a stub agent that observes a weak sub-concept from `learner.get_state` goes on
    to call `learner.get_history` before planning — tool choice driven by the previous observation, not a
    fixed sequence; the context selection for the planning step includes the reasoning/inspection files.

### 4.15 Build order (S5 §11 revised, with S4 folded in)

0. **Preflight:** confirm JSS1 Basic Science rows in `edu.syllabus_*` and past-question bank coverage —
   blockers for P3 (do not promise verified past questions until counted).
1. **Extract exam-prep service + fix the submit race** (§4.8.1–2). Pure refactor; suite stays green.
2. **Session tables + harness skeleton + tool registry** (§4.1, §4.2, §4.4). Deterministic, no LLM. Every
   transition is a conditional update with a unit test, including concurrent-confirm no-op and double-submit.
3. **`deliberate()` narration + event log** (§4.7). Snapshot-tested over harness decisions only. Still no LLM.
4. **Syllabus resolver on the DB tables** for JSS1 Basic Science (ingest first, per P0).
5. **Education Engine as pure functions** (§4.5) — score, threshold, mastery write-back; fixed fixtures.
6. **Context layer + Context Manager** (§4.6), with the per-operation selection sets.
7. **Agent loop, one iteration at a time** (§4.3). Start with a stub agent that calls `syllabus.resolve`
   then `propose_plan`; ship that end-to-end. Then add the observation log and real reasoning.
8. **Plan-only chat tool + plan card + confirm** (§4.9, §4.10.1). No generation yet.
9. **Topic loop in the UI driven by the harness's `sessionNext` step**, rendering the agent activity log with
   honest pacing and replay (§4.10.2–5).
10. **Course resolver, then material resolver** (entry modes beyond `syllabus`).

Each phase lands behind `AKORO_STUDY_PREP_ENABLED` (default off) and ships with its contract tests from §4.13.

### 4.16 Still open (tracked, not blocking the build)

- **Agent intent quality** — the field can drift toward CoT. Cap hard (≤240 chars), schema-validate, audit a
  sample; tighten until it's a one-sentence stated purpose.
- **Per-loop LLM cost** — priced into the plan-card estimate at a rounded value (adopted); revisit the
  rounding with real usage data.
- **`defer_topic` vs `flag_and_skip` on cap-out** — both valid; the agent picks, the engine records which;
  decide after data shows which reads better to learners.
- **`content.search` in the loop** — read-only but adds latency/tokens; start without (Decision 14).
- **Guardian Angel** — nothing yet verifies teach-back claims against approved sources. Unresolved.
- **Pace profile** — flat default until there's evidence for anything smarter.
- **JSS1 Basic Science ingestion + past-question bank coverage** — confirmed row counts required (P0).
- **Replay UI fidelity** — events are the source of truth; exact replay presentation is a design call during P9.

---

## 5. What never changes

- The learner approves spend; the LLM never does. Zero coins before confirmation.
- The Education Engine decides scores and mastery; the LLM never does.
- The harness owns state; the agent only proposes. The database referees transitions.
- No chain-of-thought storage; no answer keys client-side; no raw chat in event facts.
- One response envelope, stable machine-readable 4xx `code`s, 500 only for genuine faults.
- No autonomous sessions, no background daemons, no notifications outside the active session.
- The existing exam-prep topic workflow and `TeachAgentModal` keep working throughout — every phase is
  additive behind `AKORO_STUDY_PREP_ENABLED`.
