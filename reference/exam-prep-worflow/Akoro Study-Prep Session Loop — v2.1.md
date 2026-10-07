# Akoro Study-Prep Session Loop — v2.1

Supersedes v2. The fundamental architecture changes in this version.

v2 implemented a deterministic controller that explained its own decisions
through `deliberate()`. That produced the *appearance* of agent thinking but
the decisions were all pre-made by code. v3 replaces that with a real agent
loop: the LLM decides what it needs next, tools return observations, and the
harness enforces every constraint. `deliberate()` is retired. The six thought
types become activity-log labels, not a forced sequence.

Inherited constraints from `ARCHITECTURE_AUDIT-2026-09-07.md` and
`ENGINEERING_GUARANTEES.md`, now applied to the new model:

- LLM output is observation, not ground truth. Scoring, thresholds, and state
  transitions are never delegated to the model.
- State transitions are deterministic and single-writer.
- Autonomy stays bounded to a session the learner started.
- The LLM proposes. The harness decides. The database confirms.

---

## 0. The core shift from v2

| v2 | v3 |
|---|---|
| Controller pre-decides → `deliberate()` explains it | LLM reasons → proposes a tool/action → harness validates → executes → LLM observes result |
| Six thought types are a fixed sequence | Six thought types are labels on whatever activity just happened |
| `deliberate()` is the agent's cognition | The agent loop is the cognition; `deliberate()` is removed |
| Controller owns all decisions | LLM owns reasoning; harness owns enforcement; education engine owns evaluation |

**What does not change:**

- The data model (§7) — tables, columns, the `sequence` log survive intact
- The state machines (§2) — session and topic states unchanged
- All safety rules — single-writer transitions, wallet gating, no LLM touching scores
- Build order items 1–3 (service extraction, race fix, syllabus resolver)
- The UI confirm gate — learner still approves the plan before any spend

---

## 1. Three components, one loop

```
┌─────────────────────────────────────────────────────┐
│               AKORO STUDY AGENT (LLM)               │
│                                                     │
│  Receives: goal, session state, tool results        │
│  Decides:  what information it needs next           │
│            which tool to call                       │
│            what action to propose                   │
└───────────────────────┬─────────────────────────────┘
                        │ tool call / action proposal
                        ▼
┌─────────────────────────────────────────────────────┐
│                  AGENT HARNESS (code)               │
│                                                     │
│  Is the caller authenticated?                       │
│  Is this tool permitted in the current state?       │
│  Does the learner own this session?                 │
│  Is the wallet sufficient?                          │
│  Is the attempt limit respected?                    │
│  Is the state transition legal?                     │
│  Is this concurrent with another write?             │
│                                                     │
│  → APPROVE and execute   OR   REJECT with reason    │
└───────────────┬─────────────────────────────────────┘
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
 Syllabus    Learner     Practice
  tools       tools        tools
    └───────────┼───────────┘
                ▼
           OBSERVATION
                │
                ▼
┌─────────────────────────────────────────────────────┐
│           DETERMINISTIC EDUCATION ENGINE (code)     │
│                                                     │
│  scoring       threshold checks    mastery writes   │
│  state guards  evidence appends    decay curves     │
└─────────────────────────────────────────────────────┘
                │
                ▼
        → back to LLM as next observation
```

**The loop:**

```
Goal → Reason → Tool call → Harness → Execute → Observation
  ↑                                                    │
  └──────────────── Reason ◄──────────────────────────┘
```

The agent is not told to do `research → draft → verification → action`. It is
told the goal and given tools. What it does next depends on what it just
observed. That is what makes it an agent rather than a workflow.

---

## 2. State models (unchanged from v2)

### 2.1 Session state (`study_prep_sessions.status`)

```
planning ──► awaiting_confirmation ──► topic_active ◄──► replanning
                    │                     │
                    ▼                   paused
                cancelled                 │
                                  completed | abandoned
```

### 2.2 Topic state (`study_prep_topics.status`)

`queued → active → understood | flagged_gap | capped_out | deferred`

### 2.3 Who writes what

| State | Written by | Never written by |
|---|---|---|
| Session row | Harness (on tool result) | LLM directly |
| Topic row | Harness (on tool result) | LLM directly |
| Score | Education engine (server key) | LLM |
| Mastery evidence | Education engine | LLM |
| Wallet balance | Harness (on charge) | LLM |

---

## 3. Tool catalogue

The LLM sees these tools in its system prompt. Each call goes through the
harness before executing. Tools the LLM cannot call at all are marked *harness-only*.

### Read tools (no spend, no state change)

| Tool | What it returns |
|---|---|
| `syllabus.resolve(subject, class_level, scope)` | Ordered list of topic objects |
| `learner.get_state(topic_ids[])` | Mastery scores (0–1) per topic |
| `learner.get_history(topic_id)` | Past attempts, confusion notes |
| `concept.get_prerequisites(topic_ids[])` | Prerequisite edges between topics |
| `content.search(topic_id, query)` | Approved syllabus passages, no open web |
| `session.get_state(session_id)` | Current session + topic rows |

### Planning tools

| Tool | What it does |
|---|---|
| `plan.propose(topic_ids[])` | Submits an ordered plan; harness validates prerequisites, cost, wallet, cap |
| `plan.validate(topic_ids[])` | Dry-run only — returns what harness would say, no write |

### Learning tools

| Tool | What it does |
|---|---|
| `practice.generate(topic_id, mode, count)` | Generates questions (costs coins); harness checks budget and attempt limit |
| `teachback.offer(topic_id, strategy)` | Surfaces the teach-back modal to the learner; no spend |
| `session.replan(trigger, confusion_notes)` | Re-invokes planning with updated state |

### State tools (LLM proposes; harness executes the write)

| Tool | Harness transition |
|---|---|
| `topic.advance(topic_id)` | `active → understood` |
| `topic.defer(topic_id)` | `active → deferred` |
| `topic.flag(topic_id)` | `active → flagged_gap` |
| `session.complete()` | `topic_active → completed` |

### Harness-only (LLM never calls these directly)

| Operation | Triggered by |
|---|---|
| `practice.score` | Learner submitting answers |
| `wallet.charge` | `practice.generate` approval |
| `session.transition` | Any successful harness-validated state tool |
| `evidence.append` | Education engine on every settled topic |

---

## 4. The agent loop in full — example session

**Prompt:** *"I have a test covering the whole term for Basic Science. Can you help me prepare?"*

### Loop 1 — Understand the goal

The LLM receives the goal and no prior observations.

```
Reason:  I need to know what's in the syllabus before planning anything.
Action:  syllabus.resolve("Basic Science", "JSS1", "whole_term")
```

Harness: authenticated, tool permitted, no spend. Execute.

**Observation 1:**
```json
{ "topics": ["water-cycle","photosynthesis","human-body","matter","energy","force-motion"] }
```

### Loop 2 — Decide what information it needs next

```
Reason:  6 topics found. I shouldn't treat them equally.
         I need mastery levels to know where to focus.
Action:  learner.get_state(["water-cycle","photosynthesis","human-body","matter","energy","force-motion"])
```

**Observation 2:**
```json
{ "water-cycle":0.42, "photosynthesis":0.61, "human-body":0.82,
  "matter":0.71, "energy":0.55, "force-motion":0.76 }
```

### Loop 3 — Research more before committing to an order

```
Reason:  Mastery alone doesn't determine order — prerequisites do.
         Sorting by confidence without knowing dependencies could start
         the learner on Photosynthesis before they've reviewed Water Cycle.
Action:  concept.get_prerequisites(["water-cycle","photosynthesis","matter","energy",...])
```

**Observation 3:**
```
Water Cycle → Photosynthesis
Matter → Energy
Force & Motion: independent
Human Body: independent
```

### Loop 4 — Draft a plan

The LLM now has enough to propose. It does not hard-code a sequence; it
reasons from observations:

```
Reason:  Lowest mastery: Water Cycle (0.42), Energy (0.55), Photosynthesis (0.61).
         Water Cycle must precede Photosynthesis (prerequisite).
         Matter must precede Energy (prerequisite).
         High-mastery topics last: Force & Motion (0.76), Human Body (0.82).
Action:  plan.propose(["water-cycle","photosynthesis","matter","energy","force-motion","human-body"])
```

Harness validates:
- Prerequisites satisfied? ✓
- All topics from approved syllabus? ✓
- Count ≤ 12? ✓ (6)
- Estimated cost 18 coins, wallet 25? ✓

**Observation 4:**
```json
{ "status":"valid", "estimated_cost":18, "wallet":25 }
```

### Human gate — learner confirms

Plan card shown. Learner taps "Approve & Start."
Harness writes: `awaiting_confirmation → topic_active`. No LLM involvement.

### Loop 5 — Start the first topic

```
Reason:  Session confirmed. Active topic: Water Cycle. Mastery 42%.
         I should run a diagnostic before assuming anything.
Action:  practice.generate("water-cycle", "diagnostic", 5)
```

Harness: budget check (18 coins available), attempt count 0 < 3, topic active. Execute. Charges coins.

Learner answers. Server scores against answer key: **3/5 = 60%**.

**Observation 5:**
```json
{ "score":3, "total":5, "pct":60, "threshold":70, "attempts_used":1, "attempts_remaining":2 }
```

### Loop 6 — Reflect on the result

```
Reason:  60% is below the 70% threshold. Two attempts remain.
         Immediately retesting with the same questions would likely
         produce the same result. A learning intervention first.
         Available strategies: teach_back, different_analogy, interleave, space_out.
         First miss → teach_back is the policy default.
Action:  teachback.offer("water-cycle", "teach_back")
```

Harness: score below threshold? ✓ Attempts remain? ✓ Teach-back policy allows? ✓ Approved.
Learner sees the teach-back modal. Completes it. Confirms ready.

**Observation 6:**
```json
{ "teachback_completed":true, "learner_confirmed_ready":true }
```

### Loop 7 — Retest

```
Reason:  Learner confirmed readiness. Generate a fresh retest,
         different questions from the diagnostic.
Action:  practice.generate("water-cycle", "retest", 5, fresh:true)
```

Learner answers: **5/5 = 100%**.

**Observation 7:**
```json
{ "score":5, "total":5, "pct":100, "threshold":70, "attempts_used":2, "status":"passed" }
```

### Loop 8 — Advance

```
Reason:  Water Cycle passed. Next planned topic: Photosynthesis.
Action:  topic.advance("water-cycle")
```

Harness writes: `active → understood`. Education engine appends evidence.
Next topic becomes active. Loop continues for Photosynthesis, Matter, Energy…

### Cap-out — Human Body Systems (scripted outcome)

After two failed attempts the LLM observes:

```json
{ "attempts_used":2, "attempts_remaining":0, "last_score":3, "status":"cap_reached" }
```

```
Reason:  Attempts exhausted on Human Body Systems. I cannot retry immediately.
         Available actions: defer_topic (if budget and remaining topics exist),
         flag_for_instructor (if one is assigned), flag_gap.
         Checking session state first.
Action:  session.get_state(session_id)
```

Observation: 3 topics remaining, budget sufficient, no instructor assigned.

```
Reason:  Deferring is possible. One deferred retry allowed per session.
         Finishing lighter topics first may help retention.
Action:  topic.defer("human-body")
```

Harness: attempt cap reached? ✓ Deferred retry not yet used? ✓ Budget sufficient? ✓
Writes: `active → deferred`. Remaining topics continue.

After remaining topics pass, agent observes deferred slot, retries, passes.

### Session complete

```
Reason:  All 6 topics resolved. Session can be closed.
Action:  session.complete()
```

Harness writes: `topic_active → completed`. Education engine finalises evidence.

Agent produces a summary from observable facts only:
- Topics understood: 6/6
- Topics that needed teach-back: Water Cycle, Photosynthesis
- Topics that needed deferral: Human Body Systems
- Coins spent: 14 of 18 estimated
- All results from generated practice — not past papers

---

## 5. What the six thought types now mean

They are **activity-log labels**, not a sequence. The agent may call `research`
twice in a row, skip `draft`, then call `reflection`. That is correct behaviour.

| Label | Applied to | Example |
|---|---|---|
| `research` | A read tool call | `learner.get_state`, `concept.get_prerequisites` |
| `draft` | A planning action | `plan.propose`, `session.replan` |
| `verification` | A constraint check or `plan.validate` call | Harness returning valid/invalid |
| `action` | A write or generation tool | `practice.generate`, `teachback.offer`, `topic.advance` |
| `reflection` | An observation after a scored result | Score 3/5, threshold 70%, attempts left 2 |
| `synthesis` | A summary action at session end | `session.complete` + summary message |

The agent does not decide the label. The harness stamps it on the event row
based on the tool called.

---

## 6. Learner repo (Plan's read context, unchanged)

What the agent reads before planning:

| Input | Source | Note |
|---|---|---|
| Topic list | `edu.syllabus_topics` | Blocker: ingest JSS1 Basic Science first |
| Mastery | `learner_concept_state` (0–1) | Fall back to `knowledge_confidence` ÷ 100 |
| Confusion notes | `learner_exam_prep_attempts` missed objectives | Bounded |
| Prerequisites | `concept_edges` (approved) | |
| Past sessions | `study_prep_sessions` | Avoid re-planning identically after a cap-out |

Internal retrieval only (`search_approved_content` → `match_syllabus` RPC).
Never the open web.

---

## 7. Data model (additive, updated from v2)

```sql
study_prep_sessions         -- unchanged from v2
study_prep_topics           -- unchanged from v2

study_prep_events           -- append-only; updated column meanings
  id uuid pk,
  session_id uuid,
  topic_id uuid null,
  sequence int,             -- UNIQUE (session_id, sequence)
  event_type text CHECK (tool_call | tool_result | agent_action | harness_reject),
  thought_type text CHECK (research | draft | verification | action | reflection | synthesis),
  tool text null,           -- which tool was called (for tool_call events)
  decision_node text null,  -- deprecated from v2; kept for backwards compat, null in v3
  duration_ms int,
  payload jsonb,            -- observable facts only; no LLM chain-of-thought
  created_at
```

**Example event sequence for Loop 2 (learner state):**

```json
[
  {
    "sequence": 2,
    "event_type": "tool_call",
    "thought_type": "research",
    "tool": "learner.get_state",
    "payload": { "topics": ["water-cycle","photosynthesis","..."] }
  },
  {
    "sequence": 3,
    "event_type": "tool_result",
    "thought_type": "reflection",
    "tool": "learner.get_state",
    "payload": {
      "water-cycle": 0.42, "photosynthesis": 0.61,
      "human-body": 0.82, "matter": 0.71
    }
  }
]
```

**Example for a harness rejection:**

```json
{
  "event_type": "harness_reject",
  "thought_type": "verification",
  "tool": "practice.generate",
  "payload": { "reason": "insufficient_balance", "wallet": 0, "cost": 3 }
}
```

The LLM observes the rejection and reasons from it: "I can't generate. I'll
pause the session." The harness then writes `paused`.

---

## 8. Changes to existing code (updated from v2)

### 8.1 Extract the exam-prep service (unchanged)

`startRun`, `submitAttempt`, `startRetest`, `generateAttempt` out of the
router into `exam-prep-service.js`. Routes become thin wrappers.

### 8.2 Fix the submit race (unchanged — do this first)

```js
.update({ status: next, last_score: score })
.eq("id", run.id).eq("learner_id", uid).eq("status", run.status)
.select("id").maybeSingle();
if (!won) return alreadyRecorded();
```

### 8.3 Workflow list grouping (unchanged)

One entry per session in the list; topics nested.

### 8.4 Replace the controller with an agent loop

The deterministic controller from v2 is replaced by:

1. **System prompt** — goal, constraints, tool list, policy limits (attempt cap,
   wallet rule, no open web, no inventing syllabus content).
2. **Tool dispatcher** — routes each tool call through the harness, executes,
   returns an observation object.
3. **Harness** — all the guard logic from v2's controller, now as a pure
   validation layer called per tool, not per session step.
4. **Event logger** — stamps `thought_type` on every tool call and result,
   appends to `study_prep_events`.

The agent loop itself is the existing `agent_loop.js` pattern extended with the
new study-prep tool set. The Python agent's `tool_calling.py` shows the
right structure.

### 8.5 Harness-only operations

`practice.score`, `wallet.charge`, `session.transition` are never exposed in the
tool list. They are called internally by the harness after approving a permitted
tool call. The LLM cannot invoke them even if it tries.

### 8.6 Teach-back gate (unchanged)

`teachback.offer` surfaces the modal. Learner presses "I've taught it back."
That sets `learnerConfirmedReady:true` as the next observation. The LLM then
chooses to retest. No inference about whether the teach-back worked.

### 8.7 Outcome write-back (unchanged)

Evidence appended by the education engine on every settled topic.
`learner_concept_state` updated via the deterministic mastery policy.

---

## 9. Cost, billing, concurrency, autonomy (unchanged)

- Cost shown in plan card before confirm. Student wallet charged first.
- 402 → `paused`. No partial state. Resumable.
- Session and topic transitions: single conditional update per write.
- Practice generation fan-out: bounded (3–4 concurrent) within the confirmed
  cost estimate.
- No autonomous sessions, no background daemons, no notifications outside an
  active session.

---

## 10. Decisions (updated)

| # | Decision | Recommendation |
|---|---|---|
| 1 | Deferred retry: resets attempts? | Yes — one retry, new run, attempts reset. Cap at one per session. |
| 2 | Cram mode | `max_attempts = 1` passed to `practice.generate`. Harness enforces. |
| 3 | Plan visibility | Plan card mandatory before spend. Learner may drop topics before confirm. |
| 4 | Wallet empty mid-session | `paused`, resumable. Harness writes it on 402 from `practice.generate`. |
| 5 | Mastery write target | `learner_concept_state` via evidence (flag on). Legacy `knowledge_confidence` otherwise. |
| 6 | Session length cap | 12 topics max. Harness rejects `plan.propose` above that. |
| 7 | Sequence column | `UNIQUE (session_id, sequence)`. Indexed, not part of PK. |
| 8 | Label vs. id in payload | Store both. Render from label; fall back to id. |
| 9 | `thought_type` stamping | Harness stamps it, not the LLM. Determined by tool type, not model output. |

---

## 11. Build order (revised)

1. **Extract exam-prep service + fix submit race** (§8.1–8.2). Tests: double-submit, replayed retest.
2. **Session tables + harness** (§2, §7). Unit tests: every transition, concurrent-confirm no-op, harness-reject event.
3. **Syllabus resolver** on DB tables. Ingest JSS1 Basic Science first.
4. **Tool dispatcher + system prompt** — agent loop with read tools and `plan.propose`. Chat tool `start_study_prep_session` calls this.
5. **Plan card + confirm** (REST gate). No generation yet.
6. **Learning tools** — `practice.generate`, `teachback.offer`, state tools.
7. **Education engine write-back** (§8.7) + strategy library.
8. **Course resolver.**
9. **Material resolver**, last.

---

## 12. Acceptance tests

**State machine:**
- Double-submit → one transition, one effect.
- Double-confirm → one `topic_active`, second is no-op.
- 402 mid-topic → `paused`, no lost state, resume works.
- 6-topic session → other workflows still visible in the list.
- No coins spent before confirm.
- Summary contains only recorded facts.

**Harness enforcement:**
- LLM attempts `practice.score` directly → rejected (not in tool list).
- LLM proposes `plan.propose` with prerequisite violation → `harness_reject` event, `thought_type: verification`.
- LLM proposes 13 topics → `harness_reject` (cap exceeded).
- Wallet = 0, LLM calls `practice.generate` → `harness_reject`, `reason: insufficient_balance`, session → `paused`.

**Agent loop:**
- For a scripted session (pass, teach_back, cap_out, defer, retry, complete): assert the emitted `event_type` sequence matches `tool_call → tool_result → ... → agent_action(complete)`.
- After a `harness_reject`, the next event is a different `tool_call` or an `agent_action` — never a retry of the rejected tool with identical arguments.
- `thought_type` on every event is set by the harness, never by a model output field.

---

## 13. Still open

- **Pace profile:** not built. Flat default.
- **Guardian Angel:** teach-back claims not verified against approved content. Audit Phase 2.
- **Past-question coverage:** check row counts per subject before using bank questions.
- **JSS1 Basic Science ingestion:** may not exist in DB. Confirm before build step 3.
- **Agent loop token budget:** a 6-topic session with 3 research loops at the start could use significant context. Set a max-turns guard in the harness (e.g. 40 tool calls per session) and surface it as a `harness_reject` so the LLM can observe and adapt.
