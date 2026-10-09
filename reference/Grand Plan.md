# Akoro Learning Agent — Grand Plan

**Status:** the implementation plan. Supersedes every document in
`reference/full-agent-workflows/` and `reference/Exam-prep-workflow-v2/` for
build purposes. Those remain as research history.

**How it was made:** consolidated from both folders, with
`Master End-to-End Implementation Plan — v3` as the primary source, the
`AKORO ADAPTIVE LEARNING & AGENT WORKFLOW` master as the rulebook
(hardening, ownership, failure handling), and `Akoro Study-Prep — Master Plan
(v7)` as the record of what is actually built. Every "exists" claim below was
checked against the code on 2026-10-09.

**Legend:** ✅ built · 🟡 exists, needs change · 🆕 new · ❓ verify before building

---

## Contents

1. Purpose and the one-paragraph idea
2. Non-negotiable rules
3. Vocabulary (locked)
4. Locked decisions
5. Architecture
6. Current code baseline and migration map
7. Shared infrastructure
   - 7.1 Workflow Engine
   - 7.2 Agent Runtime (the loop)
   - 7.3 Harness
   - 7.4 Context Manager
   - 7.5 Tool system
   - 7.6 Education Engine
   - 7.7 Adaptive Learning Engine and Strategy Library
   - 7.8 Learner Model
   - 7.9 Event stream, narration and transport
   - 7.10 Cost, concurrency, idempotency
   - 7.11 Model switching
   - 7.12 Agent Check
   - 7.13 Peer agent help
   - 7.14 Blog research
   - 7.15 Learning struggle taxonomy
8. Workflow 1 — Study Prep
9. Workflow 2 — Teaching (agent-driven)
10. Workflow 3 — Decay Review
11. Workflow 4 — Practice (live proctored assessment)
12. Cross-workflow relationships
13. Dashboard and frontend
14. Data model and migrations
15. API surface
16. Feature flags
17. Implementation phases
18. Acceptance tests
19. Failure tests
20. Open questions / verify before building
21. Source map

---

## 1. Purpose and the one-paragraph idea

Akoro runs **four durable learning workflows** — Study Prep, Teaching, Decay
Review and Practice — on **one shared agent runtime**.

In every workflow, an **agent** (LLM) looks at the current situation, decides
what it needs, and proposes one action at a time. A **harness** (code) decides
whether each action is allowed and performs it. A **deterministic Education
Engine** (code) scores, applies thresholds and records evidence. A **Context
Manager** selects the minimum set of workspace MD files for the current
operation. **Workflow state** lives in the database and is only changed by
code. Every significant step emits a **structured event**, which is stored,
replayable, and rendered in the UI as thinking blocks, tool groups and
activity messages.

> The states are deterministic. The path through them is adaptive.
> The agent decides *what to do next*. Code decides *what is allowed* and *what
> actually happened*.

---

## 2. Non-negotiable rules

These hold for every workflow. An implementation that breaks one is wrong even
if its tests pass.

**Authority**
1. The LLM proposes; the harness disposes; the database confirms.
2. The LLM never decides scores, pass/fail, thresholds, mastery, charges, or
   state transitions.
3. The LLM never directly mutates workflow state, evidence, mastery or the wallet.
4. LLM output is an observation/proposal, never ground truth.
5. Strategies come only from the versioned, approved Strategy Library.
6. Workspace Markdown is guidance, not authority. Limits live in code.

**Learner control**
7. No coins are spent on Study Prep learning work before the learner confirms the plan.
8. Learner gates (approve plan, start teaching, submit answers, top-up,
   resume) cannot be bypassed by the agent.
9. The agent only runs inside a workflow the learner started, on a trigger.
   No background workflow spends coins without learner authorization.

**Safety and privacy**
10. No hidden chain-of-thought is stored or shown. The UI shows bounded,
    learner-safe narration only.
11. Answer keys stay server-side and never enter the LLM context unnecessarily.
12. No backend names (tool names, parameter syntax, service names) reach the
    learner UI. Developer mode is the only exception.
13. Approved content only. No open web research in learner workflows.
14. Closing claims stay inside the evidence ("demonstrated on generated
    practice", never "mastered the term").

**Durability**
15. Workflows persist independently of the UI that launched them: closing a
    modal, refresh, logout, navigation, socket disconnect, app backgrounding.
16. "Continue" means resume an existing workflow. It never creates a new one
    unless the old one is terminal.
17. All state transitions are conditional (compare-and-set) and concurrency-safe.
18. All workflow actions that create things are idempotent.
19. All autonomy is bounded: iterations, tool calls, retries, strategy
    changes, cost.

**Boundaries**
20. WebSocket/SSE is transport, never business logic, never the workflow.
21. A child workflow never mutates its parent. It emits an outcome; the parent
    validates it and changes its own state.
22. Study Prep–created teaching and Dashboard teaching are the **same**
    Teaching Workflow. There is no second teaching implementation.
23. Study Prep chat never performs teach-back itself. It creates a Teaching
    Workflow.
24. Learner data lives in the database, never in MD files.

**Each layer answers one question**

| Layer | Question |
|---|---|
| Workflow state | Where are we? |
| Operation | What are we doing now? |
| Agent loop | What should happen next? |
| Context Manager | What should the LLM see for this step? |
| Harness | Is that action allowed? Execute it. |
| Education Engine | What actually happened? Record it. |
| Adaptive Learning Engine | How should we adapt? |

---

## 3. Vocabulary (locked)

Use these terms in code, comments, events, tests and docs.

- **Workflow** — a durable learner experience with identity, lifecycle, state
  machine, operations, controller, agent loop, events and outcome. Exactly
  four types: `study_prep`, `teaching`, `decay_review`, `practice`.
- **Workflow instance** — one persisted run of a workflow (`workflow_instances` row).
- **Workflow state** — the persisted lifecycle state. Changed only by code.
- **Sub-state** — a state inside a workflow state that is persisted on a
  domain row (e.g. a Study Prep topic's state, a Teaching phase).
- **Operation** — the kind of work happening now inside a state (e.g.
  `research`, `strategy_selection`). Not persisted as state. Carried on every
  event. Selects context and permitted tools.
- **Workflow controller** — the per-workflow code that owns states,
  transitions, permitted operations, wake triggers and outcomes.
- **Controller agent** — the LLM that drives a workflow through the shared
  agent loop. One per workflow type.
- **Agent loop** — the shared runtime cycle: context → LLM → one structured
  action → harness → execute/reject → observation → repeat.
- **Turn** — (Teaching, Decay) one learner message and the system's full
  response to it.
- **Step** — (Study Prep, Practice) one wake of the agent loop.
- **Harness** — the security/control boundary that validates and executes.
- **Education Engine** — deterministic scoring, thresholds, evidence, mastery.
- **Adaptive Learning Engine** — shared evidence/strategy/mastery/retention
  logic. Not a workflow.
- **Protégé (Student Agent)** — the AI learner the human teaches. A tool.
- **NaNa Esumai** — the teaching guide persona. A tool.
- **Sargeant** — the assessment/boundary persona. A tool.
- **Agent Check** — practice in which NaNa asks, the learner's agent answers
  from its owner's notes only, and Sergeant judges (§7.12). No human answers.
- **Outcome** — the formal result a workflow emits on completion/abandonment.
- **Handoff** — a parent workflow creating a child workflow (e.g. Study Prep → Teaching).
- **Narration** — learner-safe text describing what the system is doing.
  Generated from typed facts and/or the agent's bounded intent. Never raw reasoning.

Names to stop using as architectural concepts: "Study Prep Agent", "Teaching
Agent", "Decay Agent" (say *workflow* + *controller agent*); "adaptive
session mode" (`fresh | continuation | decay`); "Adaptive Learning Workflow"
(it is an Engine).

---

## 4. Locked decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | How many workflows? | **Four:** Study Prep, Teaching, Decay Review, Practice. | v3. Practice built last (Phase 9) so it can lean on finished infrastructure. |
| D2 | Who drives each workflow? | **A controller agent through the shared agent loop**, in all four. | User decision. Nothing is a fixed tool sequence any more. |
| D3 | What stays fixed in code? | States, legal transitions, scoring, thresholds, caps, strategy library, learner gates, charging, evidence writes, progression gates, and **mandatory harness steps** that run every turn. | Rules are fixed; the path is not. |
| D4 | Teaching driver | **Teaching controller agent.** Protégé (Student Agent) and NaNa are **tools** it calls. They do not decide anything. | User decision. |
| D5 | Teaching turn shape | **Fixed pre-steps → agent loop → fixed post-steps.** Evidence observation, evidence recording and the progression gate always run. | Keeps the protection the fixed pipeline gives today. |
| D6 | Teaching loop termination | **The loop ends as soon as the agent replies to the learner.** | User decision. Keeps live chat latency low. |
| D7 | Teaching loop cap | **Max 3 decision iterations per turn** (`TEACHING_POLICY.MAX_ITERATIONS_PER_TURN`). | User decision. |
| D8 | Teaching timeout | **On decision timeout, malformed output or LLM failure, fall back to the default recommendation** (the existing dialogue-move → action table). | User decision. The learner always gets a reply. |
| D9 | What streams into a thinking block? | **The provider's reasoning *summary* when the chosen model offers one** (OpenAI reasoning models via the Responses API — already used by agent-chat Think mode; Claude with `thinking.display: "summarized"`), streamed live. **Otherwise** (e.g. the default `gpt-4o-mini`) the agent's `intent` streamed as it is generated, then the harness narration. Raw chain-of-thought is never available or shown. Summaries are shown live but **not stored**; on reload the block shows the stored narration. | Matches the coding-agent experience and the existing `ThoughtBlock`, without exposing hidden reasoning. |
| D27 | Activity text | **The agent may write its own short learner-facing message** with each action (`message`, ≤ 400 chars, streamed as an activity block), like the text a coding agent writes between tool calls. Facts in it (scores, pass/fail, coins) must come from the harness: the narrator inserts them; the model's text may not state them. | Makes the stream read like a coding agent instead of only templates. |
| D28 | Where the live stream UI is used | **Only the Agent Chat tab** (`AgentChatTab.jsx`) renders the coding-agent stream (thinking → tool rows → activity → reply), including Study Prep and any workflow shown in chat. **`TeachAgentModal` keeps its current UI** (and `DecaySessionModal`, which shares that design), and **`AssessmentRoom` keeps its UI** for Practice (D29). The backend still emits and stores the same events for every workflow; the modals just don't render them as a trace. | User decision. |
| D29 | What Practice is | **Practice = the live proctored assessment** (`AssessmentRoom` + Session Assessment Gateway + Sergeant). The agent chooses questions, probes and hints; proctoring, scoring and the verdict stay in code. `AssessmentRoom` keeps its UI. | User decision (§11). |
| D30 | No syllabus found | Syllabus is resolved **class → school → platform → AI-generated**. `syllabus.generate` is allowed only after the other three return nothing; the draft is grounded on the national curriculum, checked by code, saved as provisional, and always labelled as AI-drafted (§8.7). | User decision: a missing syllabus must never block a learner. |
| D31 | How practice works | **Agent Check** (§7.12): NaNa asks, the learner's agent answers only from its owner's notes, Sergeant judges, the Education Engine scores. No human answers. Replaces `practice.generate/submit` in Study Prep, Teaching and Decay. The proctored assessment stays human and separate. | User decision: practice tests the agent, like Battles. |
| D32 | Decay `retrieval_practice` | **Stays human recall for now** — the one place outside the proctored assessment and guide mode where the learner answers questions. Its answers are scored server-side and tagged `source: "learner_recall"`; the Agent Check still runs the retention check and retest. Revisit later. | User decision (Q16). |
| D33 | Files and non-traditional goals | Study Prep accepts files; they are saved to the learner's Records library and indexed. For scholarship/competition/custom goals the agent builds the syllabus from the files, asks once for a syllabus or materials if there are none, and only then drafts one (§8.8). | User decision. |
| D34 | Peer agent help | Peers share **breakthroughs, not knowledge**: when a learner gets past a misconception or repeated failure, Akoro records the struggle and what worked (`edu.learning_struggles`). A stuck learner's agent sends only the struggle and gets up to 3 matching stories plus the most effective strategy across ≥ 5 learners. Opt-in, off by default (Settings → Agent); never evidence; `peer_help` joins Strategy Library v2 (§7.13). | User decision. |
| D35 | Blog research | Upgrade blog search to passage-level hybrid search over article bodies, with citations; used for study methods and strategy, never as syllabus or evidence (§7.14). | User decision. |
| D36 | Cross-learner strategy pattern | Counted over **all learners, anonymously** — totals only, shown only when ≥ 5 learners match. Individual stories still need the learner's opt-in. The privacy policy states that anonymous learning statistics are used to recommend strategies. | User decision (Q18). |
| D37 | Recording struggles and breakthroughs | Every workflow records misconceptions, gaps, recoveries and strategy outcomes through one Education Engine recorder into `learner_concept_evidence`; breakthroughs are detected from those events; existing teaching and exam-prep history is backfilled. Built early (Phase 4a), because Agent Checks, peer help and the strategy pattern depend on it (§7.8.1). | Gap found 2026-10-09: today only Study Prep pass/fail and the Python service write evidence. |
| D38 | Struggle taxonomy | A closed, versioned list of **41 struggle types in 8 categories** (§7.15): each with how it is detected (rule / agent / learner), when it counts as resolved, whether it is concept-tied and whether it may be a peer story. Struggles and breakthroughs share one table (`edu.learning_struggles`). Six sensitive types (anxiety, health…) are type-and-date only, never stories, learner-deletable; health expires in 30 days. | User decision. |
| D10 | Who writes narration? | **Harness templates** (`ActivityNarrator`, grown from `narration.js:deliberate()`) for facts; the agent's `intent` (≤ 240 chars, sanitised, untrusted display text) for "why". v3's `narration` field **is** `intent`. | Deterministic where possible (v3 §40), already built (v7). |
| D11 | Event store | New generic `edu.workflow_events`. `study_prep_events` is kept read-only and backfilled. | One stream model for four workflows (v3 §43). |
| D12 | Live transport | **Event store is the source of truth; transport is replaceable.** Teaching and Decay keep the existing Socket.IO connection. Study Prep and Practice use SSE (same heartbeat pattern as `/chat/agent`). Both carry the identical event envelope. Replay: `GET /api/workflows/:id/events?after=N`. | v3 §42–43; reuses what already works. |
| D13 | Context registry | **`manifest.mjs` stays the only registry.** No frontmatter discovery. Operation → set mapping lives in code per workflow. New MD files go under `akoro-api/akoro-agent/`. | v7 D18; the manifest has contract tests and a boot preflight. |
| D14 | Event categories | The v3 controlled taxonomy (11 categories). UI pills are derived from categories by one mapping function. | v3 §57; v7's 6 pills become a subset. |
| D15 | Interventions in Study Prep | **Every intervention is a Teaching Workflow** (`teach_agent` mode) — because the check tests the agent, the fix has to go into the agent's notes. The chosen strategy (teach_back, different_analogy, …) shapes how NaNa coaches inside that session. The topic waits in `awaiting_teaching`; retest unlocks on `TEACHING_COMPLETED`. No inline interventions, no "Ready for retest" gate. | v3 §28–30, revised by D31. |
| D16 | Topic state model | **One topic state machine** (§8.3). The exam-prep run stays as the per-attempt record, not a second state authority. | Removes the two-state-machine overlap. |
| D17 | Teaching phases | `PHASE_1 → PHASE_4 → MASTERY` are kept as the **progression sub-state inside `teaching_active`**, driven only by `applyTeachingProgress`. | Reconciles v3 states with the existing, tested gate. |
| D18 | `evidence_capture` (v3 Teaching state) | **Becomes an operation**, not a persisted state. Evidence is captured every turn; flipping persisted state every turn adds writes and races for no gain. | Only deviation from v3's state list. |
| D19 | Module layout | Promote, don't relocate: generic engine/runtime under `modules/adaptive-learning/workflows/` and `modules/adaptive-learning/agent-runtime/`; per-workflow folders beside `study-prep/`. Context stays in `modules/agent-context/`. | Full structure 2; lowest churn; keeps contract-test imports stable. |
| D20 | Migration strategy | Generalise the existing Study Prep engine first. **Existing contract tests must stay green** at every phase. Teaching, Decay, Practice move onto it after. | Full structure 2 §26. |
| D21 | Learner model scale | Concept state 0–1 is canonical. `knowledge_confidence` (0–100) is read as `/100` fallback only. Never mix scales silently. | All sources agree. |
| D22 | Billing | Every LLM call already meters through `lib/aiModel.js` → `chargeForAI`. The harness checks balance before each paid action. Study Prep keeps its plan estimate + ceiling. Teaching/Decay are metered per call (§7.10). | Matches today's billing. |
| D23 | Which LLM? | **Learners can switch models** (GPT, Claude Sonnet/Opus/Haiku/Fable, Grok, DeepSeek, …) from a picker in the chat box; **default stays `gpt-4o-mini`**. The choice drives every call in their session (chat, controller agents, personas) except assessment/evidence judging, which env keeps fixed. Models, prices and providers are declared in env (§7.11). | User decision: stronger models for learners who want better results, billed at that model's price. |
| D26 | Models per plan tier | **Every tier defaults to `gpt-4o-mini`.** Which models a tier may switch to is an admin-editable `allowed_models[]` on the `tiers` table (§7.11.5a). | User decision on the default; per-tier lists follow the existing gated-features pattern. |
| D25 | `retrieval_practice` strategy | **Added in Strategy Library v2**, permitted in **Decay Review and Practice only**; not in Study Prep for now. | User decision. Decay is forgetting, not misunderstanding; recall is the cheap first fix (§10.2). |
| D24 | Teaching modes | **Two modes in one Teaching Workflow:** `teach_agent` (learner teaches the protégé, NaNa coaches) and `learn_with_guide` (NaNa teaches the learner directly, **no protégé**). Same states, transcript, evidence pipeline and progression gate. The learner can switch between turns. | User decision. "Learning from the teacher" and "teaching an agent with the teacher's guidance". |

---

## 5. Architecture

```
                              AKORO
                                │
                         WORKFLOW ENGINE
         (instances · registry · lifecycle · relationships · outcomes)
                                │
     ┌──────────────┬───────────┼────────────┬──────────────┐
     ▼              ▼                        ▼              ▼
 STUDY PREP     TEACHING               DECAY REVIEW      PRACTICE
 controller     controller              controller       controller
 states/ops     states/ops              states/ops       states/ops
     └──────────────┴───────────┬────────────┴──────────────┘
                                ▼
                   ADAPTIVE LEARNING ENGINE
                 evidence · strategy · mastery · retention
                                │
                                ▼
                          AGENT RUNTIME
                ┌───────────────┼────────────────┐
                ▼               ▼                ▼
         CONTEXT MANAGER       LLM            HARNESS
         manifest.mjs     (one action      permissions · schema ·
         + dynamic data    + intent)       state · budget · caps ·
                                           concurrency · idempotency
                                                 │
                                                 ▼
                                               TOOLS
                          read · propose · execute · persona tools
                                                 │
                                                 ▼
                                        EDUCATION ENGINE
                              score · threshold · evidence · mastery
                                                 │
                                                 ▼
                                          LEARNER MODEL
                                                 │
                  every step ──────────►  EVENT STORE (workflow_events)
                                                 │
                                   Socket.IO / SSE / replay endpoint
                                                 │
                          Study Prep chat · Dashboard · Teaching modal ·
                                 Decay modal · Practice view
```

**Runtime relationship (one loop iteration)**

```
WORKFLOW STATE + OPERATION + CURRENT OBSERVATION + LEARNER DATA
        ↓
CONTEXT MANAGER  → context set (manifest) + dynamic learner context
        ↓
LLM              → { operation, tool|action, args, intent }
        ↓
HARNESS          → allowed? valid? affordable? legal? within caps?
        ↓                         ↓
     execute                   reject → observation (code) → agent adapts
        ↓
TOOL / EDUCATION ENGINE → observation
        ↓
CONTROLLER       → deterministic transition (if any)
        ↓
EVENTS           → store → transport → UI
        ↓
next iteration, or stop (terminal action · learner action required ·
child workflow required · cap · pause · completion)
```

**Authority hierarchy**

```
DATABASE / DETERMINISTIC ENGINE   decides: score, pass, charge, transition,
        ↑                                    create authorised workflow,
      HARNESS                                update mastery, complete
        ↑
       LLM                         may: recommend, interpret, select,
                                        propose, explain
```

---

## 6. Current code baseline and migration map

### 6.1 What exists today

| Area | Today | Notes |
|---|---|---|
| Study Prep | ✅ Real workflow: `study-prep/` (state machine, harness, agent loop, LLM adapter, education engine, events, narration, store, routes, wiring, read tools, syllabus resolver) + 7 contract test files | Agent loop runs **only** for `planning`/`replanning`. `wiring.js` hard-codes `setName: "planning"`. Topic progression is REST + harness fast path. |
| Study Prep topic attempts | ✅ `exam-prep-service.js` + `edu.adaptive_workflow_runs` with run states `researching → planned → diagnostic_ready → teach_back_required → retest_ready → passed / change_approach` | A second state machine for the same topic. |
| Old workflow state | 🟡 `workflow-state.js`, `adaptive-workflows.js` | Exam-prep projection. To be absorbed. |
| Teaching | 🟡 Socket.IO `start_adaptive_session` with `mode: fresh | continuation`; rows in `edu.adaptive_sessions`; `teaching-session/lifecycle.js` (row writes), `teaching-session/state-machine.js` (pure phase gate `applyTeachingProgress`, `ACTION_FOR_DIALOGUE_MOVE`) | Each turn runs a **fixed 8-step pipeline** (`teaching-workflow/runner.js`). The model never chooses steps. |
| Decay | 🟡 Same socket, `mode: "decay"` → `sessionType = "decay_review"`; `decayEngine.generateDecaySession`; runs the teaching pipeline with a decay payload | No states of its own. Scheduler `runDecayScheduler` in `decayEngine.js`. |
| Practice capability | 🟡 `practice.generate / practice.submit` inside Study Prep (human answers) · ✅ Battles: `battle/agentRecall.js` (agent answers from the learner's notes only), `battle/questionSource.js`, single-learner "study review" mode | Replaced by the Agent Check (§7.12), built from the battle code. |
| Context | ✅ `modules/agent-context/` — `context-manager.js`, `manifest.mjs` (6 joined study-prep sets + verbatim chat/persona sets), workspace at `akoro-api/akoro-agent/` (65 MD files) | Budget: 8 192 B/file, 24 576 B/set. |
| Tools | ✅ `tools/registry.js` — 17 study-prep tools in 3 levels (read / propose / execute) + `HARNESS_ONLY_OPERATIONS` | Study Prep only. |
| Learner state | 🟡 `learner_concept_state`, `learner_concept_evidence`, `knowledge_confidence`, `student-state.js` (`decideNextAction`), `teaching-evidence.js` | Several representations; `decideNextAction` is a competing decision-maker. |
| Streaming | ✅ SSE with Cloudflare heartbeat on `/chat/agent` (`chat.js`) · ✅ Socket.IO for teaching | No Study Prep stream. No generic event store. |
| Billing | ✅ every LLM call metered via `lib/aiModel.js` → `chargeForAI`; Study Prep plan estimate + ceiling in harness | |
| Frontend | 🟡 `TeachAgentModal.jsx`, `DecaySessionModal.jsx` call `start_adaptive_session` directly; `LearnerDashboard.jsx` infers type from session shape; `StudyPrepChatCard.jsx`, `AgentChatTab.jsx`, `studyPrepApi.js` | "Learning with guide" toggle in `TeachAgentModal` is UI-only, not wired (see §20). |
| Generic workflow tables | 🆕 none (`workflow_instances`, `workflow_events` do not exist) | |

### 6.2 Migration map

| Current | Target | Action |
|---|---|---|
| `study-prep/state-machine.js` | Generic transition mechanism + `study-prep` definition | Generalise; keep exports stable |
| `study-prep/harness.js` | Generic harness core + Study Prep checks | Generalise |
| `study-prep/agent-loop.js` | `agent-runtime/agent-loop.js` | Promote |
| `study-prep/llm-agent.js` | `agent-runtime/llm-agent.js` | Promote (add operation + timeout) |
| `study-prep/events.js` | Event envelope + stamping | Promote, extend to v3 schema |
| `study-prep/narration.js` | `ActivityNarrator` | Promote, add templates for all workflows |
| `study-prep/store.js` | Workflow store + Study Prep store | Generalise |
| `study-prep/education-engine.js` | Education Engine | Promote, expand (retention, teaching evidence) |
| `study-prep/read-tools.js`, `tools/registry.js` | Per-workflow tool registries over one binder | Generalise |
| `study-prep/wiring.js` | Study Prep composition root | Keep; replace hard-coded `planning` set |
| `adaptive-workflows.js` + `workflow-state.js` | Absorbed into workflow store/projections | Deprecate after Phase 4 |
| `exam-prep-service.js` | Attempt adapter (generate / submit / retest) | Keep; remove status-routing authority |
| `teaching-workflow/runner.js` | Replaced by the agent-driven teaching turn | Retire after Phase 6 (keep tools) |
| `teaching-workflow/tools.js` | Teaching harness steps + persona tools | Keep; split into fixed steps vs agent tools |
| `teaching-session/state-machine.js` | Teaching progression gate | Keep as-is |
| `teaching-session/lifecycle.js` | Teaching domain store | Keep; link to `workflow_id` |
| `websocket.js` `start_adaptive_session` | Transport adapter → workflow service | Thin it; keep old messages for compatibility |
| `student-state.js` `decideNextAction` | Default recommendation inside Adaptive Learning Engine | Fold in; stop being a decision-maker |
| `decayEngine.js` | Retention engine (pure) + scheduler + trigger + notifications | Extract pure functions first |
| `agents/student`, `nana-esumai`, `sargeant` | Persona tools | Keep; call through tools |
| `lessonLadder.js`, `syllabus.js` | Curriculum | Keep |
| `modules/agent-context/*` | Context Manager | Keep as the platform layer |

---

## 7. Shared infrastructure

### 7.1 Workflow Engine 🆕

**Responsibility:** generic lifecycle, identity, relationships and outcomes.
Contains **no** domain logic.

```js
workflowEngine.create({ workflowType, learnerId, entryMode, parent, source, metadata, idempotencyKey })
workflowEngine.get(workflowId, learnerId)
workflowEngine.resume(workflowId, learnerId)        // never creates
workflowEngine.pause(workflowId, reason)
workflowEngine.complete(workflowId, outcome)
workflowEngine.abandon(workflowId, reason)
workflowEngine.cancel(workflowId, reason)
workflowEngine.emitOutcome(workflowId, outcome)     // delivers to parent controller
workflowEngine.listForLearner(learnerId, { active })

workflowRegistry.register("study_prep",   studyPrepController)
workflowRegistry.register("teaching",     teachingController)
workflowRegistry.register("decay_review", decayReviewController)
workflowRegistry.register("practice",     practiceController)
```

**Generic lifecycle statuses** (on `workflow_instances.status`):
`created · active · waiting_learner · waiting_child · paused · completed · abandoned · cancelled`.
The domain state (e.g. `topic_active`) lives on the domain row and in
`workflow_instances.state`. `status` is what the dashboard needs; `state` is
what the controller needs.

**Controller interface** (every workflow implements):

```js
{
  type, version,
  states, transitions,                 // definition data
  getState(instance)
  allowedOperations(state, subState)
  operationFor(observation, state)     // which operation the next step is
  contextRequest(instance, operation)  // → Context Manager input
  toolsFor(state, operation)           // permitted tools
  wakeTriggers                         // events that start an agent step
  handleObservation(instance, observation)
  validateTransition(from, to, facts)
  terminalActions
  onChildOutcome(instance, outcome)    // parent side of a handoff
  buildOutcome(instance)               // child side
}
```

**Resume semantics:** load instance → load domain state → determine current
operation → build context → continue the loop **only if a wake trigger is
pending**; otherwise render state and wait for the learner.

### 7.2 Agent Runtime (the loop) 🟡→ promote

One loop for all workflows. Workflow-specific behaviour comes from the
controller (operations, tools, terminal actions, caps).

```js
async function runAgentStep({ controller, instance, trigger, caps }) {
  for (let i = 1; i <= caps.maxIterations; i++) {
    const operation = controller.operationFor(lastObservation, state);
    const context   = await contextManager.build(controller.contextRequest(instance, operation));
    const decision  = await withTimeout(llm.decide(context, controller.toolsFor(state, operation)), caps.decisionTimeoutMs);
    // decision = { operation, tool|action, args, intent }  (one per iteration)
    emit("agent.narration", { operation, contextSet, intent, durationMs });
    const verdict   = await harness.validate(decision, instance, operation);
    if (!verdict.ok) { emit("decision.rejected", ...); observe(verdict); continue; }
    emit("tool.started", ...);
    const observation = await harness.execute(decision);
    emit("tool.completed" | "tool.failed", ...);
    await controller.handleObservation(instance, observation);   // may transition
    if (isTerminal(decision) || learnerActionRequired || childRequired) return;
  }
  // cap reached without terminal → controller-specific cap policy (pause honestly / fallback)
}
```

**Decision contract (LLM output)**

```json
{
  "operation": "strategy_selection",
  "tool": "offer_strategy",
  "args": { "strategy": "teach_back", "reason_code": "repeated_misconception" },
  "intent": "Your earlier attempts mixed up evaporation and transpiration, so a teach-back fits best.",
  "message": "Water Cycle needs a bit more work, so I'm setting up a teaching session for it."
}
```

- Exactly **one** action per iteration (`tool_choice: "required"` on OpenAI as
  today; `auto` + instruction on Claude, §7.11.4).
- `intent` ≤ 240 chars, sanitised, untrusted display text. Not a reasoning field.
- `message` (optional, ≤ 400 chars, D27): learner-facing activity text sent
  with the action. Shown as an `activity` block. A filter rejects score,
  pass/fail and coin claims in model text; those come from the narrator.
- `operation` is a **claim** — the harness checks it is allowed in the current
  state and that the tool belongs to it.
- Malformed output → recorded as a malformed iteration → observation → next
  iteration (Study Prep, Practice) or fallback (Teaching, Decay).

**Caps** (code constants per workflow — the model never sets them)

| Cap | Study Prep | Teaching | Decay | Practice |
|---|---|---|---|---|
| Iterations per step/turn | 6 ✅ | **3** | 3 | 4 |
| Tool calls per instance | 40 ✅ | 120 | 60 | 30 |
| Decision timeout | 20 s | **8 s → fallback** | 8 s → fallback | 20 s |
| Strategy changes | per topic: attempts cap | 2 per session | 2 per session | — |

Values marked ✅ exist today; others are starting values to tune (§20).

**Stop conditions:** terminal action · learner action required · child
workflow required · workflow paused/completed/abandoned/cancelled · cap ·
insufficient balance.

### 7.3 Harness 🟡→ generalise

The harness is the only writer of workflow state. Every proposed action goes
through the same pipeline; each workflow adds its own checks.

**Generic checks (all workflows)**

| # | Check | Reject code |
|---|---|---|
| 1 | Feature enabled | `workflow_disabled` |
| 2 | Instance exists, owned by learner | `workflow_not_found` |
| 3 | Instance is active (not terminal/paused) | `workflow_not_active` |
| 4 | Operation allowed in this state | `operation_not_permitted` |
| 5 | Tool belongs to operation and is permitted | `tool_not_permitted` |
| 6 | Arguments match schema | `tool_schema_invalid` |
| 7 | Transition legal | `invalid_state_transition` |
| 8 | Strategy in library | `strategy_not_permitted` |
| 9 | Balance covers the action | `insufficient_balance` |
| 10 | Iteration / tool-call cap | `agent_loop_cap` · `tool_call_cap` |
| 11 | Learner gate satisfied | `learner_gate_required` |
| 12 | Idempotency key unused (create-type actions) | `duplicate_request` |
| 13 | Unknown action | `unknown_action` |

**Study Prep–specific (new 🆕):** `syllabus_exists` (generate called while a real syllabus was found).

**Study Prep–specific (existing ✅):** `attempt_cap_exceeded`,
`prerequisite_violation`, `topic_not_in_syllabus`, `plan_too_large`,
`duplicate_topic`, `deferred_retry_used`, `teach_back_gate`,
`session_tool_call_cap`.

**New per workflow:** Teaching — `objective_not_met`, `strategy_change_cap`,
`teaching_already_active`. Decay — `review_target_invalid`. Practice —
`attempt_already_submitted` (exists in exam-prep), `question_source_invalid`.

Existing rejection codes are kept verbatim (contract tests pin them); new
generic codes are added alongside.

Rejections are returned to the agent as **observations**. The agent reads the
code and adapts; it never repeats an identical rejected call.

### 7.4 Context Manager ✅ + 🆕 wiring

`modules/agent-context/context-manager.js` with `manifest.mjs` as the only
registry (D13).

**Assembly per loop iteration:**

```
manifest set (stable, cached, boot-preflighted)
  + workflow MD (stable)
  + dynamic learner context (always rebuilt from DB/tools)
  + current observations (bounded)
  = system prompt for this iteration
```

**Operation → context set** lives in each controller as data:

| Workflow | Operation(s) | Manifest set |
|---|---|---|
| Study Prep | research, inspection | `research` ✅ |
| Study Prep | planning, replanning, draft | `planning` ✅ |
| Study Prep | verification (plan checks, safety) | `safety` ✅ |
| Study Prep | strategy_selection, teach_back_creation | `strategies` ✅ |
| Study Prep | reflection, outcome_evaluation, synthesis | `reflection` ✅ |
| Teaching (`teach_agent`) | all teaching-turn operations | `teaching_controller` 🆕 |
| Teaching (`learn_with_guide`) | all teaching-turn operations | `guide_controller` 🆕 |
| Teaching | select_teaching_strategy, adapt_strategy | `teaching_strategy` 🆕 |
| Decay | inspect_decay, inspect_history, inspect_concept, evaluate_retention | `decay_inspection` 🆕 |
| Decay | intervene, select_strategy | `decay_review` 🆕 |
| Practice | prepare, generate, evaluate | `practice` 🆕 |

**New workspace files** (under `akoro-api/akoro-agent/`, ≤ 8 192 B each):

```
workflows/STUDY_PREP.md     how the study-prep controller works, gates, handoff
workflows/TEACHING.md       controller role; protégé/NaNa are tools; turn shape
workflows/GUIDE_MODE.md     learn_with_guide: NaNa teaches directly, no protégé; check-question style
workflows/DECAY_REVIEW.md   retention review, when to hand off to teaching
workflows/PRACTICE.md       proctored assessment: question focus, probing, hint policy, what the agent may not touch
learning/RETENTION.md       decay signals, retrieval practice principles
```

**New manifest sets** (all `mode: "joined"`, each ≤ 24 576 B assembled):

```js
teaching_controller: ["AGENT.md", "workflows/TEACHING.md", "learning/LEARNING.md", "learning/TEACHING.md", "learning/MASTERY.md", "policies/EDUCATION_RULES.md"]
guide_controller:    ["AGENT.md", "workflows/TEACHING.md", "workflows/GUIDE_MODE.md", "learning/LEARNING.md", "learning/ASSESSMENT.md", "learning/MASTERY.md", "policies/EDUCATION_RULES.md"]
teaching_strategy:   ["AGENT.md", "workflows/TEACHING.md", "strategies/STRATEGIES.md", "policies/TOOL_RULES.md"]
decay_inspection:    ["AGENT.md", "workflows/DECAY_REVIEW.md", "learning/RETENTION.md", "reasoning/INSPECTION.md", "learning/MASTERY.md"]
decay_review:        ["AGENT.md", "workflows/DECAY_REVIEW.md", "learning/RETENTION.md", "learning/TEACHING.md", "strategies/STRATEGIES.md"]
practice:            ["AGENT.md", "workflows/PRACTICE.md", "learning/ASSESSMENT.md", "learning/MASTERY.md", "policies/EDUCATION_RULES.md"]
```

The existing study-prep sets gain `workflows/STUDY_PREP.md` only after the
byte-pinned study-prep tests are updated deliberately (they pin set bytes).

`AGENT.md` currently introduces "Akoro Study Agent". It must be reworded to a
workflow-neutral identity, with the workflow file supplying the role. This is
a pinned-file change — update the golden tests in the same commit.

**Adding an operation — the five-part rule (from v7, mandatory)**

An operation is live only when all five exist:

| Part | Where |
|---|---|
| Context set | `manifest.mjs` |
| Trigger (`operationFor`) | the workflow controller |
| Permitted tools | the workflow's tool registry |
| Decision nodes / event types | the workflow's narrator templates |
| UI category + pill mapping | the category table (§7.9.4) |

Adding only a set produces a dormant operation. A role needing its own state,
gates and lifecycle is a new **workflow**, not an operation.

**Context failure:** if required context can't be built, the workflow state
is left unchanged and the step ends with `context_unavailable`. Never guess
missing learner state.

### 7.5 Tool system 🟡→ generalise

**Levels** (existing): `read` (free, bounded, no state change, no cost) ·
`propose` (harness validates then executes) · `execute` (harness executes only
when a hard gate passes — cost, caps, learner gate).

**New level:** `persona` — calls a persona LLM (protégé, NaNa, Sargeant). It
costs tokens, produces learner-visible text or a judgement, and **never**
changes state. Its output is an observation.

**Harness-only operations** (never in any model catalogue):
`practice.score`, `wallet.charge`, `workflow.transition`, `evidence.append`,
`mastery.update`, `teaching.gate_progress`, `teaching.observe_evidence`,
`teaching.record_learning`, `workflow.create_child`.

Each workflow has its own catalogue (listed in §8–11). A tool row in the UI
uses the tool's **headline/description templates**, never its name (§7.9.5).

### 7.6 Education Engine ✅ + expand

Pure, deterministic, no LLM, no clock. Promoted from
`study-prep/education-engine.js`.

Existing ✅: `scoreAttempt`, `applyThreshold`, `topicOutcome`,
`masteryWriteBack`, `estimateSessionCost`, `STRATEGY_LIBRARY`,
`isPermittedStrategy`, `STUDY_PREP_COST`.

Add 🆕:
- `evaluateDiagnostic`, `evaluateRetest` (wrappers with workflow facts)
- `evaluateRetention({ evidenceHistory, now })` — from `decayEngine`'s pure
  functions (`calculateDecayedConfidence`, `getPriority`, `getNextReviewDate`)
- `normaliseTeachingEvidence(proposed)` — validates evidence the protégé
  analysis proposes, using `teaching-evidence.js`
- `teachingObjectiveMet({ allConceptsVerified, phase })`
- `updateConceptEvidence` / `updateKnowledgeState` — **transactional** with
  the attempt write (score + evidence + concept state + topic outcome commit
  together or not at all)

### 7.7 Adaptive Learning Engine and Strategy Library 🆕

Shared policy/intelligence. **Not** a workflow. Owns no lifecycle, UI,
wallet or transport.

```js
interpretEvidence({ learnerId, conceptIds, recentEvidence })
recommendStrategies({ evidence, history, conceptState, previousStrategies, workflowConstraints })
   // → ranked approved strategies with reason codes (a recommendation, the
   //   agent chooses among them, the harness validates)
defaultTeachingAction({ dialogueMove })      // ACTION_FOR_DIALOGUE_MOVE — the fallback
evaluateMastery(...)  evaluateRetention(...)  getStrategyHistory(...)
recordStrategyOutcome({ strategy, version, before, after })
```

- `student-state.js:decideNextAction` is folded in here as a **recommendation**
  input, and stops acting as an independent decision-maker.
- **Strategy Library v1** (exists): `teach_back`, `different_analogy`,
  `interleave`, `space_out`, `escalate_human`.
- **Strategy Library v2** (D25) adds `retrieval_practice`: the learner recalls
  from memory with a hint ladder (no hint → cue → partial hint), scored by the
  server, before any re-explanation. Each strategy carries the workflows it is
  permitted in:

  | Strategy | Study Prep | Teaching | Decay Review | Practice |
  |---|---|---|---|---|
  | teach_back | ✓ | ✓ | ✓ (via child Teaching) | — |
  | different_analogy | ✓ | ✓ | ✓ | — |
  | interleave | ✓ | — | — | ✓ |
  | space_out | ✓ | — | ✓ | ✓ |
  | escalate_human | ✓ | ✓ | ✓ | — |
  | **retrieval_practice** | **— (not for now)** | — | **✓** | **✓** |
  | **peer_help** (D34) | **✓** | **✓** | **✓** | — |

  The harness checks `(strategy, version, workflowType)`; `strategy_not_permitted`
  otherwise. The library is defined once — today it is duplicated in
  `education-engine.js` (`STRATEGY_LIBRARY`) and `state-machine.js`
  (`POLICY.STRATEGY_LIBRARY`); merge them, then update the `offer_strategy`
  tool description and `strategies/STRATEGIES.md` in the same change. Versioned (`strategy_version`
  persisted on every use). The agent may only choose from it. No repeating the
  same failed strategy indefinitely: `recommendStrategies` excludes a strategy
  that already failed for this concept in this workflow.

### 7.8 Learner Model 🟡

- Canonical: `learner_concept_state` + `learner_concept_evidence` (0–1),
  behind `AKORO_CONCEPT_TRACKER_ENABLED`.
- Fallback: `edu.knowledge_confidence` (0–100) read as `/100`.
- Every workflow writes evidence **only** through the Education Engine.
- Teaching evidence kinds: `concept_explained`, `concept_distinguished`,
  `example_generated`, `misconception_detected`, `misconception_corrected`,
  `prerequisite_missing`, `followup_answered`, `retrieval_success`,
  `retrieval_failure`, `confidence_signal`.
- Narration is never evidence. Evidence is stored separately.
- `student-state.js` cognitive fields and `agents/student/knowledge.js`
  remain during migration; reduce to one representation in Phase 10.

#### 7.8.1 What every workflow must record (D37)

**Today this is partial** (checked 2026-10-09): Study Prep writes only
pass/fail `assessment_result`; Teaching keeps misconceptions inside each
session's `adaptive_sessions.teaching_evidence` JSON and never reaches the
learner model; Decay only decays `knowledge_confidence`; the proctored
assessment writes no concept evidence; `misconception_detected/cleared` is
only written by the Python agent through the concept-state gateway.

**Target:** one recorder in the Education Engine,
`recordLearningEvent({ learnerId, conceptId, kind, source, workflowId, details })`,
writing to `learner_concept_evidence` (and updating `learner_concept_state`,
including `misconception_active`). Every workflow calls it:

| Workflow | Must record |
|---|---|
| Study Prep | every Agent Check result per concept (`assessment_result`, `recall_gap` for each gap Sergeant names, `recall_success`); strategy chosen and its outcome |
| Teaching | `misconception_detected` when the evidence observer finds one; `misconception_cleared` when it is repaired; `recall_gap` / `recall_success` per must-know part; strategy changes and outcome |
| Decay Review | `recall_gap` when the retention check finds decay; `recall_success` when restored; the learner's recall rounds (`source: learner_recall`) |
| Practice (proctored) | per-concept `assessment_result` for completed, unflagged sessions only |
| Agent Chat | misconceptions the agent notices in conversation, only through the same recorder (tagged `source: chat`, lower weight) |

`source` is always set (`agent_recall`, `teaching`, `learner_recall`,
`proctored`, `chat`) so the engine can weight evidence and the learner model
never mixes them silently.

**Struggle detection** (§7.15) runs on these events and on timings,
question tags, deferrals and streaks: `rule` types are computed by code;
`agent` and `learner` types go through `recordStruggle({ type, conceptId?,
observation })`, which checks the type is in the taxonomy and the observation
cites real evidence. **Breakthrough detection** (§7.13.1) runs on these events: a pure function
watches each new event against the concept's history and writes a
`learning_struggles` row (status → resolved) when a struggle resolves. It needs the strategy
outcome records (`recordStrategyOutcome`) so it knows *what worked*.

**Backfill:** existing `adaptive_sessions.teaching_evidence` misconception
data and exam-prep run history are converted into evidence events once, so
breakthroughs and the anonymous pattern (D36) start with history, not empty.

### 7.9 Event stream, narration and transport 🆕

#### 7.9.1 Event envelope

```json
{
  "id": "evt_…",
  "workflowId": "…",
  "workflowType": "study_prep",
  "parentWorkflowId": null,
  "sequence": 42,
  "timestamp": "…",
  "type": "agent.narration",
  "category": "thinking",
  "operation": "strategy_selection",
  "workflowState": "topic_active",
  "subState": "intervention",
  "contextSet": "strategies",
  "actor": "agent",
  "visibility": "learner",
  "turnId": null,
  "payload": { "narration": "…", "durationMs": 1800 }
}
```

- `sequence` is monotonic per workflow, `UNIQUE(workflow_id, sequence)`,
  allocated by the store (as `study_prep_events` does today).
- `visibility`: `learner` · `developer` · `audit`.
- `actor`: `agent` (model decided) · `system` (platform executed) · `learner`.
- Payloads are bounded. Never: answer keys, raw tool output, raw model
  reasoning, unbounded learner data, passwords.

#### 7.9.2 Event types

```
workflow.created · workflow.started · workflow.state_changed · workflow.paused
workflow.resumed · workflow.completed · workflow.abandoned · workflow.cancelled
workflow.handoff_created · workflow.handoff_completed · workflow.outcome_emitted

operation.started · operation.completed
context.loaded

agent.narration                      (thinking block)
activity                             (plain learner-facing message)
decision.proposed · decision.accepted · decision.rejected · decision.fallback

tool.started · tool.completed · tool.failed

learner.action_required · learner.action_received
   (plan.approved, teaching.started, answer.submitted (proctored / guide mode),
    workflow.resumed, topup.completed)

assessment.started · assessment.completed
strategy.selected · evidence.recorded
topic.state_changed · teaching.phase_changed
wallet.updated
```

#### 7.9.3 Narration (ActivityNarrator)

Grown from `narration.js:deliberate()` (closed decision-node enum, typed
facts, snapshot-tested ✅).

```js
narrate(event, facts) → { headline, description, result, narration }
```

- **Deterministic templates** for every system fact: scores, thresholds,
  transitions, handoffs, pauses, rejections. Example:
  `assessment.completed {3,5,0.7}` → "Scored 3 of 5 (60%). Below the 70% pass mark."
- **Agent intent** fills the "why" of a thinking block. It is sanitised,
  length-capped and never trusted as fact.
- Every template is snapshot-tested. Adding an event type without a template
  fails the narrator contract test.

#### 7.9.4 Categories and pills

Controlled categories (D14): `research · inspection · planning · draft ·
verification · assessment · strategy_selection · teaching · action ·
reflection · synthesis`. These are UI/telemetry labels, not cognition.

```js
const CATEGORY_TO_PILL = {
  research: "research", inspection: "research",
  planning: "draft", draft: "draft",
  verification: "verification",
  assessment: "reflection", reflection: "reflection",
  strategy_selection: "action", teaching: "action", action: "action",
  synthesis: "synthesis",
};
```

#### 7.9.5 Tool rows — learner language

Each tool definition carries display templates:

```js
{ name: "learner.get_history",
  display: { category: "research",
             headline: "Reviewing your learning history",
             description: "Looking for repeated mistakes",
             result: (obs) => `${obs.gaps} recurring gaps found` } }
```

Row format: `[pill] Headline / Description / ✓|✕ Result / agent|system`.
Tool names appear only in developer mode.

#### 7.9.6 Persistence, replay and transport

- Every event is written to `edu.workflow_events` **before** it is pushed.
- Replay: `GET /api/workflows/:id/events?after=N` (owner-only).
- Live push:
  - Teaching / Decay → existing Socket.IO connection, event name
    `workflow_event`, same envelope.
  - Study Prep / Practice → `GET /api/workflows/:id/stream` (SSE) with the
    `/chat/agent` heartbeat pattern.
- On reconnect the client sends its last `sequence`; the server replays the
  gap, then streams.
- Thinking blocks persist as narration events, so a reload shows the same
  blocks. Streamed reasoning summaries are live-only (D9).

#### 7.9.7 Live streaming (the coding-agent feel) — Agent Chat tab only (D28)

In the Agent Chat tab, the learner sees each element appear and fill in as it happens:

```
agent.narration.start   → ThinkingBlock opens (live shimmer), "Thinking…"
agent.narration.delta   → reasoning-summary text (D9) or intent text, token by token
agent.narration.end     → "Thought for 2s · [context]", block auto-collapses
tool.started            → ToolRow appears in the open ToolGroup with a spinner
tool.completed|failed   → ✓/✕ result + timing fill in; group collapses when the next element starts
activity.delta / activity → agent's message (D27) streams as plain text
reply.delta / reply     → protégé / NaNa / chat answer streams word by word
learner.action_required → card or gate button
```

- `*.delta` events are **live only** (not written to `workflow_events`); the
  matching closing event (`agent.narration`, `activity`, `reply`) is stored
  with the full bounded text, so replay rebuilds the same blocks.
- Thinking and tool groups are always collapsible; the block that is
  currently streaming stays open, earlier ones collapse (existing
  `ThoughtBlock` behaviour).
- The stream order is whatever happened; THINKING → TOOLS → ACTIVITY is the
  common shape, not a rule (v3 §78).
- Persona and chat replies stream through `meteredCreate` streaming
  (already metered with `include_usage`).

### 7.10 Cost, concurrency, idempotency

**Cost**
- All LLM calls meter through `lib/aiModel.js` (`chargeForAI`) ✅. Each
  workflow sets `__feature` (`study_prep`, `teaching`, `decay_review`,
  `practice`) so spend is attributable.
- Study Prep: estimate on plan card → learner confirms → ceiling
  `min(1.5 × estimate, wallet)` ✅ → harness refuses past it.
- Teaching/Decay: metered per call. Before each turn the harness checks the
  balance covers a worst-case turn (cap × decision call + persona calls).
  If not → `workflow.paused (insufficient_balance)`; progress saved.
- Practice: per-generation charge before generation (existing practice rule).
- Never rely on UI counters.

**Concurrency** — every transition is compare-and-set:

```sql
UPDATE edu.study_prep_topics SET status = 'retest_ready'
WHERE id = $1 AND status = 'awaiting_teaching';   -- 0 rows ⇒ rejected, no event
```

Race losers no-op without duplicate events. One active agent step per
workflow instance at a time (advisory lock or `locked_until` column on
`workflow_instances`).

**Idempotency**
- Child creation is keyed by `(source_workflow_id, source_topic_id, reason)`
  with a unique partial index over non-terminal children.
- Learner gate endpoints accept an idempotency key.
- Charges carry a `ref` already (`chargeForAI` ✅); practice charges reuse the
  attempt id.

### 7.11 Model switching (D23) 🆕

**What it is for:** learners can switch the LLM behind Akoro (GPT, Claude
Sonnet, Claude Opus, Grok, …) when they want stronger results, and pay that
model's price. **The default stays `gpt-4o-mini`** — nothing changes for a
learner who never touches the picker.

**Problem today:** `lib/aiModel.js` reads one `OPENAI_MODEL` (default
`gpt-4o-mini`), about 60 call sites import it, the client is OpenAI-only,
and `aiPricing.js` charges **any unknown model at gpt-4o-mini prices** — a
learner on Opus would be charged as if on gpt-4o-mini.

#### 7.11.1 Model catalogue (env-driven)

Models are declared in env (`AI_MODELS`, JSON). Adding a model or a provider
is an env change plus, for a new provider type, one adapter.

| id | Provider | API model | Learner label | $/1M in | $/1M out | Notes |
|---|---|---|---|---|---|---|
| `gpt-4o-mini` | openai | `gpt-4o-mini` | Akoro Standard | 0.15 | 0.60 | **Default** |
| `gpt-4.1` | openai | `gpt-4.1` | GPT-4.1 | 2.00 | 8.00 | from current price table |
| `claude-haiku` | anthropic | `claude-haiku-5-5` | Claude Haiku | 0.10 | 0.50 | ≤100K prompt; 0.50 / 2.50 beyond |
| `claude-sonnet` | anthropic | `claude-sonnet-5-5` | Claude Sonnet | 2.00 | 10.00 | |
| `claude-opus` | anthropic | `claude-opus-5-5` | Claude Opus | 4.00 | 20.00 | |
| `claude-fable` | anthropic | `claude-fable-5-1` | Claude Fable | 10.00 | 50.00 | most capable; slow on hard turns |
| `grok` | xai (OpenAI-compatible) | set in env | Grok | set in env | set in env | ids and prices change — verify at setup |
| `deepseek` | deepseek (OpenAI-compatible) | set in env | DeepSeek | set in env | set in env | use a model variant that supports tool calling; ids and prices change — verify at setup |

Claude prices are Anthropic first-party rates as of 2026-10-06. Every price
lives in the catalogue, not in code, and must be re-checked when a model is added.

Each entry has: `id`, `provider`, `apiModel`, `label`, `price` (in, out,
cached-in, plus long-prompt tiers where the provider has them), `caps`
(`tools`, `stream`, `json`), `selectable`, `tier` (which learner plans may
use it), `enabled`, and optional `fallbackModel`.

- **A model without a price fails boot.** The hard-coded `MODEL_PRICES`
  becomes the default catalogue, so nothing changes while `AI_MODELS` is unset.
- API keys stay in env per provider (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `XAI_API_KEY`, `DEEPSEEK_API_KEY`), never in the catalogue.
- Only models with `tools` can run workflow controllers (the agent loop needs
  tool calling). All models listed above support tool calling and streaming.

#### 7.11.2 What the learner's choice controls

The learner picks **one model for their conversation or session**. It is used
for every LLM call in that session, so the whole agent gets smarter, not just
the chat text:

| Call | Uses the learner's model? | Why |
|---|---|---|
| Chat replies | Yes | |
| Workflow controller agents (Study Prep, Teaching, Decay, Practice) | Yes | Safety lives in the harness, not the model — rules, caps, gates and scoring hold whatever model decides |
| Persona replies (protégé, NaNa) | Yes | |
| Assessment judgement (Sargeant), evidence analysis | **No — fixed by env** | Grading must be consistent across learners; a learner shouldn't change how strictly they are marked |
| Background/system jobs (decay scheduler, ladder prewarm, tasks) | No — env default | No learner chose them |

Roles stay in the code so env can still route a role
(`AI_MODEL_ROLE_ASSESSOR=gpt-4o-mini`) or lock it (`AI_MODEL_LOCKED_ROLES=assessor,evidence`).

#### 7.11.3 Resolution

```js
resolveModel({ role, learnerChoice, workflowInstance }) → { id, provider, apiModel, price, caps }
```

1. Role locked by env → env model.
2. Learner's choice, if: picker enabled · model `enabled` and `selectable` ·
   model is in the payer's tier `allowed_models[]` (§7.11.5a) · model has the
   role's required `caps`.
3. Role env default (`AI_MODEL_ROLE_*`).
4. `AI_MODEL_DEFAULT` (= `gpt-4o-mini`; legacy `OPENAI_MODEL` honoured during migration).

An invalid choice falls back to step 3/4 and the learner sees why. The
resolved model is stored on `workflow_instances.model_selection` and on
every decision event (developer mode). `recordAiCall` already logs `model`.

#### 7.11.4 Provider adapters

`meteredCreate` stays the single call path (balance check, billing, timing,
breaker, max-token guard). Behind it, one adapter per provider normalises to
the internal shape the codebase already uses (OpenAI chat-completions style:
messages, tools, tool call, streaming chunks, `usage`):

- **openai** — today's client.
- **openai_compatible** — same client with `baseURL` + key from env (Grok/xAI,
  DeepSeek, others).
- **anthropic** — the official `@anthropic-ai/sdk` Messages API (never an
  OpenAI-compatible shim). The adapter must handle:
  - **No forced tool choice.** Current Claude models reject
    `tool_choice: any/tool`. The agent loop's "required" becomes `auto` + a
    prompt instruction to call exactly one tool + `strict: true` tool schemas.
    A text-only answer is treated as a malformed iteration (the loop already
    handles this; Teaching falls back per D8).
  - **Thinking.** Claude thinks by default and Opus 5.5 can't turn it off;
    depth is set with `effort` (`low` for chat and controller steps by default,
    tunable per role). Thinking content is never shown to learners (D9) and
    never stored.
  - **Refusals.** Check `stop_reason === "refusal"` before reading content;
    turn it into a normal `model_refusal` observation, and use the server-side
    fallback option where available.
  - **Usage mapping** (`input_tokens`, `output_tokens`, cache reads) → the
    billing fields.
  - One circuit breaker per provider; `fallbackModel` used when it is open.

#### 7.11.5 Learner model picker (chat box)

- `GET /api/ai/models` → models the learner may pick: label, short
  description ("Best for hard topics"), tier lock, and a cost hint relative
  to the default ("≈ 30× coins per message" for Opus vs the default).
- The picker sits in the chat box (and the Teaching/Study Prep composer).
  The choice is saved on the chat thread / workflow instance and applies from
  the next message; it emits a `model.changed` learner event.
- The learner sees the cost before switching. Study Prep plan cards, the
  ceiling, and Teaching's per-turn balance check all use the **chosen**
  model's price. Switching mid-session re-checks the remaining budget.
- Admins can disable any model instantly with `enabled: false`.

#### 7.11.5a Models per plan tier (D26)

**Every tier defaults to `gpt-4o-mini`.** What a learner may switch *to* is
set per tier by admins, as an `allowed_models[]` list on the `tiers` table
(same pattern as `gated_features[]` in the Tiers & Credits admin plan) — no
deploy needed to change it. A model must be both `enabled` in the catalogue
and in the learner's tier list to appear in their picker.

Starting lists (confirmed 2026-10-09; admins can edit them later):

| Tier | Default | May switch to |
|---|---|---|
| Pilot (school-funded) | `gpt-4o-mini` | DeepSeek |
| Trial | `gpt-4o-mini` | Claude Haiku, DeepSeek |
| Freemium | `gpt-4o-mini` | Claude Haiku, Claude Sonnet, GPT-4.1, DeepSeek |
| Premium | `gpt-4o-mini` | Claude Haiku, Claude Sonnet, GPT-4.1, Claude Opus, Grok, DeepSeek |
| (any) | — | Claude Fable: off for everyone (can be added to a tier list later) |

- DeepSeek is available on **every** tier (user decision, 2026-10-09).
- Coins are still charged at the chosen model's price on every tier; the tier
  list controls access, not price.
- When a session is funded by a school (`billTo`), the school's tier list
  applies, not the learner's.
- If a learner's tier changes (downgrade, trial ends) and their saved choice
  is no longer allowed, the next message falls back to `gpt-4o-mini` with a notice.

#### 7.11.6 Migration

1. `lib/modelRegistry.js` (catalogue, roles, `resolveModel`) defaulting to
   today's behaviour; prices required.
2. `meteredCreate` accepts `__role` and `__learnerChoice`; resolves when
   `model` is absent.
3. Move call sites from `OPENAI_MODEL` to roles (contract test: no new
   `OPENAI_MODEL` imports outside the registry).
4. `openai_compatible` and `anthropic` adapters with contract tests: tool-call
   round trip, no-forced-tool-choice path, streaming usage, refusal mapping,
   error mapping, billing at the right price.
5. Picker API + UI behind `AI_MODEL_PICKER_ENABLED`.

### 7.12 Agent Check — practice that tests the learner's agent (D31) 🆕

`practice.generate` / `practice.submit` (a human answers generated questions)
is replaced by an **Agent Check**, built the way Battles already work:

```
NaNa (teaching guide) asks  →  the learner's agent answers  →  Sergeant judges
```

**No human answers.** The check measures what the learner has taught their
agent. In Akoro the agent only knows what its owner taught it, so the result
is a direct measure of the learner's teaching — and every gap it finds is
something for the learner to teach next. This is the same loop as Battles
("teach the agent, the agent does better").

#### 7.12.1 One check, step by step

| Step | Who | What | Reuses |
|---|---|---|---|
| 1. Questions | **NaNa** (question source) | Picks questions on the topic: verified past questions / question bank first, generated questions otherwise (labelled, never shown as official past questions). Answer key stays server-side. | `battle/questionSource.js`, exam-prep question generation |
| 2. Answer | **The learner's agent** | Answers each question **only from the learner's own notes** (`edu.student_knowledge`): the question is embedded, the notes are searched (similarity floor 0.30, rerank to 4 notes), and the model sees nothing else — no syllabus, no general knowledge, no answer key. If the notes don't cover it, the agent says UNKNOWN and guesses, and the log says so. | `battle/agentRecall.js` (`recall`, `answerFromRecall`, `recallStrength`) |
| 3. Judge | **Sergeant** | Multiple choice: the Education Engine compares to the key (deterministic); Sergeant writes the one-line explanation. Short answer: Sergeant judges against the rubric — a proposal the Education Engine normalises. Sergeant also names each gap ("your notes don't say where transpiration happens"). | `agents/sargeant/assessment.js` |
| 4. Score | **Education Engine** | Score, threshold, attempt count, outcome, evidence. **A correct guess (UNKNOWN) counts as not demonstrated** — it shows in the log but never as evidence. | `education-engine.js` |

The agent check is one harness `execute` tool:

```
practice.run_agent_check({ topicId, mode: "diagnostic" | "retest" | "retention_check", size })
  → { score, total, passed, perQuestion: [{ outcome: correct|wrong|guessed, gap? }], gaps: [...] }
```

plus a free read tool the controller uses first:

```
agent.get_knowledge_coverage({ topicId }) → { notes: n, strength: "none"|"thin"|"good" }   // recallStrength, no model call
```

If the agent has **no notes** on a topic, the controller skips the check
(saves coins) and goes straight to teaching, narrating why ("Your agent
doesn't have any notes on Water Cycle yet — let's teach it first").

#### 7.12.2 Fixed in code

- The recall prompt contains only the learner's notes; nothing else may be
  added (contract test pins the prompt inputs).
- **The three roles are model-locked by env**, not affected by the learner's
  model choice (D23): `agent_recall` (today `BATTLE_ANSWER_MODEL`, default
  `gpt-4o-mini`), `question_generator`, and `assessor`. A stronger model could
  answer from general knowledge despite instructions, and question difficulty
  must not change with the learner's plan, so scores stay comparable.
- Scoring, thresholds, attempt caps and evidence writes are the Education
  Engine's. Charging happens before the check, per check, by the harness.
- Evidence is tagged `source: "agent_recall"`. Closing claims say what was
  measured: "your agent answered 4 of 5 from your notes", never "you mastered".

#### 7.12.3 Where it is used

| Workflow | Use |
|---|---|
| Study Prep | Diagnostic and retest for every topic (§8.3–8.4) |
| Teaching (`teach_agent` mode) | `teaching.request_assessment` runs an agent check on the concepts just taught |
| Decay Review | The retention check and retest (has the agent's knowledge faded?) |
| Practice (proctored) | **Not used** — the proctored assessment stays human (D29) |
| Teaching (`learn_with_guide` mode) | Not used — the human answers NaNa's check questions in that mode (§9.3) |
| Decay `retrieval_practice` | Not used — the human recalls from memory (D32) |

#### 7.12.4 What the learner sees

- **Agent Chat tab** (Study Prep): a battle-style log streams in as tool rows —
  "NaNa asked: What drives evaporation?" · "Your agent answered B, from your
  note *Evaporation is…*" · "Sergeant: correct" — then a score card and the
  list of gaps.
- **Teach Agent modal:** the existing UI shows the result card; no trace UI (D28).

### 7.13 Peer agent help — learning from how others got unstuck (D34) 🟡→ rebuild `peerConsult.js`

**Today:** `consult_peer_agents` asks two random agents for general study
advice in their persona. **Rejected alternative:** having peers answer from
their notes (content) — the learner already has NaNa and the syllabus for
content; another learner's notes add nothing.

**What helps instead:** another learner who **had the same struggle and got
past it**, and **what worked for them**. So peers share *breakthroughs*, not
knowledge:

> "My learner also kept mixing up evaporation and transpiration — it took 3
> tries. What finally worked was drawing a leaf with its stomata and teaching
> me that transpiration is the plant 'sweating' through them. After that they
> scored 5/5."

#### 7.13.1 Struggles and breakthroughs — captured automatically

Akoro records each **struggle** when it is detected (any type from the
taxonomy in §7.15) and turns it into a **breakthrough** when it resolves. One
table holds both — a breakthrough is a resolved struggle:

`edu.learning_struggles`:

```
id, learner_id (never exposed), agent_id,
category, struggle_type        from STRUGGLE_TYPES (§7.15), versioned
subject, class_level, concept_id (null for general types), topic_label,
detected_by                    rule | agent | learner
detected_at, evidence_refs[]   the evidence/events it was detected from
status                         open | resolved | abandoned | expired
struggle_summary               ≤ 200 chars (null for sensitive types)
misconception_key              normalised label for matching (concept types)
attempts_before, strategies_tried[]
what_worked_strategy, what_worked   ≤ 300 chars (null for sensitive types)
score_before, score_after, days_to_overcome, resolved_at
source_workflow, sensitive boolean, shareable boolean, hidden boolean,
expires_at (health_energy: +30 days), embedding vector
```

- `struggle_summary` and `what_worked` are **written by a locked summariser
  model from the evidence summaries and the strategy record**, not copied from
  the learner's messages or notes. A filter removes names, schools, contact
  details and anything quoted from the learner.
- Struggles are recorded for **every** learner (open and resolved). `shareable` only controls whether
  a record can be shown **as a story**; it follows the learner's opt-in
  (Settings → Agent), and turning the setting off makes all their records
  unshareable as stories.
- **Every** record — shareable or not, hidden or not — counts toward the
  anonymous **pattern** totals (D36). Only totals are ever shown, and only when
  at least 5 learners match.
- Learners can see their own breakthroughs ("Your agent's stories") under
  Settings → Agent and hide any one of them.

#### 7.13.1a Consent

**The setting (Settings → Agent tab, `pages/settings/agentTab.jsx`):** a new
section "Helping other learners" with one `Toggle`:

> **Let my agent help other learners** — Off
> When this is on, other learners' agents can learn from how you got
> past tricky topics — what you struggled with and what finally worked. Your
> notes, messages, name and school are never shared — only a short summary
> and your agent's name and emoji.
> You can turn this off at any time.

- Stored as `user_agents.help_others_opt_in boolean default false`, saved with
  the existing agent `PATCH`. Turning it off takes effect for the next consult.
- Below the toggle, a small count when on: "Your agent has helped N learners".
- No learner is ever asked to turn it on during a study session; the setting is
  only in Settings.

#### 7.13.2 Consulting

The asking agent never sends knowledge or the learner's data — only **the
struggle**:

```
peers.consult({ struggleType, conceptId?, misconception?, classLevel? })   // struggleType from §7.15
  → {
      stories: [ { agent: "Kofi's Agent 🦉", struggle, attemptsBefore,
                   whatWorked, strategy, scoreBefore, scoreAfter } ],   // up to 3
      pattern: { learners: 12, mostEffective: "teach_back", share: 0.67 }  // only if ≥ 5 learners
    }
```

- **Matching:** same struggle type; for concept types the same concept, then
  misconception similarity (embedding on `struggle_summary` +
  `misconception_key`); for general types (procrastination, overload,
  streak break…) similar class level and context; then prefer
  breakthroughs with a big score jump and recent dates. Only resolved, `shareable`, non-sensitive, non-hidden records become stories.
- **Pattern:** across **all learners' matching records, anonymously** (D36),
  which strategy most often worked and for what share of learners — returned
  only when at least 5 learners match, as totals only (no stories, names,
  schools or dates), so no single learner can be identified.
- Stories are shown with the agent's name and emoji only.

#### 7.13.3 How the stories are used

- **Strategy choice:** the pattern feeds `recommendStrategies` in the Adaptive
  Learning Engine as one input ("for this misconception, `teach_back` worked
  for 8 of 12 learners"). The controller still chooses; the harness still checks
  the library.
- **Teaching:** with the `peer_help` strategy (Strategy Library v2), the
  stories go into the learner's Teaching session. NaNa uses the *what worked*
  move with this learner ("Another learner fixed this by drawing the leaf's
  stomata — want to try that?"). The learner still teaches their own agent.
- **Agent Chat:** when a learner says they're stuck, the agent can share a
  matching story directly.
- Stories are **never evidence** and never written to the learner's notes.

#### 7.13.4 All struggle types, not only concepts

Consulting covers every type in §7.15 — a learner who keeps procrastinating
on a hard topic gets stories from learners who beat procrastination, not just
concept explanations. Sensitive types never produce stories, only anonymous
totals.

#### 7.13.5 Limits

One consult per topic per session; up to 3 stories; the consult itself is a
database search (cheap), plus one locked-model call to phrase the stories for
this learner, metered to the asker (feature `agent_peer_consult`). Helpers may
get a "your agent's story helped someone" notification (no details of who).

### 7.14 Blog research (D35) 🟡→ upgrade `blogResearch.js`

**Today:** `search_blog_posts` matches the query against title, excerpt and
category only (`ilike`), then `read_blog_post` returns a whole post.

**Upgrade:**
- **Search the article body**, not just titles: blog posts are split into
  passages with embeddings (`content.blog_chunks`), indexed on publish/update
  by the existing embedding sweeper, using the same hybrid (semantic +
  keyword) search pattern as the Records library. Published posts only.
- `blog.search({ query, category?, limit })` returns the best **passages** with
  slug, title and heading, so the agent can quote and cite precisely;
  `blog.read({ slug })` stays for the full post.
- Available to the Study Prep research operation, Teaching (NaNa can cite an
  article), and the Agent Chat.
- **Citations:** when the agent uses a blog passage, the chat shows a source
  chip linking to the post.
- **Use:** study methods, exam strategy, motivation, platform guidance. The
  blog is **never** a syllabus source and never evidence.

### 7.15 Learning struggle taxonomy (D38) 🆕

Every struggle Akoro records uses one **closed list** of types, grouped into
eight categories. The list is data (`STRUGGLE_TYPES`, versioned like the
Strategy Library); the agent can only record a type from it, and adding a type
is a deliberate change with a contract test.

**Columns:**
- **Detected by** — `rule`: computed by code from evidence, scores, timings or
  history (preferred) · `agent`: the controller or Sergeant observes it and
  records it through the recorder (needs a cited observation) · `learner`: the
  learner says it ("I always freeze in tests").
- **Concept?** — tied to a concept (matched by concept in consulting) or
  general (matched by type and context).
- **Story?** — may be shared as an individual peer story (with opt-in). `—` =
  sensitive: never an individual story, only anonymous totals (§7.15.2).

#### Concept & understanding

| Type | Meaning | Detected by | Signal | Resolved when | Concept? | Story? |
|---|---|---|---|---|---|---|
| `misconception` | Wrong mental model | rule | `misconception_detected` evidence | `misconception_cleared` | ✓ | ✓ |
| `partial_understanding` | Right idea, incomplete ("knows stomata exist, not what they do") | rule + agent | Sergeant/teaching evidence: claim supported but key parts missing (quality 0.4–0.7) | full explanation / check passes | ✓ | ✓ |
| `fragile_knowledge` | Recalls but can't apply; passes recognition, fails transfer | rule | passes `recall`-tagged questions, fails `apply`/`transfer`-tagged ones | passes apply/transfer questions | ✓ | ✓ |
| `vocabulary_language` | Knows the idea, trips on the term or the language of instruction | agent | correct in own words / another language, wrong or missing key term | uses the term correctly | ✓ | ✓ |
| `prior_knowledge_conflict` | New correct model fights an older learned one | agent | misconception that matches an earlier-taught model, or the learner says "but we were taught…" | new model used consistently | ✓ | ✓ |
| `overgeneralization` | Applies a rule too broadly ("all plants sweat") | agent (Sergeant tag) | judge tags the error as over-applied rule | boundary cases answered correctly | ✓ | ✓ |
| `prerequisite_gap` | Can't get it because an earlier concept is missing | rule | fails the topic **and** fails a prerequisite from `concept_edges` | prerequisite then topic pass | ✓ | ✓ |

#### Recall & memory

| Type | Meaning | Detected by | Signal | Resolved when | Concept? | Story? |
|---|---|---|---|---|---|---|
| `decay` | Forgot over time | rule | retention check fails after an earlier pass | retention restored | ✓ | ✓ |
| `encoding_failure` | Never stored it, only recognised it | rule | taught, but the agent's notes on it are thin/none (`recallStrength`) or free recall never succeeded | free recall succeeds | ✓ | ✓ |
| `retrieval_failure` | Stored but can't access under pressure | rule | notes/earlier recall good, fails timed or proctored | passes under the same conditions | ✓ | ✓ |
| `interference` | Two similar concepts block each other | rule | errors swap a known confusion pair (evaporation ↔ transpiration) | both distinguished on a mixed check | ✓ | ✓ |
| `context_dependence` | Knows it in one format, not another | rule | passes one representation (text), fails another (diagram, word problem) | passes both | ✓ | ✓ |

#### Strategy & approach

| Type | Meaning | Detected by | Signal | Resolved when | Concept? | Story? |
|---|---|---|---|---|---|---|
| `wrong_strategy` | Studying the right thing the wrong way | rule | strategy fails here while another works for similar learners on the same struggle | a different strategy works | ✓ | ✓ |
| `strategy_plateau` | A strategy that used to work stopped working | rule | a strategy with past success for this learner fails twice running | a new strategy works | ✓ | ✓ |
| `no_strategy` | Doesn't know how to attack the topic | learner + agent | "I don't know where to start", long idle on a topic | progress after a suggested approach | ✓ | ✓ |
| `inefficient_strategy` | Works but too slow / effortful | rule | passes, but attempts or time far above the median for that topic | similar result in less time | ✓ | ✓ |

#### Motivation & affect

| Type | Meaning | Detected by | Signal | Resolved when | Concept? | Story? |
|---|---|---|---|---|---|---|
| `streak_break` | Momentum loss | rule | streak broken (existing streak data) | streak rebuilt (e.g. 5 days) | — | ✓ |
| `confidence_collapse` | One failure spirals into avoidance | rule + agent | failure followed by deferring/avoiding the topic, negative self-talk | returns to the topic and passes | ✓ | — sensitive |
| `frustration_giving_up` | Repeated failure, no path forward | rule + agent | repeated fails then abandon/quit | completes after a change | ✓ | — sensitive |
| `anxiety` | Knows it, freezes in assessment | learner + rule | learner says so, or untimed ≫ timed/proctored performance | performs under assessment | — | — sensitive |
| `boredom_disengagement` | Too easy or too abstract | agent | very short answers, skipping, fast passes with low engagement | engagement returns (harder/concrete material) | ✓ | ✓ |
| `overload` | Too much at once, can't prioritise | learner + rule | plan size vs available time, "I'm overwhelmed" | plan narrowed and followed | — | ✓ |

#### Process & habit

| Type | Meaning | Detected by | Signal | Resolved when | Concept? | Story? |
|---|---|---|---|---|---|---|
| `procrastination` | Keeps deferring the hard topic | rule | same topic deferred repeatedly; a workflow left in `ready` for days | topic attempted | ✓ | ✓ |
| `poor_planning` | Exam week, no schedule | rule | exam date near, no plan or plan created very late | plan followed to the exam | — | ✓ |
| `time_management` | Runs out mid-topic | rule | sessions repeatedly end mid-topic | topics finished within sessions | — | ✓ |
| `inconsistent_practice` | Sporadic, no spacing | rule | irregular gaps between sessions | steady spacing for 2+ weeks | — | ✓ |
| `no_self_monitoring` | Doesn't realise they're stuck | rule | self-rated confident, then fails (calibration gap) | ratings match results | ✓ | ✓ |

#### Environment & circumstance

| Type | Meaning | Detected by | Signal | Resolved when | Concept? | Story? |
|---|---|---|---|---|---|---|
| `time_pressure` | Real deadline vs time available | rule | deadline vs plan estimate | plan fits / deadline met | — | ✓ |
| `distraction_context` | Device, noise, interruptions | learner + rule | learner says so; frequent pauses/backgrounding | uninterrupted sessions | — | ✓ |
| `resource_gap` | No access to material or help | rule | no syllabus/materials found (§8.7–8.8), learner asks for material | materials obtained / outline used | — | ✓ |
| `device_access` | Offline, low bandwidth | rule | repeated disconnects, low-bandwidth flags | stable sessions (or offline mode used) | — | ✓ |
| `health_energy` | Tired, unwell, low capacity | **learner only** | the learner says so; never inferred | — (expires) | — | — sensitive |

#### Assessment & performance

| Type | Meaning | Detected by | Signal | Resolved when | Concept? | Story? |
|---|---|---|---|---|---|---|
| `test_anxiety` | Understood, performed poorly | rule + learner | strong teaching/recall evidence, poor proctored or timed result | performs in the proctored assessment | ✓ | — sensitive |
| `format_mismatch` | Knows it, fails the question type | rule | passes the concept in one question type, fails another type | passes that type | ✓ | ✓ |
| `careless_error` | Knew it, misread | agent (Sergeant tag) | wrong answer with correct reasoning shown, or instant self-correction | error rate falls | ✓ | ✓ |
| `speed` | Correct but too slow | rule | correct answers over the time budget | within time | ✓ | ✓ |
| `retest_failure` | Passed once, failed the check | rule | a pass followed by a failed check/retest | passes again | ✓ | ✓ |

#### Meta / learning-to-learn

| Type | Meaning | Detected by | Signal | Resolved when | Concept? | Story? |
|---|---|---|---|---|---|---|
| `help_seeking_failure` | Didn't ask, or asked wrong | rule + agent | stuck long without hints/questions, or vague asks | asks a specific question that unblocks | ✓ | ✓ |
| `feedback_misuse` | Got feedback, didn't act on it | rule | the same gap Sergeant named reappears after feedback | gap closed | ✓ | ✓ |
| `fixed_mindset` | "I'm just bad at this" | agent (from the learner's words) | repeated fixed-ability statements | — (tracked, not "resolved") | — | — sensitive |
| `goal_confusion` | Doesn't know what "understood" means | agent + learner | asks what counts as done; sets vague goals | goal restated and met | — | ✓ |

#### 7.15.1 Detection needs these signals

Several rule-based types need data the plan must capture:
- **Question tags** on every Agent Check / proctored question: `skill`
  (`recall | apply | transfer`), `format` (`mcq | short | diagram | word_problem
  | calculation`), `time_budget_s`. NaNa/question source sets them.
- **Confusion pairs** per subject (e.g. evaporation ↔ transpiration) — learned
  from judged errors, admin-reviewable.
- **Timings:** time per question and per session; session end reason.
- **Self-rating** (optional one-tap "How sure are you?") before some checks,
  for `no_self_monitoring`.
- Existing: streaks, `concept_edges`, deferrals, workflow states, socket
  disconnects, wallet pauses.

Note on source: Agent Checks test the **agent's** notes, so types detected from
them describe the learner's *teaching* (e.g. `encoding_failure` = they never
taught it properly). Types about performing under pressure (`anxiety`,
`test_anxiety`, `retrieval_failure` under timing) come from the human-answered
paths: the proctored assessment and Decay's recall rounds.

#### 7.15.2 Sensitive types

`confidence_collapse`, `frustration_giving_up`, `anxiety`, `health_energy`,
`test_anxiety`, `fixed_mindset`:
- Stored as **type + date (+ concept if any) only** — no free-text summary.
- Never inferred from a single message; `health_energy` only from the learner's
  own words and **expires after 30 days**.
- **Never an individual peer story.** They may count in anonymous totals
  (≥ 5 learners, D36).
- Used only to adapt pacing and tone (shorter sessions, easier wins first,
  NaNa's wording). Not shown to schools or instructors (see Q19).
- The learner can see and delete them in Settings → Agent ("What your agent
  has noticed").

#### 7.15.3 Struggle → strategy

The Adaptive Learning Engine maps each struggle type to candidate strategies,
then ranks them with the anonymous pattern (what worked for others with the
same struggle) and this learner's history:

| Struggle category | Uses existing strategies | Needs new strategies (Strategy Library v3, Q20) |
|---|---|---|
| Concept & understanding | `teach_back`, `different_analogy`, `peer_help` | `contrast_pairs` (overgeneralization, interference), `prerequisite_review` (prerequisite gap), `vocabulary_focus` (vocabulary/language), `worked_examples` (fragile knowledge) |
| Recall & memory | `space_out`, `retrieval_practice`, `interleave` | `varied_formats` (context dependence) |
| Strategy & approach | any other approved strategy, `peer_help` | — |
| Motivation & affect | `space_out`, `escalate_human` | `easy_wins_first` (confidence collapse), `chunk_plan` (overload), `make_concrete` (boredom) |
| Process & habit | `space_out` | `schedule_plan` (poor planning, inconsistent practice), `chunk_plan` (time management) |
| Environment | — | `offline_pack` (device/access), `chunk_plan` (time pressure) |
| Assessment & performance | `retrieval_practice` | `timed_practice` (speed, anxiety), `format_practice` (format mismatch), `check_your_work` (careless error) |
| Meta | `escalate_human` | `self_check` (no self-monitoring, feedback misuse), `goal_clarify` (goal confusion) |

Until v3 is approved, unmapped struggles fall back to the closest existing
strategy plus a NaNa coaching note.

---

## 8. Workflow 1 — Study Prep

**Purpose:** prepare a learner for an exam across a planned set of syllabus topics.
**Entry:** Study Prep chat, Study Prep dashboard card, chat tool
`start_study_prep_session` ✅.
**Owns:** session state, plan, topics, progression.

### 8.1 Session states (persisted) ✅

```
planning → awaiting_confirmation → topic_active ⇄ replanning → completed
                                        ⇅
                                      paused
any non-terminal → abandoned | cancelled
```

Transitions are the existing `SESSION_TRANSITIONS` ✅.
`workflow_instances.status` mapping: `planning`/`replanning` → active;
`awaiting_confirmation` → waiting_learner; `topic_active` → active or
waiting_learner or waiting_child (derived from the active topic).

### 8.2 Learner gates

1. Approve plan (`awaiting_confirmation → topic_active`). Only the learner's
   explicit confirmation does this.
2. Start/continue the Teaching Workflow when a gap is found (happens in Teaching).
3. Top-up / resume after a budget pause.

There is no "submit answers" gate: diagnostics and retests are Agent Checks
(§7.12) and run without the learner answering. The learner watches them in the
chat.

### 8.3 Topic states 🟡 (D16)

```
queued → active ── no notes on this topic ──────────────────────┐
           │                                                    │
           ▼                                                    │
     diagnostic_ready → diagnostic (Agent Check)                │
                             │                                  │
               ┌─────────────┴─────────────┐                    │
             passed                   below threshold           │
               │                           │                    │
           understood             intervention_required ◄───────┘
                                           │ (agent chooses strategy)
                                           ▼
                                   awaiting_teaching   (Teaching Workflow, teach_agent mode)
                                           │ TEACHING_COMPLETED
                                           ▼
                                      retest_ready
                                           │
                                     retest (Agent Check)
                             ┌─────────────┴─────────────┐
                          passed                   below threshold
                             │                ┌──────────┴──────────┐
                        understood       attempts left        attempts exhausted
                                         intervention_           capped_out
                                         required (new               │
                                         strategy)            deferred | flagged_gap
deferred → queued (one deferred retry per session)   flagged_gap → queued (replan)
```

States: `queued, active, diagnostic_ready, diagnostic,
intervention_required, awaiting_teaching, retest_ready, retest, understood,
flagged_gap, capped_out, deferred`.

`intervention_required` generalises v3's `teach_back_required` because the
chosen strategy may not be teach-back. `teaching_workflow_id` is set on the
topic while `awaiting_teaching`.

The exam-prep run (`learner_exam_prep_runs` / `adaptive_workflow_runs`)
remains the **attempt record** (questions, the agent's answers and the notes
it used, per-question judgement, score, attempt number).
Its status routing (`nextRunStatus`) stops being authoritative; the topic
state machine is.

### 8.4 Operations → tools → context set

| Operation | When | Agent tools | Set |
|---|---|---|---|
| research / inspection | planning start, after a gap | `syllabus.resolve_class`, `syllabus.resolve_school`, `syllabus.resolve_platform`, `syllabus.generate` (only if all three found nothing, §8.7), `materials.list`, `materials.search`, `syllabus.from_documents`, `learner.request_materials` ⟂ (§8.8), `blog.search`, `blog.read` (§7.14), `peers.consult` (§7.13), `learner.get_state`, `learner.get_history`, `learner.get_relevant_memory`, `concept.get_prerequisites`, `session.get_state`, `content.search` (flagged) | `research` |
| planning / replanning | `planning`, `replanning` | `plan.validate`, `propose_plan` ⟂, `session.replan` | `planning` |
| verification | plan checks | `plan.validate` | `safety` |
| diagnostic / retest | topic `active` / `diagnostic_ready` / `retest_ready` | `agent.get_knowledge_coverage` (read), `practice.run_agent_check` (execute, §7.12) | `reflection` |
| reflection / outcome_evaluation | after a score | read tools | `reflection` |
| strategy_selection | `intervention_required` | `peers.consult({ conceptId, struggleType, misconception })` — stories + pattern from learners who overcame the same struggle (§7.13), then `request_teaching({ strategy, focusGaps, peerExplanations? })` 🆕 ⟂ — always a Teaching Workflow (D15) | `strategies` |
| topic_advance | topic settled | `advance_topic` ⟂, `defer_topic` ⟂, `topic.flag` | `reflection` |
| session_completion | all topics settled | `conclude_session` ⟂ | `reflection` |

⟂ = terminal action (ends the step). `request_teaching` asks the harness to
create a Teaching Workflow (with the strategy and the gaps the check found); the harness checks state, strategy, idempotency
and creates it (`workflow.create_child` is harness-only).

### 8.5 Agent loop

**Wake triggers:** `session_started` · `plan_confirmed` · `attempt_scored`
(below threshold only) · `teaching_completed` · `teaching_abandoned` ·
`attempts_exhausted` · `all_topics_settled` ·
`replan_requested` · `resumed`.

**Fast path (no model wake, harness only, still narrated):**
score ≥ threshold → `understood` → next topic `active`;
`TEACHING_COMPLETED` validated → `retest_ready`.

**Agent decides:** research depth and order, plan order (within prerequisite
constraints), whether a diagnostic is worth running (skip it when the agent
has no notes), which strategy to hand to Teaching after a gap, defer vs flag vs replan at cap,
the closing summary.

**Fixed in code:** plan validation, confirmation, charging, scoring,
threshold, attempt caps, deferred-retry rule, topic cap (12), loop caps (6/40).

### 8.6 Outcome

```json
{ "workflowId": "…", "status": "completed",
  "outcome": { "topics": [{ "topicId": "…", "state": "understood", "attempts": 2, "strategiesUsed": ["teach_back"] }],
               "summaryEvidenceScope": "generated_practice" } }
```

### 8.7 Syllabus resolution — never fail for lack of a syllabus (D30)

Today `syllabus.resolve` reads only the platform tables (`edu.syllabus_*`)
with a loose class-name match, and an empty result makes every plan fail with
`topic_not_in_syllabus`. The learner's real school/class syllabus
(`mgmt.syllabus_items`, `mgmt.subject_syllabus`) is never read. Replace it
with four tools, tried from most specific to least:

| # | Tool | Level | Reads | Returns |
|---|---|---|---|---|
| 1 | `syllabus.resolve_class` | read | `mgmt.syllabus_items` + `mgmt.subject_syllabus` for the learner's school **and class** (and term when known) | topics with term and `covered`/`pending` status — tells the agent what was taught this term |
| 2 | `syllabus.resolve_school` | read | the same tables for the learner's school, any class, when the class has none for this subject | topics, marked as school-wide |
| 3 | `syllabus.resolve_platform` | read | `edu.syllabus_subjects/topics/subtopics` by subject, class level and exam board, plus semantic `searchSyllabus` for near matches | topics with subtopics and objectives |
| 4 | `syllabus.generate` | execute | — | an **AI-drafted outline** saved as a provisional syllabus |

**Finding the learner's school, class and term** (server-side; never from the
client, never from names):

| Order | Source | Gives | Used by |
|---|---|---|---|
| 1 | **Linked enrollment:** `mgmt.students` where `user_id` = the authenticated learner and `status = 'active'` → `school_id`, `class_id` → `mgmt.classes.name` (e.g. `JSS1`) | school, class | `resolve_class`, `resolve_school` |
| 2 | **Current term:** `mgmt.academic_calendar` for that school — the term whose `resumption` … `vacation` dates contain today | term | `resolve_class` (filters `syllabus_items.term`) |
| 3 | **Learner profile** (self-reported): `users.year_group` / `study_level`, `subjects` | class level | `resolve_platform`, `generate` |
| 4 | **What the learner says** in the conversation ("I'm in JSS1", "my WAEC exam") | class level, exam board | `resolve_platform`, `generate` |

- The school and class tools (`resolve_class`, `resolve_school`) run **only**
  with a linked enrollment (row 1). The self-reported `school_name` is not
  used to open a school's syllabus.
- **Names are never used to identify a learner.** Student names repeat
  (two "Ada Okafor"s, across schools) and a protégé name is chosen by the
  learner, so matching on either could load another child's class. When an
  account has no linked enrollment, a name match (+ date of birth / admission
  number) may only produce a **link suggestion** that the school confirms in
  the school portal; the agent never acts on an unconfirmed match.
- No enrollment and no class level known → the agent asks the learner one
  question ("Which class are you in?") before falling back to `generate`.

**How the agent uses them.** The agent decides which to call (e.g. go
straight to `resolve_platform` when the learner says "prepare me for JAMB
Physics"). The harness enforces two rules:

- `syllabus.generate` is permitted **only after** `resolve_class`,
  `resolve_school` (when the learner has a school) and `resolve_platform` have
  all returned nothing **in this session**. Otherwise `syllabus_exists`
  rejection — a real syllabus always wins over a generated one.
- The session records the source it planned against:
  `study_prep_sessions.syllabus_source ∈ {class, school, platform, generated}`
  + `syllabus_ref`. The plan's `topic_not_in_syllabus` check validates against
  that source.

The agent may enrich a class/school syllabus (which has topic names only) with
subtopics and objectives from the platform syllabus for the same topic. The
topic list itself stays the school's.

**`syllabus.generate` — the fallback, with guardrails**

- Input: subject, class level, exam board/term if known, the learner's goal.
- Grounding: nearest platform syllabus chunks (`searchSyllabus`) and any
  partial matches from steps 1–3 are passed in, so the draft follows the
  national curriculum where possible.
- Output is checked by code before it is saved: 3–15 topics, no duplicates,
  each with a short label and 2–5 objectives, subject and level match the
  request, plain learner-safe text.
- Saved to `edu.generated_syllabi` with `status = provisional`, the model,
  prompt version and grounding references. Reused for the same
  (subject, class level, exam board, term) instead of generating again.
- **Always labelled**: the plan card says "AI-drafted outline — not your
  school's official syllabus", and the narration says why ("I couldn't find a
  syllabus for JSS1 Basic Science for your class, school or on Akoro, so I
  drafted an outline from the national curriculum."). The learner confirms the
  plan as usual (the existing gate).
- Prerequisite order inside a generated outline is a **suggestion**, not a hard
  constraint (only approved `concept_edges` are hard constraints).
- Closing claims stay inside the evidence and name the source ("practised
  against an AI-drafted outline").
- Cost: one generation call, metered like any planning step and shown in the
  plan estimate. No charge if a cached outline is reused.
- Admins can review provisional outlines and **promote** one into the platform
  syllabus (`edu.syllabus_*`, `source = 'promoted_from_generated'`) or reject
  it. Promotion is a later admin feature; the table supports it from day one.

**Other workflows:** the three `resolve_*` tools are read tools available to
every controller (Teaching uses them for must-know parts alongside
`lessonLadder`; Practice uses them to pick question focus). `syllabus.generate`
is available in Study Prep planning and Practice preparation only.

### 8.8 Files, uploads and non-traditional goals (D33)

**Learners can give Study Prep their own files** — "Here's the past paper and
reading list, help me prepare for the XYZ scholarship test", a competition
handbook, course notes, a photo of a syllabus.

**Uploads go into the learner's Records library** (`modules/records` ✅), not
just into one chat message:

- Files attached in the Agent Chat while starting or running a Study Prep
  session are saved as Records (PDF, text, image, and anything Records
  already extracts), then extracted and indexed by the existing pipeline
  (`/api/records/extract`, `record_chunks`, hybrid search). Today chat
  attachments are read for one message and discarded; for Study Prep they persist.
- The session keeps the list: `study_prep_sessions.material_record_ids`.
- Study Prep uploads are **private by default** — not shown in the Records
  "discover" feed unless the learner chooses to share them.
- Limits are the Records limits (size, count, file types); scanned PDFs and
  photos go through the existing vision extraction.

**New tools:**

| Tool | Level | What |
|---|---|---|
| `materials.list` | read | The session's materials and their extraction status |
| `materials.search({ query })` | read | Hybrid search over the session's materials (Records search, scoped to these records) |
| `syllabus.from_documents({ recordIds })` | execute | Builds a syllabus outline from the materials — reuses the syllabus extraction (`extractSyllabusFromText` / `extractSyllabusViaVision`) when the file *is* a syllabus, otherwise drafts topics from the content. Saved to `edu.generated_syllabi` with `source = 'documents'` and the record ids. Same code checks as `syllabus.generate`. |
| `learner.request_materials({ reason })` | propose ⟂ | Asks the learner for a syllabus or materials ("Do you have the scholarship's syllabus or past questions? Upload them, or I can draft an outline"). Shows an upload card; the step ends until the learner replies. |

**Goal type decides where the syllabus comes from.** The controller reads the
goal and classifies it (`curricular` — school/national exam; or
`non_curricular` — scholarship, competition, professional or course exam,
self-chosen topic). Syllabus sources, in order:

| Order | Curricular goal | Non-curricular goal |
|---|---|---|
| 1 | Learner's documents, if attached | Learner's documents, if attached → `syllabus.from_documents` |
| 2 | Class → school → platform syllabus (§8.7) | Platform syllabus, if the competition/exam is on Akoro |
| 3 | — | `learner.request_materials` (ask once) |
| 4 | `syllabus.generate` | `syllabus.generate` from the goal description (if the learner has nothing to upload or says "just draft it") |

`syllabus_source` gains `documents`. The harness keeps the "real source wins"
rule: `syllabus.generate` is rejected while documents or a real syllabus are
available, and `request_materials` may be asked once per session.

**Materials beyond the syllabus:**
- **Agent Check questions** (§7.12) for a documents-based session come from the
  materials first (NaNa writes questions from the learner's files; answer keys
  stay server-side), then the question bank.
- **Teaching:** NaNa can draw on the materials when coaching. The learner's
  agent still only knows what the learner teaches it — uploading a file does
  not put it into the agent's notes.
- Plan card shows "Outline drawn from your files: *Scholarship handbook.pdf*".

---

## 9. Workflow 2 — Teaching (agent-driven)

**Purpose:** the learner teaches the protégé (their AI Student Agent); the
system produces evidence of the learner's understanding.
**Entries:** Dashboard → Teach Agent → Start Session (`entry_mode = direct`);
Study Prep handoff (`entry_mode = study_prep`); Decay handoff
(`entry_mode = decay_review`); Continue (resume, never create).
**Owns:** teaching state, teaching evidence, transcript (`adaptive_sessions`
row), phases, mode.

### 9.0 Two teaching modes (D24)

| | `teach_agent` — Learn by teaching | `learn_with_guide` — Learn with the guide |
|---|---|---|
| Who the learner talks to | The protégé (their AI Student Agent), with NaNa coaching on the side | NaNa (the teaching guide) only |
| Protégé | Yes | **No** — never called |
| What the learner does | Explains the concept so the protégé understands | Learns from NaNa: answers check questions, explains back to NaNa, works examples |
| Evidence comes from | The learner's explanations to the protégé | The learner's answers and explain-backs to NaNa |
| Progression gate | `applyTeachingProgress` | The same gate, same must-know parts |
| Typical use | Teach-back strategy; Dashboard "Teach Agent" | First exposure, `different_analogy`, a learner who isn't ready to teach yet |

- **One workflow, two modes.** `teaching_mode` is stored on the session row
  and on every turn event. The learner switches with the existing toggle in
  `TeachAgentModal`; the switch is a learner action that applies from the next
  turn. Transcript, evidence, phase and mustKnow position carry across.
- **Phase labels per mode** (same phase ids, different learner copy):
  guide mode — "What do you already know?" · "Must-know parts" ·
  "Explain it back to me" · "Push a little further" · "Mastery".
- **Evidence weighting:** every evidence row carries
  `source: "teach_agent" | "learn_with_guide"`. The Education Engine may weight
  them differently (explaining to the protégé is stronger evidence than
  answering a guide's question); the gate's MASTERY rule is unchanged.
- **Default mode by entry:** Dashboard → the learner chooses; Study Prep
  handoff with `teach_back` → `teach_agent`; Study Prep or Decay with
  `different_analogy` → `learn_with_guide` (§12.1).
- Today the toggle is UI-only (no backend, an honest "not wired yet" note).
  This plan wires it.

### 9.1 Who is who (locked, D4)

| Role | What it is | Can it change state? |
|---|---|---|
| **Teaching controller agent** | The LLM that drives the session through the agent loop | No — it proposes |
| **Protégé (Student Agent)** | A `persona` tool: produces the protégé's reply in a requested move. `teach_agent` mode only. | No |
| **NaNa Esumai** | A `persona` tool. `teach_agent`: a coaching nudge for the learner. `learn_with_guide`: the guide's teaching reply to the learner. | No |
| **Sargeant** | A `persona` tool: assessment judgement/boundary | No |
| **Harness + gate** | Code | Yes — the only writer |

### 9.2 States (persisted)

```
created → preparing → ready → teaching_active ─────────────┐
                                  │   ▲                    │
                                  │   └── adapt_strategy ◄─┤ (objective not yet met,
                                  │                        │  agent changes strategy)
                                  ▼                        │
                               assessing ──────────────────┘ (more teaching needed)
                                  │
                              completed  (objective met, or bounded end)

teaching_active | ready | preparing ⇄ paused
any non-terminal → abandoned | cancelled
```

- `ready` = created and prepared, waiting for the learner to open it (the
  normal resting state after a Study Prep handoff).
- **Sub-state inside `teaching_active`:** the phase
  `PHASE_1 → PHASE_2 → PHASE_3 → PHASE_4 → MASTERY` plus `mustKnowIndex`,
  changed **only** by `applyTeachingProgress` ✅ (D17).
- `evidence_capture` is an operation, not a state (D18).
- `assessing` is entered when the agent requests an assessment and the gate
  allows it; scored by the server.

### 9.3 One turn (D5–D8)

```
learner message
   │
   ▼
① HARNESS PRE-STEPS (always, in order)
   load_session_state
   observe_teaching_evidence        → evidence observation + dialogueMove
   │
   ▼
② CONTROLLER AGENT LOOP (max 3 iterations, 8 s decision timeout)
   context: teaching_controller (+ teaching_strategy when choosing a strategy)
          + evidence observation + learner concept state + misconceptions
          + phase/mustKnow + default recommendation
   iteration: agent picks ONE tool → harness validates → executes → observation
   ends immediately when the agent's action replies to the learner (⟂)
   │
   ├── timeout / malformed / LLM error / cap reached without reply
   │      → FALLBACK: harness executes the default recommendation
   │        (ACTION_FOR_DIALOGUE_MOVE[dialogueMove] → protege.respond with that move)
   │        emits decision.fallback
   ▼
③ HARNESS POST-STEPS (always, in order)
   assess_protege_understanding
   persist_cognitive_state
   record_verified_learning          → Education Engine normalises evidence
   gate_teaching_progress            → applyTeachingProgress (phase / subtopic / MASTERY)
   │
   ▼
events → store → socket → modal
```

The learner always gets exactly one reply per turn (from the agent's choice
or the fallback): the protégé's in `teach_agent` mode, NaNa's in
`learn_with_guide` mode. Evidence recording and the gate run every turn
whatever the agent did — nothing it generates can skip them.

**Guide mode differences in the turn:**
- Pre-step `observe_teaching_evidence` reads the learner's answer/explain-back
  to the guide instead of their explanation to the protégé.
- Post-step `assess_protege_understanding` is skipped (there is no protégé);
  its place is taken by `assess_learner_response` (Education Engine checks the
  answer against the must-know part; Sargeant may judge free-text answers).
- Fallback reply: `guide.teach` with the move from the default recommendation
  table (`DIG_DEEPER` → re-ask with a narrower question, `USE_ANALOGY` → an
  analogy, `CLEAR_MISTAKE` → correct the misconception, etc.).

### 9.4 Operations → tools → context set

| Operation | Agent tools | Level | Terminal? |
|---|---|---|---|
| inspect_learner_state | `learner.get_state`, `learner.get_history`, `learner.get_relevant_memory` | read | no |
| inspect_topic | `teaching.get_state`, `teaching.get_evidence`, `concept.get_prerequisites`, `curriculum.get_lesson_ladder` | read | no |
| evaluate_explanation / identify_gap | (reads the pre-step observation; may call read tools) | — | no |
| ask_followup / request_clarification / challenge | `protege.respond({ move, focusConcept })` with `move ∈ {ask_followup, request_clarification, challenge, acknowledge, teach_back_prompt, confused_student}` | persona | **yes** ⟂ |
| coach | `guide.coach({ focus, style })` (NaNa) | persona | no (protégé reply still follows) |
| select_teaching_strategy / adapt_strategy | `strategy.select({ strategy, reason_code })` | propose | no |
| assess | `teaching.request_assessment({ conceptIds })` → an Agent Check (§7.12) on the concepts just taught; the protégé answers from the notes; Sergeant judges | execute | **yes** ⟂ (result card) |
| complete | `teaching.propose_complete()` — accepted only if `teachingObjectiveMet`; else `objective_not_met` | propose | **yes** ⟂ |
| pause | `teaching.propose_pause({ reason })` | propose | **yes** ⟂ |

**Guide mode catalogue** (`learn_with_guide`) — the protégé tools are not
offered at all; the harness rejects them with `tool_not_permitted` if requested:

| Operation | Agent tools | Level | Terminal? |
|---|---|---|---|
| inspect_learner_state / inspect_topic | same read tools as above | read | no |
| teach | `guide.teach({ move, focusConcept })` with `move ∈ {explain, ask_check_question, give_example, use_analogy, correct_misconception, ask_explain_back, summarise}` | persona | **yes** ⟂ |
| select_teaching_strategy / adapt_strategy | `strategy.select` | propose | no |
| assess / complete / pause | same as above | — | **yes** ⟂ |

Fixed harness steps (never in the catalogue): `load_session_state`,
`observe_teaching_evidence`, `assess_protege_understanding`,
`persist_cognitive_state`, `record_verified_learning`,
`gate_teaching_progress`. These are today's `teaching-workflow/tools.js`
implementations, reused as-is.

Context sets: `teaching_controller` (teach_agent) or `guide_controller`
(learn_with_guide) for every operation; `teaching_strategy` added when the
operation is strategy selection/adaptation. The protégé and
NaNa keep their own persona sets (`persona_student_agent`, `persona_nana`) ✅
inside their tool calls.

### 9.5 Policy constants (`TEACHING_POLICY`)

```js
MAX_ITERATIONS_PER_TURN: 3          // D7
DECISION_TIMEOUT_MS: 8000           // D8 → fallback
MAX_STRATEGY_CHANGES: 2             // per session; then bounded end
MAX_TURNS: 60                       // per session; then bounded end
MAX_ASSESSMENTS: 2                  // per session
SESSION_TOOL_CALL_CAP: 120
```

### 9.6 Completion and outcome

- **Objective met:** gate entered `MASTERY` and all concepts verified →
  optional assessment → `completed`, `objectiveMet: true`.
- **Bounded end:** turn or strategy cap reached → `completed`,
  `objectiveMet: false`, `recommendedNextAction: "flag_gap" | "escalate_human"`.
- **Learner leaves:** stays `paused`/`teaching_active`; resumable.
- **Learner ends it:** `abandoned` with reason.

```json
{
  "workflowId": "TS456",
  "status": "completed",
  "outcome": {
    "objectiveMet": true,
    "objectiveEvidence": [
      { "conceptId": "evaporation",   "status": "demonstrated" },
      { "conceptId": "transpiration", "status": "demonstrated" }
    ],
    "strategyUsed": "teach_back",
    "strategyVersion": 1,
    "recommendedNextAction": "retest"
  },
  "source": { "workflowId": "SP123", "topicId": "TOP789", "reason": "teach_back" }
}
```

Direct sessions have `source: null` and emit a standalone completion; their
evidence still updates the learner model.

### 9.7 Transport and UI

**The Teaching modal keeps its current UI (D28).** No thinking blocks or tool
rows are added to `TeachAgentModal`. It keeps rendering the conversation
bubbles, phase labels, and the existing per-step labels
(`teaching_workflow_step`). Under the hood:
- the agent-driven turn (§9.3) still runs and still emits/stores
  `workflow_events` (replay, audit, developer mode, Study Prep handoff);
- the modal receives only what it renders today: the reply (protégé or NaNa,
  streamed as now), phase/progress changes, step labels, and gates
  (assessment card, completion);
- `teaching_workflow_step` labels now come from the narrator for whichever
  tools actually ran, instead of the fixed 8-step list;
- `learn_with_guide` mode uses the modal's existing guide view (today
  UI-only), now backed by the server.

The modal keeps its Socket.IO connection. New messages:
`open_workflow { workflowId }` → server resumes the instance and replays
events after the client's last sequence. `teacher_message` is unchanged.
`start_adaptive_session` stays for compatibility and internally becomes
`create or resume Teaching Workflow` (fresh → create; continuation → resume
by the session's `workflow_id`).

---

## 10. Workflow 3 — Decay Review

**Purpose:** recover knowledge that was demonstrated before and has weakened.
**Entries:** dashboard decay alert, Decay Session button, decay notification.
Created by the learner action, never by the scheduler (the scheduler only
raises alerts).
**Owns:** review state, retention review evidence.

### 10.1 States (persisted)

```
created → inspecting → diagnostic → evaluating
                                       │
                         ┌─────────────┴─────────────┐
                      retained                    decayed
                         │                           │
                     completed                 intervention ◄──────┐
                                                     │             │
                                                   retest          │
                                           ┌─────────┴─────────┐   │
                                         passed              failed│
                                           │                   │   │
                                       completed         adapt_strategy
                                                     (cap → completed, not retained)
any non-terminal ⇄ paused ; → abandoned | cancelled
```

### 10.2 Operations → tools → context set

| Operation | Agent tools | Set |
|---|---|---|
| inspect_decay / inspect_history / inspect_concept | `decay.get_alert`, `learner.get_history`, `learner.get_concept_evidence`, `concept.get_prerequisites` | `decay_inspection` |
| generate_diagnostic | `practice.run_agent_check({ mode: "retention_check", size: small })` ⟂ — has the agent's knowledge faded? | `decay_inspection` |
| evaluate_retention | read the scored result (Education Engine `evaluateRetention` decides retained/decayed) | `decay_inspection` |
| select_strategy | `strategy.select` (normally `retrieval_practice` first), `request_teaching` ⟂ (creates a child Teaching Workflow, `entry_mode = decay_review`) | `decay_review` |
| retrieval_practice | `retrieval.ask({ conceptId, hintLevel })` ⟂ — recall question; the hint ladder (none → cue → partial) is enforced by the harness; answers scored server-side; up to 3 rounds | `decay_review` |
| intervene | turn-based, same turn shape as Teaching §9.3: `guide.coach`, `protege.respond` ⟂ (the learner re-teaches the agent) | `decay_review` |
| generate_retest / score_retest | `practice.run_agent_check({ mode: "retest" })` ⟂; scoring harness-only | `decay_review` |
| complete | `decay.propose_complete` ⟂ | `decay_review` |

**Typical decay path with `retrieval_practice`:**

```
short check (≈3 questions) → evaluate_retention: decayed
→ retrieval_practice: up to 3 recall rounds, hint ladder, server-scored
   each answer → retrieval_success / retrieval_failure evidence
→ retest
   passed → completed; Education Engine pushes the next review date further out
   failed → recall isn't enough, it needs re-learning
          → different_analogy (Teaching in learn_with_guide mode, or inline)
            or teach_back (child Teaching in teach_agent mode)
```

Effect: most reviews become short and cheap; full teaching only happens when
recall clearly fails; recall results feed the retention curve directly.

The intervention phase reuses the Teaching turn runtime (pre-steps → agent
loop with cap 3 and fallback → post-steps), so today's decay experience
(a teaching dialogue seeded with the prior lesson) is preserved.

### 10.3 Fixed in code

Retention evaluation, scoring, thresholds, attempt caps (max 2 retests),
evidence writes, the notification-ownership check (`markNotificationRead`) ✅.

### 10.4 Outcome

`{ retained: bool, retentionBefore, retentionAfter, strategyUsed, evidence[] }`
→ learner model; alert resolved; next review date set by the Education Engine.

---

## 11. Workflow 4 — Practice (live proctored assessment)

**Purpose:** Practice **is** the live proctored assessment — the existing
Session Assessment Gateway (`AssessmentRoom.jsx` + `assessmentGateway.js`):
identity check, webcam proctoring, Sergeant-led question-and-answer, and a
cheat-aware verdict. The workflow type stays `practice`.

Do not confuse it with the **Agent Check** (§7.12) that Study Prep, Teaching
and Decay use for diagnostics and retests. In the Agent Check the learner's
agent answers; in this workflow the **human** answers, proctored.

**Entries:** dashboard (today's assessment, `/assessment/today` ✅),
assessment list, a recommendation from another workflow's outcome
(e.g. Teaching completed → "Take a proctored check").
**Owns:** the assessment session (`edu.assessment_sessions` ✅), Q&A
transcript, proctoring record, verdict.

### 11.1 What exists today ✅

- Socket events: `register_reference → start_assessment → proctor_frame* /
  assessment_message* → request_assessment_summary → end_assessment`, plus
  `resume_assessment` with a 3-minute reconnect grace.
- Identity: reference photo, identity match via the optional `proctor-service`
  (InsightFace + YOLOv8) or browser TF.js signals.
- `TemporalScorer` turns per-frame signals into a cheat probability;
  auto-terminate at **0.85** (`TERMINATE_PROBABILITY`).
- Sergeant (`agents/sargeant`) generates questions, evaluates answers, gives
  hints, checks drift, and writes the verdict text.
- Table `edu.assessment_sessions`: status `active | completed | abandoned |
  terminated`, `questions`, `block_history`, `cheat_events`,
  `proctoring_signals`, `assessment_score` (0–100), `cheat_probability`,
  `final_verdict` (`pass | fail | flagged | terminated`), `verdict_detail`.
- Voice exam mode (`VoiceExam.jsx`).

### 11.2 States (persisted)

```
created → consent ──(reference photo registered)──► preparing ──(questions ready)──► in_progress
                                                                                       │
                                     ┌──────────────── integrity terminate (≥ 0.85) ◄──┤
                                     ▼                                                 │ all questions
                                 terminated                                            ▼ answered
                                                                                    scoring
                                                                                       │
                                                                                   evaluated ──► completed
in_progress ⇄ paused (socket drop; resumable within the grace window, then abandoned)
any non-terminal → abandoned | cancelled
```

`edu.assessment_sessions.status` stays as it is; the richer states live on
`workflow_instances.state`. `terminated` is a terminal state the agent can
never cause or reverse.

### 11.3 Operations → tools → context set

| Operation | Agent tools | Set |
|---|---|---|
| prepare | `learner.get_state`, `learner.get_history`, `concept.get_prerequisites`, `teaching.get_evidence` (read) | `practice` |
| generate_questions | `assessment.generate({ focusConcepts, count, difficulty })` ⟂ — Sergeant generates; question bank and rubric stay server-side | `practice` |
| conduct (per turn) | `assessment.ask_next` ⟂ · `assessment.probe({ depth })` ⟂ (a follow-up on the same question) · `assessment.give_hint({ level })` ⟂ | `practice` |
| evaluate_answer | harness-only: Sergeant judges against the rubric (assessor role, model locked, D23); Education Engine normalises the judgement to a score | — |
| recommend_next | `practice.recommend_teaching` ⟂ · `practice.recommend_retrieval` ⟂ · `practice.propose_complete` ⟂ | `practice` |

The agent decides **what to ask and how deep to go** (focus concepts,
follow-up probes, whether a hint is warranted). It never decides the score,
the verdict, or anything about integrity.

### 11.4 Fixed in code (never the agent's call)

- All proctoring: frame analysis, identity match, `TemporalScorer`, the 0.85
  auto-terminate, cheat events. The agent does not see raw frames and cannot
  pause, soften or override proctoring.
- Hint policy: maximum hints per question and per session, and the score
  deduction each hint carries (harness constants).
- Scoring: Sergeant's per-answer judgement is a **proposal**; the Education
  Engine applies the rubric and produces `assessment_score`.
- Verdict: `final_verdict` is computed by code from score, pass threshold and
  `cheat_probability` (`flagged` when integrity is doubtful even if the score
  passes). Sergeant writes only `verdict_detail` (the explanation).
- Evidence: written to the learner model only for `completed` sessions that
  are not `flagged`/`terminated`.
- The assessor model is locked by env (D23); the learner's model choice does
  not apply to judging. It may apply to the controller's question selection.

### 11.5 Agent loop

Turn-based, like Teaching: **pre-step** (record the answer, harness scoring)
→ **agent loop** (max 3 iterations, ends when the agent asks the next
question/probe/hint) → **post-step** (progress, integrity check, evidence
queue). Decision timeout or malformed output → fallback: ask the next
question in the generated order (today's behaviour).

### 11.6 UI

**`AssessmentRoom` keeps its current UI** (D28): consent → split view
(webcam + proctor meter / Sergeant Q&A) → summary. No thinking blocks or tool
rows. Events are still stored in `workflow_events` (replay, audit, developer mode).

### 11.7 `retrieval_practice` (D25) in this workflow

Not during the proctored attempt — recall hints would change what is being
measured. It is offered **after** the summary (`practice.recommend_retrieval`)
on concepts the learner missed; it runs in the Agent Chat tab or a Decay
Review, not inside the assessment.

### 11.8 Outcome

```json
{ "workflowId": "…", "status": "completed",
  "outcome": { "score": 80, "passed": true, "verdict": "pass",
               "cheatProbability": 0.12, "conceptEvidence": [ … ],
               "recommendedNextAction": "none" | "teaching" | "retrieval_practice" } }
```

A `terminated` or `flagged` assessment emits an outcome too, with no
evidence written and `recommendedNextAction: "none"`.

---

## 12. Cross-workflow relationships

### 12.1 Study Prep → Teaching handoff

```
Agent Check 3/5 → Education Engine: below 70% → topic: intervention_required
   → agent (strategies set): request_teaching({ strategy, focusGaps })
   → harness checks: Study Prep active · topic is intervention_required ·
     strategy permitted · no non-terminal Teaching child for this topic ·
     idempotency key unused
   → ONE transaction:
        create Teaching instance (entry_mode=study_prep, parent=SP, source topic, reason, strategy)
        create teaching_sessions/adaptive_sessions row (state = ready)
        topic: intervention_required → awaiting_teaching, teaching_workflow_id set
   → events: strategy.selected · workflow.handoff_created · topic.state_changed
   → activity: "I created a teaching session for Water Cycle. You can continue it from your dashboard."
   → Study Prep instance status: waiting_child
```

If a non-terminal Teaching child already exists for the topic, the harness
returns it (resume) instead of creating another.

A Study Prep child always starts in **`teach_agent`** mode, because the
retest is an Agent Check and only teaching the agent changes its notes (D31).
The strategy and the gaps the check named are passed in, and shape how NaNa
coaches. The learner may switch to `learn_with_guide` to understand the topic
first, but the topic only improves once they teach the agent.

### 12.2 Teaching → Study Prep completion

```
Teaching completes → emitOutcome → Workflow Engine delivers TEACHING_COMPLETED
   → StudyPrepController.onChildOutcome validates:
        child belongs to this session + topic · topic is awaiting_teaching ·
        outcome schema valid
   → CAS: awaiting_teaching → retest_ready (sets learner_confirmed_ready from outcome)
   → events: workflow.handoff_completed · topic.state_changed
   → notification: "Teaching complete — Study Prep retest is ready"
   → Study Prep status: waiting_learner
```

Teaching never writes Study Prep tables. Study Prep owns its response.

### 12.3 Abandoned or unmet teaching

`TEACHING_ABANDONED` or `objectiveMet: false` → Study Prep wakes its agent
(reflection/strategies). Policy-bound options: another strategy if attempts
remain, `defer_topic`, or `topic.flag`. Never automatic infinite retry.

### 12.4 Decay → Teaching

Same mechanics as 12.1 with `entry_mode = decay_review`. Decay waits in
`intervention` with status `waiting_child`.

### 12.5 Ownership

| Owner | Owns |
|---|---|
| Workflow Engine | generic lifecycle, relationships, outcome delivery |
| Study Prep | session, plan, topics, progression |
| Teaching | teaching state, phases, teaching evidence, transcript |
| Decay Review | review state, retention review |
| Practice | practice session, attempts |
| Education Engine | scoring, thresholds, evidence rules, mastery rules |
| Adaptive Learning Engine | strategy recommendation, adaptation |

One authoritative writer per transition (single-writer principle).

---

## 13. Dashboard and frontend

### 13.1 Dashboard as workflow launcher and continuation surface

| Button | Creates / resumes |
|---|---|
| Study Prep | Study Prep Workflow |
| Teach Agent → Start Session | Teaching Workflow (direct) |
| Decay alert → Review | Decay Review Workflow |
| Practice | Practice Workflow |
| Continue (any card) | `resume(workflowId)` |

Frontend receives explicit descriptors — never infers type from session shape
(replace the `if decay … else if hasHistory …` logic in `LearnerDashboard.jsx`):

```json
{ "workflowId": "TS456", "workflowType": "teaching", "status": "waiting_learner",
  "state": "ready", "title": "Water Cycle", "focus": "Evaporation vs Transpiration",
  "entryMode": "study_prep", "source": { "workflowId": "SP123", "title": "Basic Science Study Prep" },
  "progress": { … }, "updatedAt": "…", "continue": { "available": true } }
```

```js
switch (wf.workflowType) {
  case "study_prep":   openStudyPrep(wf.workflowId); break;
  case "teaching":     openTeaching(wf.workflowId); break;
  case "decay_review": openDecayReview(wf.workflowId); break;
  case "practice":     openPractice(wf.workflowId); break;
}
```

`TeachAgentModal` and `DecaySessionModal` accept `workflowId`; new direct
sessions call `POST /api/teaching/workflows` first, then open the modal. The
modal does not own state.

### 13.2 Stream components (all workflows)

| Component | Renders |
|---|---|
| `ThinkingBlock` | `agent.narration` — "⚙ Thought for 2s · [context]" collapsed; expanded: muted-blue context label + narration |
| `ToolGroup` / `ToolRow` | `tool.*` — consecutive research/inspection calls group; single actions show with timing |
| `ActivityMessage` | `activity` — large plain text, never collapsed |
| `ScoreCard` | `assessment.completed` |
| `PlanCard` | plan proposal + Approve gate |
| `TeachingHandoffCard` | `workflow.handoff_created` |
| `WorkflowCard` / `WorkflowResumeCard` | dashboard descriptors |
| `WorkflowStateBadge` | state/status |
| `GateButton` | `learner.action_required` |
| Verification row (red) | `decision.rejected` |

These stream components are for the **Agent Chat tab** (D28). The Teaching
and Decay modals keep their existing UI and consume only the events they
render today (§9.7). Dashboard cards (`WorkflowCard`, `WorkflowResumeCard`,
`WorkflowStateBadge`) are used on the dashboard regardless.

`streamReducer(events) → UI messages` is pure and shared. The UI never needs
workflow internals. Pattern THINKING → TOOL GROUP → ACTIVITY is supported but
not required — any subset in any order is valid (v3 §78).

**The general agent chat (`/chat/agent`, `AgentChatTab.jsx`) uses the same
stream and components.** It is not a workflow, so its events are not stored in
`workflow_events`, but it emits the same envelope over its existing SSE
connection: today's `thinking`/`delta`/`status` events map to
`agent.narration.delta`/`reply.delta`/`tool.*`, and `status` one-liners become
proper `ToolRow`s. The existing `ThoughtBlock` becomes the shared
`ThinkingBlock`. When a chat tool starts a workflow (e.g.
`start_study_prep_session`), the chat shows that workflow's stream inline.

The `Learning Workflows chat simulation.md` HTML is the visual reference for
component structure, row format and stream order.

### 13.3 Developer mode

Behind a developer flag: workflow type/state/sub-state, operation, tool name,
event id, sequence, latency, context set, rejection codes, fallback reason.

---

## 14. Data model and migrations

### 14.1 New tables 🆕

```sql
edu.workflow_instances (
  id uuid pk, learner_id uuid not null,
  workflow_type text check in ('study_prep','teaching','decay_review','practice'),
  status text check in ('created','active','waiting_learner','waiting_child','paused','completed','abandoned','cancelled'),
  state text not null,                  -- domain state
  entry_mode text,                      -- direct | study_prep | decay_review | decay_alert | chat | dashboard
  parent_workflow_id uuid null references edu.workflow_instances(id),
  source_workflow_id uuid null, source_topic_id uuid null, source_reason text null,
  idempotency_key text null,
  policy_version text, workflow_version text, context_version text, strategy_version int,
  locked_until timestamptz null,        -- single active agent step
  model_selection jsonb default '{}',   -- learner choice + resolved model per role (§7.11)
  paused_reason text null,
  metadata jsonb default '{}',
  created_at, updated_at, completed_at, abandoned_at, cancelled_at
)
-- unique non-terminal child per (source_workflow_id, source_topic_id, source_reason)
-- index (learner_id, status, updated_at desc)

edu.workflow_events (
  id uuid pk, workflow_id uuid not null references edu.workflow_instances(id),
  sequence int not null, event_type text not null, category text, operation text,
  workflow_state text, sub_state text, context_set text,
  actor text check in ('agent','system','learner'),
  visibility text check in ('learner','developer','audit'),
  turn_id text null, payload jsonb not null default '{}', created_at timestamptz default now(),
  unique (workflow_id, sequence)
)

edu.decay_review_sessions (
  id, workflow_id, learner_id, subject, topic, concept_id, alert_id,
  decay_reason, confidence_before, retention_before, retention_after,
  status, strategy_used, evidence jsonb, created_at, updated_at, completed_at
)

-- Practice uses the existing edu.assessment_sessions (§14.2); no new table.

content.blog_chunks (                 -- §7.14
  id uuid pk, post_id uuid references content.blog_posts, heading text,
  body text, embedding vector, position int, updated_at timestamptz
)

edu/public user_agents: + help_others_opt_in boolean default false, + helped_count int default 0   -- §7.13

edu.learning_struggles (               -- §7.13.1, §7.15
  id uuid pk, learner_id uuid, agent_id uuid,
  category text, struggle_type text,    -- STRUGGLE_TYPES (versioned)
  subject text, class_level text, concept_id uuid null, topic_label text,
  detected_by text check in ('rule','agent','learner'), detected_at timestamptz,
  evidence_refs uuid[], status text check in ('open','resolved','abandoned','expired'),
  struggle_summary text null, misconception_key text null,
  attempts_before int, strategies_tried text[],
  what_worked_strategy text null, what_worked text null,
  score_before numeric, score_after numeric, days_to_overcome int, resolved_at timestamptz,
  source_workflow text, sensitive boolean, shareable boolean default false,
  hidden boolean default false, expires_at timestamptz null, embedding vector
)
-- index (struggle_type, concept_id, status); index (learner_id, status)

-- question tags for detection (§7.15.1): on every generated/bank question
--   skill ('recall'|'apply'|'transfer'), format, time_budget_s
edu.confusion_pairs ( subject text, concept_a uuid, concept_b uuid, observed int, status text )
)

edu.generated_syllabi (
  id uuid pk, created_by_learner uuid, subject text, class_level text,
  exam_board text null, term text null,
  topics jsonb not null,              -- [{ id, label, objectives[] }]
  grounding jsonb,                    -- platform chunk ids / partial matches used
  model text, prompt_version text,
  source text check in ('generated','documents') default 'generated',   -- §8.8
  record_ids uuid[] null,             -- learner files it was drawn from
  status text check in ('provisional','promoted','rejected') default 'provisional',
  promoted_subject_id uuid null,      -- edu.syllabus_subjects when promoted
  created_at timestamptz default now()
)
-- one provisional outline per scope, reused across learners:
-- unique index on (lower(subject), lower(class_level), coalesce(exam_board,''), coalesce(term,''))
--   where status = 'provisional'
```

### 14.2 Changed tables 🟡

```
edu.study_prep_sessions   + workflow_id, syllabus_source ('documents'|'class'|'school'|'platform'|'generated'),
                            syllabus_ref, goal_type ('curricular'|'non_curricular'), material_record_ids uuid[]
edu.study_prep_topics     + teaching_workflow_id; status check widened to §8.3 states
edu.adaptive_sessions     + workflow_id, entry_mode, source_workflow_id, source_topic_id, strategy,
                            teaching_mode ('teach_agent' | 'learn_with_guide')
edu.adaptive_workflow_runs + workflow_id, study_prep_topic_id (attempt record only)
edu.assessment_sessions   + workflow_id (Practice); status values unchanged
edu.study_prep_events     read-only after cut-over; backfilled into workflow_events
```

`teaching_sessions` as a separate domain table is **not** created now;
`adaptive_sessions` with the added columns is the Teaching domain table.
Renaming is a later, optional cleanup.

### 14.3 Data migration

- Existing `study_prep_sessions` → one `workflow_instances` row each
  (`study_prep`), keeping ids where possible.
- Existing `adaptive_sessions` → `teaching` instances (or `decay_review` when
  `session_type = 'decay_review'`).
- Backfill `study_prep_events` → `workflow_events` with the same sequences.
- All migrations idempotent (`IF NOT EXISTS`, guarded backfills), tolerant of
  rolling deploys (the `isMissingColumn` pattern in `lifecycle.js` ✅).

---

## 15. API surface

**Generic** 🆕

```
POST /api/workflows                     { workflowType, entryMode, … }  → descriptor
GET  /api/workflows                     ?active=true  → descriptors for dashboard
GET  /api/workflows/:id                 → descriptor + domain view
POST /api/workflows/:id/resume
POST /api/workflows/:id/pause
POST /api/workflows/:id/cancel
POST /api/workflows/:id/abandon
GET  /api/workflows/:id/events          ?after=N
GET  /api/workflows/:id/stream          (SSE)
```

**Study Prep** ✅ (`/study-prep`, all 17 existing endpoints kept). Changes:
`topics/:topicId/practice` and `topics/:topicId/submit` become one `topics/:topicId/agent-check`
(learner-triggered retry; the agent normally runs it). `teach-back-done` is retired —
retest unlocks on `TEACHING_COMPLETED`.

**Teaching** 🆕

```
POST /api/teaching/workflows            (direct create; returns workflowId)
GET  /api/teaching/workflows/:id
POST /api/teaching/workflows/:id/resume
GET  /api/teaching/workflows/:id/history
GET  /teaching/sessions, /teaching/sessions/:id/history   ✅ kept
Socket: open_workflow, teacher_message, workflow_event; start_adaptive_session (compat)
```

**Decay** 🆕

```
GET  /api/decay/alerts
POST /api/decay/workflows               { alertId }
GET  /api/decay/workflows/:id
POST /api/decay/workflows/:id/resume
```

**Practice** 🆕

```
POST /api/practice/workflows
GET  /api/practice/workflows/:id
POST /api/practice/workflows/:id/submit
```

All learner identity comes from the authenticated token/socket, never the body.

---

## 16. Feature flags

```
AKORO_STUDY_PREP_ENABLED          ✅ (default on)
AKORO_CONCEPT_TRACKER_ENABLED     ✅
WORKFLOW_ENGINE_ENABLED           🆕 instances + events dual-write
WORKFLOW_EVENT_STREAM_ENABLED     🆕 SSE/socket workflow_event + replay
STUDY_PREP_TOPIC_AGENT_ENABLED    🆕 agent wakes for topic decisions + context switching
TEACHING_WORKFLOW_V2_ENABLED      🆕 agent-driven teaching turns (off → old fixed pipeline)
TEACHING_GUIDE_MODE_ENABLED       🆕 learn_with_guide mode (off → toggle stays UI-only)
AI_MODELS / AI_MODEL_DEFAULT / AI_MODEL_ROLE_*  🆕 model catalogue and role routing (§7.11)
AI_MODEL_PICKER_ENABLED           🆕 learner model picker in the chat box
STUDY_PREP_TEACHING_HANDOFF_ENABLED 🆕 teach_back → Teaching Workflow
DECAY_WORKFLOW_ENABLED            🆕
PRACTICE_WORKFLOW_ENABLED         🆕
WORKFLOW_DEV_MODE                 🆕 developer event view
```

Every new path keeps the old path working while its flag is off.

---

## 17. Implementation phases

Each phase lists what to build and its exit criteria. **No phase may break an
existing contract test.** Phases 11 (UI) can start in parallel after Phase 3.

### Phase 0 — Audit and migration matrix
- Map every file in §6.2 with its callers, tables and socket messages.
- Map frontend entry points (`TeachAgentModal`, `DecaySessionModal`,
  `LearnerDashboard`, `SessionSheet`, `StudyPrepChatCard`, `AgentChatTab`).
- Verify the §20 items marked ❓.
- **Exit:** `reference/grand-plan/MIGRATION_MATRIX.md` committed; open questions answered or assigned.

### Phase 1 — Workflow infrastructure
- Migrations: `workflow_instances`, `workflow_events`, `workflow_id` columns.
- `workflows/engine.js`, `registry.js`, `store.js`, `definition.js` (generic transition helper).
- Study Prep dual-writes instance + events behind `WORKFLOW_ENGINE_ENABLED`.
- **Exit:** all study-prep contract tests green; new engine contract tests
  (create/resume/pause/complete/cancel/abandon, CAS transitions, idempotent create).

### Phase 2 — Agent runtime generalisation
- Promote `agent-loop.js`, `llm-agent.js` into `agent-runtime/`; add
  `operation`, `decisionTimeoutMs`, fallback hook, per-workflow caps.
- Generic harness core + per-workflow check plug-ins; existing rejection codes unchanged.
- Per-workflow tool registries over one binder; add `persona` level and display templates.
- Model switching backend (§7.11.6 steps 1–4): `lib/modelRegistry.js`,
  roles, required prices, `__role` on `meteredCreate`, provider adapters.
- **Exit:** Study Prep runs through the generic runtime with identical
  behaviour (existing tests green); runtime contract tests with stub agents
  (cap, timeout → fallback, malformed → observation, terminal stop).

### Phase 3 — Event stream
- v3 envelope; `ActivityNarrator` (templates for every event type, snapshot tests).
- Replay endpoint; SSE stream; Socket.IO `workflow_event`.
- Live deltas (§7.9.7): narration/intent and reasoning-summary streaming per
  provider, `activity` from the agent's `message` (D27) with the fact filter,
  streamed replies.
- Agent chat (`/chat/agent`) emits the same envelope.
- Backfill `study_prep_events`.
- **Exit:** reconnect test replays missing events in order; narrator contract
  test fails on any event type without a template.

### Phase 4 — Context Manager wiring
- Operation → set mapping per controller; replace hard-coded `"planning"` in `wiring.js`.
- New MD files and sets (§7.4); `AGENT.md` neutral identity; golden tests updated deliberately.
- **Exit:** context tests prove planning loads `planning`, strategy selection
  loads `strategies`, teaching turns load `teaching_controller`, etc.; all
  sets within budget; boot preflight green.

### Phase 4a — Learning evidence everywhere (D37)
- `recordLearningEvent` in the Education Engine; `source` on every event.
- Wire the **current** Teaching code (evidence observer) and Study Prep store to
  it now, so data starts accumulating before the workflow refactors.
- `recordStrategyOutcome`; struggle detection for the `rule` types (§7.15) and
  `recordStruggle` for agent/learner types; breakthrough resolution;
  `edu.learning_struggles`, question tags, confusion pairs, timings.
- One-off backfill from `adaptive_sessions.teaching_evidence` and exam-prep runs.
- **Exit:** a misconception detected and repaired in a live teaching session
  appears in `learner_concept_evidence` and produces a breakthrough row;
  backfill is idempotent; existing tests green.

### Phase 5 — Study Prep completion
- Topic state machine §8.3; exam-prep run reduced to attempt record.
- Agent wake triggers for topic decisions; every intervention via Teaching (D15).
- Agent Check (§7.12): `practice.run_agent_check`, `agent.get_knowledge_coverage`,
  built from `battle/agentRecall.js` + `questionSource.js` + Sergeant; locked
  recall/question/assessor models; guessed answers excluded from evidence.
- Absorb `workflow-state.js` / `adaptive-workflows.js` projections.
- Submit-status guard and transactional score/evidence/topic write.
- Files and non-traditional goals (§8.8): chat uploads → Records for Study Prep,
  `materials.*`, `syllabus.from_documents`, `learner.request_materials`, goal type.
- Peer agent help upgrade (§7.13) and blog passage search (§7.14).
- Syllabus resolution chain (§8.7): `resolve_class`, `resolve_school`,
  `resolve_platform`, `syllabus.generate` + `edu.generated_syllabi`, the
  `syllabus_exists` precondition, plan-card labelling.
- **Exit:** full Study Prep scenario passes without Teaching (inline strategy
  path), plus plan-rejection, budget-ceiling and cap-out scenarios.

### Phase 6 — Teaching Workflow (agent-driven)
- `teaching/controller.js`, `teaching/tools.js` (agent catalogue + fixed steps), `TEACHING_POLICY`.
- Turn runtime §9.3: pre-steps → loop (cap 3, end on reply, 8 s timeout → fallback) → post-steps.
- Protégé, NaNa, Sargeant wrapped as `persona` tools.
- `adaptive_sessions.workflow_id`; socket `open_workflow`; `start_adaptive_session` → create/resume adapter.
- Direct create endpoint; resume; history.
- `learn_with_guide` mode (§9.0): `guide.teach` tool, `guide_controller` set,
  `assess_learner_response` post-step, mode switch between turns, wire the
  `TeachAgentModal` toggle.
- **Exit:** Scenarios A and J; teaching contract tests: gate cannot be skipped,
  fallback on timeout/malformed, loop stops on reply, cap enforced,
  `propose_complete` rejected until objective met, phases unchanged vs
  today's gate tests (`state-machine.test.mjs`, `runner.test.mjs` equivalents).

### Phase 7 — Handoff and completion callback
- `request_teaching` → harness child creation (idempotent, one transaction).
- Outcome delivery → `StudyPrepController.onChildOutcome` → `retest_ready`.
- Abandon/unmet handling.
- **Exit:** Scenario B (critical end-to-end) passes, including app close and later resume.

### Phase 8 — Decay Review Workflow
- Extract pure retention functions from `decayEngine.js` into the Education Engine.
- `decay-review/controller.js`, tools, states; intervention reuses the teaching turn runtime.
- `mode: "decay"` becomes a compatibility adapter.
- **Exit:** Scenario C.

### Phase 9 — Practice Workflow (proctored assessment)
- `practice/controller.js` on top of `assessmentGateway.js`; `assessment_sessions.workflow_id`.
- Agent-driven question selection/probes/hints with fallback to the generated order.
- Verdict computed in code; Sergeant's judgement normalised by the Education Engine; assessor model locked.
- `AssessmentRoom` UI unchanged.
- **Exit:** Scenario D and its integrity variants; existing assessment gateway tests green.

### Phase 10 — Learner model unification
- Fold `decideNextAction` into Adaptive Learning Engine recommendations.
- Retire the per-session misconception copies (`student-state` arrays,
  `teaching_evidence` misconception fields) now that Phase 4a records them centrally.
- All workflows write through Education Engine; scale guards (0–1 vs 0–100).
- **Exit:** no direct writes to concept state outside the Education Engine (grep-enforced contract test).

### Phase 11 — UI
- `streamReducer`, `ThinkingBlock`, `ToolGroup`, `ToolRow`, `ActivityMessage`,
  `ScoreCard`, `PlanCard`, `TeachingHandoffCard`, `WorkflowCard`,
  `WorkflowResumeCard`, `WorkflowStateBadge`, `GateButton`.
- Dashboard descriptors + deterministic routing; modals take `workflowId`.
- Developer mode.
- Model picker in the chat box (§7.11.5) behind `AI_MODEL_PICKER_ENABLED`.
- **Exit:** UI acceptance checks in §18; Scenario K.

### Phase 12 — Hardening and rollout
- Failure tests §19; data migration §14.3; flag-by-flag rollout; observability
  (workflow_id, type, learner, operation, state, tool, latency, tokens, cost,
  result, error — never answer keys or reasoning).
- **Exit:** all scenarios A–K pass in staging with flags on; old paths removed only after a release with flags on.

---

## 18. Acceptance tests

**A — Direct teaching:** Dashboard → Teach Agent → Start Session → Teaching
Workflow created (`direct`) → modal opens → turns run (pre → agent → post) →
evidence recorded → MASTERY via gate → completed → learner model updated. No
Study Prep created.

**B — Study Prep teach-back (critical):** Study Prep → plan approved →
diagnostic 3/5 → `intervention_required` → agent requests teach-back →
Teaching created (`study_prep`, `ready`) → topic `awaiting_teaching` →
learner leaves → dashboard shows teaching card → continue → learner closes
app → returns later → teaching resumes → completes → `TEACHING_COMPLETED` →
topic `retest_ready` → continue Study Prep → retest 5/5 → `understood` →
next topic → … → session completes. No state lost at any point.

**C — Decay:** alert → Review → Decay Review created → inspect → diagnostic
→ decayed → `retrieval_practice` rounds → retest → evidence → completed; alert
resolved; next review date extended. Variant: recall fails → `different_analogy`
or child Teaching → retest. `retrieval_practice` requested inside Study Prep →
`strategy_not_permitted`.

**D — Practice (proctored):** start from the dashboard → reference photo →
questions generated → Q&A turns (agent picks follow-ups/hints within the hint
limits) → summary → code computes score and verdict → evidence written →
recommend next → completed. Variants: sustained cheat probability ≥ 0.85 →
`terminated`, no evidence, the agent cannot prevent or reverse it; socket drop
→ resume within 3 minutes; past the grace window → abandoned; a learner who
picked Claude Opus still gets judged by the locked assessor model.

**E — Reconnect:** agent running → socket/SSE drops → reconnect with last
sequence → state restored → missing events replayed in order → continues.

**F — Budget exhaustion:** wallet hits zero → harness blocks paid action →
workflow paused (`insufficient_balance`) → progress saved → learner notified →
top-up → resume.

**G — Attempt cap:** topic fails to cap → retry blocked → agent chooses
defer/flag within policy → one deferred retry per session.

**H — Agent-driven teaching guarantees:**
- an agent action that replies to the learner ends the loop that turn;
- 3 iterations without a reply → fallback reply, `decision.fallback` event;
- decision timeout → fallback reply within the turn;
- malformed output → fallback, no state change;
- `propose_complete` before the gate allows → `objective_not_met`;
- evidence and gate steps ran on every turn (asserted from events).

**L — Syllabus fallback:** (1) learner in a school whose class has a Basic
Science syllabus → plan uses the class topics, `syllabus_source = class`;
(2) class has none, school has one → `school`; (3) no school syllabus, platform
has JSS1 Basic Science → `platform`; (4) nothing anywhere → the agent calls
`syllabus.generate` → a checked, labelled outline is saved and used, the plan
card shows "AI-drafted outline", the learner confirms, the session runs
normally; a second learner with the same subject/level reuses it with no
generation charge; (5) the agent calls `syllabus.generate` while a platform
syllabus exists → `syllabus_exists`. No learner ever gets a dead end for lack
of a syllabus.

**M — Agent Check:** Study Prep topic starts → the agent checks note
coverage → notes exist → Agent Check runs: NaNa's questions, the agent's
answers citing the learner's notes, Sergeant's verdicts stream in the chat →
3/5 → Teaching (teach_agent) with the named gaps → the learner teaches → retest
Agent Check 5/5 → understood. Variants: no notes → no check, straight to
Teaching, no charge; the agent guesses correctly on UNKNOWN → shown as a guess,
not counted as evidence; the learner picked Claude Opus → recall, questions and
judging still use the locked models; the recall prompt contains nothing but
the learner's notes (asserted).

**N — Files and a scholarship goal:** the learner attaches a scholarship
handbook and a past paper and says "help me prepare for this scholarship
test" → files saved as private Records and indexed → goal classified
non-curricular → `syllabus.from_documents` builds the outline → plan card
says "drawn from your files" → Agent Check questions come from the files.
Variants: no files → the agent asks once for a syllabus or materials →
learner says "just draft it" → `syllabus.generate`; the agent tries
`syllabus.generate` while files are attached → rejected.

**O — Peer help:** learner A (opted in) confuses evaporation and
transpiration, fails twice, then passes after a teach-back with a stomata
drawing → a breakthrough record is written (summary and what-worked phrased by
the locked model, no quotes, no names). Learner B's Agent Check shows the same
confusion → the agent consults → B gets A's story ("took 3 tries; drawing the
leaf's stomata worked; 2/5 → 5/5") and, once ≥ 5 learners match, the pattern
("teach_back worked for 8 of 12") → NaNa tries that move in B's Teaching
session → nothing is written to B's notes or evidence. Variants: A has the
setting off → A's story is never returned; A turns it off later → all A's
records become unshareable; fewer than 5 matches → no pattern shown; learners who never opted in still count
toward the pattern totals but their stories are never returned; B's own
data never leaves B's side; A hides one story in Settings → it is never shown.

**P — Blog research:** the agent searches "spaced repetition before exams" →
a passage from a post body (not only titles) comes back with its slug → the
chat shows a source chip → the blog is never offered as a syllabus source.

**I — Plan rejection:** agent proposes an order violating prerequisites →
`prerequisite_violation` shown as a red verification row → agent revises →
valid plan shown.

**J — Learn with the guide:** Dashboard → Teach Agent → choose "Learn with
the guide" → Teaching Workflow (`learn_with_guide`) → NaNa teaches, asks check
questions, asks the learner to explain back → no protégé call appears in any
event → evidence recorded with `source: learn_with_guide` → gate reaches
MASTERY → completed. Then: switch modes mid-session → the next turn uses the
protégé, and phase/transcript/evidence carry over.

**K — Model switching:** default is `gpt-4o-mini`; the learner picks Claude
Sonnet in the chat box → the next message, the controller agent's decisions
and persona replies all use Sonnet and are billed at Sonnet's price; the
assessor stays on its env model; a Claude model never receives a forced
`tool_choice`; a Claude refusal becomes a `model_refusal` observation, not a
crash; a model outside the learner's tier is refused with a notice; a catalogue
entry without a price fails boot; adding Grok or DeepSeek is an env-only change;
a Pilot learner can switch to DeepSeek and to nothing else.

**UI checks (Agent Chat tab):** thinking text streams in live and the block collapses when it
ends; tool rows appear with a spinner and fill in their result; the agent's
activity text and replies stream word by word; Study Prep in the chat
looks the same as plain agent chat; **the Teaching and Decay modals look
exactly as they do today** (no trace UI), while their events are still stored; thinking blocks collapse/expand; tool rows stream in order;
activity text never in a bubble; no tool names in learner mode; rejects render
as red verification rows; Approve disabled after tap; reload reconstructs the
same blocks from events.

---

## 19. Failure tests

Duplicate create · double confirmation · double submit · double transition
(two tabs) · duplicate socket message · two agent steps for one instance ·
socket disconnect mid-turn · refresh · logout/login · insufficient coins
mid-step · LLM timeout · LLM malformed action · tool timeout (bounded retry
per policy) · database conflict · context build failure (state unchanged) ·
abandoned teaching with Study Prep parent · cancelled workflow with pending
child · outcome delivered twice (second is a no-op) · resume of a terminal
workflow (rejected, no new workflow) · handoff retry (returns the existing child).

LLM failure must never corrupt workflow state.

---

## 20. Open questions / verify before building

| # | Item | Owner/phase |
|---|---|---|
| Q1 | JSS1 Basic Science rows in `edu.syllabus_*` and `concept_catalog` ❓ — no longer a blocker (D30 generates an outline when missing), but real rows give better plans | Phase 0 |
| Q15 | ~~School/class/term lookup~~ — **resolved (§8.7):** linked `mgmt.students.user_id` → class; term from `mgmt.academic_calendar`; profile/conversation for class level; names only for school-confirmed link suggestions. | Done |
| Q2 | Real per-generation coin cost in `lib/aiPricing.js` (examples use 2) ❓ | Phase 0 |
| Q3 | Default stays `gpt-4o-mini` (D23). Open: which assessor/evidence model env locks to, and whether controller prompts need per-model tuning (run the same scenarios on each selectable model). | Phase 6 spike |
| Q4 | Teaching worst-case turn cost and the balance check threshold | Phase 6 |
| Q5 | Starting cap values in §7.2 table (Teaching turns, strategy changes, Practice caps) | Tune in staging |
| Q6 | ~~`retrieval_practice`~~ — **resolved (D25):** Strategy Library v2, Decay Review + Practice only. | Done |
| Q7 | ~~"Learning with guide" toggle~~ — **resolved (D24):** built as the `learn_with_guide` Teaching mode. | Done |
| Q16 | ~~Decay `retrieval_practice` human vs agent~~ — **resolved (D32):** keep human recall for now. | Done |
| Q17 | ~~Peer help consent default~~ — **resolved (D34):** off by default; a clear toggle in Settings → Agent. | Done |
| Q18 | ~~Pattern population~~ — **resolved (D36):** all learners, anonymously, totals only, ≥ 5. | Done |
| Q19 | Should schools/instructors ever see a learner's struggles (e.g. non-sensitive ones in the class dashboard)? Plan default: no. | Before school dashboards use it |
| Q20 | Approve Strategy Library v3 (the new strategies listed in §7.15.3)? | Before Phase 8 |
| Q14 | ~~Practice UI~~ — **resolved (D29):** Practice is the live proctored assessment in `AssessmentRoom`, which keeps its UI. | Done |
| Q13 | ~~DeepSeek / Grok data handling~~ — **resolved:** accepted by the product owner (2026-10-09); both enabled per §7.11.5a. | Done |
| Q12 | ~~Per-tier model lists~~ — **resolved (§7.11.5a).** Grok and DeepSeek model ids and prices are filled into `AI_MODELS` at setup (a setup task, not an open question). Fable stays off until a tier is given it. | Done |
| Q8 | `content.search` — enable for Study Prep research or keep disabled? | Phase 4 |
| Q9 | Who can see developer mode (staff role only)? | Phase 11 |
| Q10 | Notification channels for handoff/completion (in-app only, or web push via existing `notifications/webpush.js`)? | Phase 7 |
| Q11 | ~~Standalone Practice UI~~ — **resolved (D29):** `AssessmentRoom`. | Done |

---

## 21. Source map

| Topic | Primary source | Supporting |
|---|---|---|
| Four workflows, states, operations, event stream, UI | v3 Master Plan | Learning Workflows chat simulation |
| Rules, ownership, idempotency, failure handling, phases, flags | AKORO ADAPTIVE LEARNING & AGENT WORKFLOW | Final structure |
| Teaching as first-class workflow + handoff | Full structure 4, 5 | v3 §13–15, §28–30 |
| Adaptive Learning *Engine* (not workflow) | Full structure 3 | v3 §19–20 |
| Promote study-prep infrastructure; migration map | Full structure 2 | — |
| Code baseline, harness checks, policy constants, manifest, five-part operation rule | Study-Prep Master Plan v7 | Plans 1–5, concrete sessions v1/v2 |
| Agent-driven teaching turn, controller agent, loop end/cap/fallback, learner model switching, learn_with_guide mode, retrieval_practice | User decisions (this review) | Claude API reference (model ids, prices, tool_choice/thinking/refusal behaviour, 2026-10-06) |
| Code facts | `akoro-api` / `akoro-learner` as of 2026-10-09 | — |
