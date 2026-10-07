# Akoro Study-Prep Session Loop — v3 (implemented walkthrough)

One complete exam-prep session, slowed down so we can see exactly what the
agent and the harness are doing at every loop — **as it is actually built
today**, workspace, context layer, context files, context selection per
operation and all.

This supersedes the two v2.1 documents (the hypothetical loop and the
context-layer proposal). Everything in here is traceable to shipped code:
the module map at the end gives the file behind every claim. Where something
is registered but not yet driving a live step, this document says so plainly
(§16) rather than pretending.

The scenario, the coin amounts, the scores and the event sequences below are
a faithful simulation of the real code paths — the same payloads the harness
records, the same copy `deliberate()` emits, the same math the Education
Engine runs.

---

## 1. The architecture as built

```
                    akoro-agent/  (THE WORKSPACE — configurable agent brain)
                    AGENT.md · identity/ · learning/ · reasoning/ · policies/
                    strategies/ · memory/ · channels/ · agents/
                                      │
                                      ▼
                    ┌──────────────────────────────────────┐
                    │  CONTEXT MANAGER                     │
                    │  modules/agent-context/              │
                    │  manifest.mjs + context-manager.js   │
                    │                                      │
                    │  selects the file set PER OPERATION  │
                    │  (planning ≠ research ≠ teaching)    │
                    │  budgets · preflight · version hash  │
                    └──────────────────┬───────────────────┘
                                       │  system prompt for ONE step
                                       ▼
                    ┌──────────────────────────────────────┐
                    │  AGENT LOOP  (study-prep/agent-loop) │
                    │  context → LLM → ONE action + intent │
                    │  → harness validate → execute/reject │
                    │  → event → bounded observation → LLM │
                    │  ≤ 6 iterations, terminal ends step  │
                    └──────────────────┬───────────────────┘
                                       │  tool calls only
                                       ▼
                    ┌──────────────────────────────────────┐
                    │  TOOL REGISTRY (tools/registry.js)   │
                    │  read (free) · propose (validated)   │
                    │  execute (gated: cost / caps)        │
                    │  harness-only ops NOT in catalogue   │
                    └──────────────────┬───────────────────┘
                                       ▼
                    ┌──────────────────────────────────────┐
                    │  HARNESS (study-prep/harness.js)     │
                    │  SOLE WRITER of session/topic state  │
                    │  validates → executes → narrates →   │
                    │  records. Conditional updates only.  │
                    └──────────────┬───────────┬───────────┘
                                   │           │
                        ┌──────────▼──┐  ┌─────▼──────────────┐
                        │ EDUCATION   │  │ Postgres (edu.*)   │
                        │ ENGINE      │  │ study_prep_sessions│
                        │ deterministic│ │ study_prep_topics  │
                        │ scoring,    │  │ study_prep_events  │
                        │ thresholds, │  │ + exam-prep runs, │
                        │ mastery     │  │ evidence, wallet   │
                        └─────────────┘  └────────────────────┘
```

The doctrine from the context-layer conversation, as implemented:

| Layer | Is | Is not |
|---|---|---|
| **Workspace files** (`akoro-agent/*.md`) | stable instructions — *how to think, what to consider, which rules apply* | never authoritative state |
| **Database** (`edu.*`) | dynamic truth — *what this learner knows, what happened, what's active* | never prompt-filler |
| **Tools** (registry) | controlled access to truth — bounded reads, validated proposals | never a model-controlled write path |

The `.md` files cannot move a mastery number, charge a coin, or transition a
session. The database is the referee; the harness is its only writer.

---

## 2. The workspace — the configurable agent brain

The real tree (every file below exists in `akoro-api/akoro-agent/`):

```
akoro-agent/
├── AGENT.md                     ← anchors EVERY context set: who the agent is,
│                                   what it is not, working style
├── identity/
│   └── SOUL.md                  ← Akoro's voice (opens chat + student personas)
├── learning/
│   ├── LEARNING.md              ← the 8 learning principles (inspect before
│   │                               teaching, mastery never from LLM judgement…)
│   ├── TEACHING.md              ← one topic/one idea, diagnostic first, offer
│   │                               ONE strategy not a lecture, keep it short
│   ├── ASSESSMENT.md            ← generated-not-past-paper, server scores,
│   │                               caps are information not failure
│   └── MASTERY.md               ← mastery is 0–1 moved only by the engine;
│                                   no evidence = unknown, never "weak"
├── reasoning/
│   ├── REASONING.md             ← the consider-list before every decision
│   ├── RESEARCH.md              ← research policy: syllabus → state → history
│   │                               → prerequisites → (content.search); never
│   │                               open web; don't loop — "after the syllabus,
│   │                               the state and the prerequisites, you have
│   │                               enough to draft"
│   ├── INSPECTION.md            ← chain observations into discoveries; "if an
│   │                               observation changes nothing about your next
│   │                               action, you did not need it"
│   └── PLANNING.md              ← a plan is an ordered syllabus-topic list;
│                                   hard constraints vs soft ordering
├── policies/
│   ├── EDUCATION_RULES.md       ← one active topic, caps, threshold, retest
│   │                               gate, one deferred retry, ≤ 12 topics
│   ├── TOOL_RULES.md            ← read tools deliberate not exhaustive;
│   │                               rejections are information; never promise
│   │                               an uncharged generation
│   ├── SAFETY.md                ← never expose keys/transcripts; never claim
│   │                               access you don't have; distress → human
│   ├── AGENT_CHAT.md, TOOL_OBSERVATIONS.md, HITL_DRAFTS.md  ← chat-surface
│   │                               policies (verbatim sets below)
├── strategies/
│   └── STRATEGIES.md            ← the curated five, when each fits
├── memory/
│   ├── MEMORY.md                ← curated agent wisdom (composes into chat)
│   └── DURABLE_MEMORY.md
├── channels/                    ← per-surface doctrine (verbatim mode)
│   ├── CHAT.md · CHAT_STUDENT.md · CHAT_INSTRUCTOR.md
│   ├── STUDY_PREP.md            ← the study-prep channel rules (§6)
│   ├── MODE_THINK.md · MODE_RESEARCH.md · SPEECH.md
└── agents/                      ← persona files (NaNa, Sargeant, student
                                    clone/protégé, trained shells) — P2b
```

Adding a new principle six months from now (say, "consider the learner's
preferred learning style") means dropping a file into this tree and listing
it in a manifest set — not rewriting the controller.

---

## 3. Context selection — the Context Manager

`modules/agent-context/manifest.mjs` is the registry of selection sets. This
is the "harness supports context selection for particular operations" idea,
implemented as data with contract tests and a boot gate:

### The study-prep loop sets (joined mode — assembled by the manager)

| Set | Files loaded | Consumer |
|---|---|---|
| `planning` | `AGENT.md`, `learning/LEARNING.md`, `reasoning/PLANNING.md`, `policies/EDUCATION_RULES.md` | agent-loop — planning step |
| `research` | `AGENT.md`, `reasoning/RESEARCH.md`, `reasoning/INSPECTION.md`, `policies/EDUCATION_RULES.md` | agent-loop — research step |
| `teaching` | `AGENT.md`, `learning/LEARNING.md`, `learning/TEACHING.md`, `learning/MASTERY.md` | agent-loop — teaching step |
| `reflection` | `AGENT.md`, `learning/ASSESSMENT.md`, `learning/MASTERY.md`, `reasoning/REASONING.md` | agent-loop — reflection step |
| `strategies` | `AGENT.md`, `strategies/STRATEGIES.md`, `policies/TOOL_RULES.md` | strategy selection |
| `safety` | `AGENT.md`, `policies/SAFETY.md` | safety-critical steps |

A planning step never carries the research files. A teaching step never
carries the planning files. That is the S3 trap (everything-in-the-prompt)
closed by construction.

### The verbatim sets (byte-identical prompt assembly)

Chat, voice and the persona agents don't get joined text — they load whole
files verbatim so their prompts stay byte-identical to the pre-migration
literals (golden-tested): `chat_student` (SOUL + CHAT + CHAT_STUDENT +
**STUDY_PREP** + MODE_THINK + MODE_RESEARCH + AGENT_CHAT + TOOL_OBSERVATIONS
+ MEMORY + DURABLE_MEMORY), `chat_instructor`, `voice_session`,
`persona_nana`, `persona_sargeant`, `persona_student`,
`persona_student_agent` (the learner's protégé), `persona_trained`.

### The guarantees

- **Budgets** — each file ≤ 8,192 bytes, each assembled set ≤ 24,576 bytes.
  Oversize throws at load time.
- **Required files** — a file listed in a set that goes missing fails the
  **boot preflight** (app.js) and the API refuses to start: agent behaviour
  can never silently change because a workspace file was deleted.
- **`contextVersion()`** — a 12-hex hash over every manifest file, logged at
  boot. Doctrine changes are observable, not invisible.
- **`PENDING_ADOPTION`** — workspace orphans must be empty (currently is);
  every file is claimed by a set.

### What is wired today, honestly

`wiring.js` runs **one LLM-driven step: the planning step** (set
`planning`). The `research` / `teaching` / `reflection` / `strategies` /
`safety` sets are registered, preflighted and loadable — the same three-line
wiring that drives planning will drive them — but today the in-topic
operations are learner-driven from the session card (§10–13), narrated by
the harness. See §16.

---

## 4. The cast

| Module | Role |
|---|---|
| `study-prep/agent-loop.js` | the loop: context → LLM → one action → harness → observation → LLM, ≤ 6 iterations |
| `study-prep/llm-agent.js` | production LLM adapter (`OPENAI_MODEL`, default `gpt-4o-mini`); ONE structured tool call + one-sentence intent per iteration |
| `study-prep/harness.js` | the sole writer: validate → execute → narrate → record; conditional updates |
| `study-prep/state-machine.js` | session/topic transitions + `POLICY` constants (the model can never change these) |
| `study-prep/education-engine.js` | deterministic scoring, thresholds, mastery write-back, cost estimate, strategy library |
| `study-prep/tools/registry.js` (at `adaptive-learning/tools/`) | the union catalogue: read / propose / execute levels |
| `study-prep/read-tools.js` | the agent's controlled access to dynamic truth (bounded, no keys, no transcripts) |
| `study-prep/store.js` | Postgres persistence; atomic event-sequence allocation; charge/refund |
| `study-prep/events.js` | append-only event shaping; `agent_intent` is the ONLY LLM string that may land in an event |
| `study-prep/narration.js` | `deliberate()` — the harness's narration over a closed decision-node enum |
| `study-prep/wiring.js` | production composition behind `AKORO_STUDY_PREP_ENABLED` |
| `study-prep/routes.js` | the REST surface (one envelope, stable codes) |
| `study-prep/syllabus-resolver.js` | approved syllabus rows → plan-able topics (slug ids) |
| `study-prep/chat-tool-handlers.js` | `get_study_prep_session` — plan-only chat reads |
| `agent-context/*` | the platform Context Manager + manifest (§3) |
| `exam-prep-service.js` | the topic workflow the harness drives: run generation, submission, retest, policy table |
| `adaptive-learning/chat.js` | the chat surface: `start_study_prep_session` / `get_study_prep_session` tools |

**Policy constants** (state-machine.js, frozen): max 12 topics · 3 attempts
default · 70% pass threshold · **6 iterations per step** · **40 tool calls
per session** · 1 deferred retry · intent ≤ 240 chars · the curated-five
strategies.

**The tool catalogue the model sees** — 16 tools in three levels:

- **read** (free, bounded): `syllabus.resolve`, `learner.get_state`,
  `learner.get_history`, `learner.get_relevant_memory`,
  `concept.get_prerequisites`, `session.get_state`, `plan.validate`
  (`content.search` is listed but gated off until enabled)
- **propose** (harness validates): `propose_plan`, `offer_strategy`,
  `advance_topic`, `defer_topic`, `topic.flag`, `session.replan`,
  `conclude_session`
- **execute** (hard gates: cost/caps): `practice.generate`,
  `practice.submit`

`practice.score`, `wallet.charge`, `session.transition`,
`evidence.append` are **harness-only** — deliberately absent from the
catalogue. The agent cannot even name them.

---

## 5. The scenario

> **Learner:** Tola, SS2 (Lagos).
> **Subject:** Physics, WASSCE.
> **Wallet:** 46 coins.
> **Message:** "I have WASSCE Physics in three weeks. Can you help me
> prepare?"

What exists before anything happens:

- **An approved syllabus**, ingested from `data/syllabus/wassce-physics.sample.json`
  via `node scripts/ingest-syllabus.mjs` → four topics:
  `measurement-and-units`, `motion`, `waves`, `electromagnetism`.
- **Recorded evidence** from Tola's earlier learning: Measurement ~0.71,
  Motion ~0.42 with the recorded misconception *"confuses velocity and
  acceleration"*, and one prior exam-prep run on Motion (2/5,
  `teach_back_required`). Waves and Electromagnetism: no evidence — which
  MASTERY.md says means *unknown*, not weak.
- **An approved prerequisite edge**: Measurement and Units
  `prerequisite_for` Motion.
- **Boot preflight passed**, and the log carries the context version:
  `[context-layer] ok v9f4c1e2ab7d0 — 14 sets, manifest v1`.

---

## 6. Step 0 — the learner's message (the chat surface)

Tola types the message into the **agent chat**. That surface runs on its own
context selection — the `chat_student` **verbatim** set. The chat agent's
system prompt is assembled from `SOUL.md`, `CHAT.md`, `CHAT_STUDENT.md`,
**`STUDY_PREP.md`**, `MODE_THINK.md`, `MODE_RESEARCH.md`, `AGENT_CHAT.md`,
`TOOL_OBSERVATIONS.md`, `MEMORY.md`, `DURABLE_MEMORY.md` — byte-identical to
the pre-migration literal, pinned by the golden tests.

The doctrine that matters here — `channels/STUDY_PREP.md`:

> Preparing for an upcoming test or exam is a study-prep session, never a
> questionnaire in chat. … call `start_study_prep_session` with their goal
> and subject. **Do not ask which topics, what format, how long the test
> should be or how many questions it needs** — the session resolves the
> approved syllabus, reads their recorded knowledge, and proposes an ordered
> plan with a coin estimate. … Nothing is charged until they approve the
> card — say so plainly when cost comes up. … never fall back to
> interviewing them for topics, format, duration or question count, and
> never invent a plan or session history yourself.

So the chat agent does NOT interview Tola. It calls one tool:

```json
{
  "tool": "start_study_prep_session",
  "arguments": {
    "goal": "I have WASSCE Physics in three weeks. Can you help me prepare?",
    "subject": "Physics",
    "classLevel": "SS2",
    "examBoard": "WAEC"
  }
}
```

The chat handler (`chat.js`) is **idempotent by design**: it first looks for
an existing unconfirmed session (`planning` or `awaiting_confirmation`). If
Tola already has a plan card waiting, the tool returns that card with the
note *"present its plan card; nothing is charged until the learner approves
it"* — repeated asks never stack sessions. Otherwise it calls
`startStudyPrepSession(...)` in the wiring, which is:

1. `harness.createSession(...)` — then
2. one planning agent step (§8).

---

## 7. Step 1 — the harness creates the session

`createSession` checks exactly one thing: **no other active session** for
Tola (a partial unique index in Postgres enforces it too). It inserts:

```
edu.study_prep_sessions
  goal: "I have WASSCE Physics in three weeks. Can you help me prepare?"
  subject: "Physics"  class_level: "SS2"  exam_board: "WAEC"
  status: "planning"  policy_version: "study-prep-v1"
```

and appends the first event row:

```
seq 0 · observation · origin: harness
     facts: { goal, subject: "Physics", classLevel: "SS2", entryMode: "syllabus" }
```

At this point: no research, no practice, **no coins spent, no state the
learner cares about changed**. The session exists to be planned.

---

## 8. Step 2 — the planning loop, iteration by iteration

This is the heart. `runStudyPrepPlanningStep` (wiring.js) runs only while
the session is `planning` or `replanning`.

### 8.0 Context selection for THIS operation

```js
const context = await buildAgentContext({
  setName: "planning",            // ← the operation picks the file set
  goal: view.session.goal,
  session: view.session,          // status, subject, pausedReason
  dynamic: { hint: "Inspect the syllabus and the learner's state, then propose one plan." },
});
```

The manager loads exactly four files — `AGENT.md`, `learning/LEARNING.md`,
`reasoning/PLANNING.md`, `policies/EDUCATION_RULES.md` — joins them
S3-style (`# <file>` header, `---` separators), appends the dynamic truth,
and returns:

```
# AGENT.md
You are the Study Agent inside Akoro…
- You are not the scorer. The Education Engine scores every attempt
  deterministically. You never judge whether an answer is correct.
- You are not the spender. Only the learner approves spending, and only
  the harness charges coins.
- You are not the policy maker. … If your proposal breaks one, the harness
  rejects it with a reason code — observe it, adapt, and propose something valid.

---

# learning/LEARNING.md
1. Consider what the learner already knows before introducing a concept.
…
7. Prefer retrieval and teach-back over simply explaining the answer.
8. Do not declare mastery based solely on your own judgement…

---

# reasoning/PLANNING.md
A study plan is an ordered list of syllabus topics. Nothing more.
Hard constraints (the harness enforces these — do not fight them): …
Soft ordering is your judgement: start where the evidence is weakest…

---

# policies/EDUCATION_RULES.md
- One topic is active at a time. …
- A retest requires the learner's own teach-back confirmation. …

# CURRENT CONTEXT
GOAL: I have WASSCE Physics in three weeks. Can you help me prepare?
SESSION: Physics (SS2), status planning
HINT: Inspect the syllabus and the learner's state, then propose one plan.
```

Note what is **not** in there: the research policy, the teaching doctrine,
the strategy library, the safety file, NaNa's persona, the chat rules. A
planning step carries planning files. The whole prompt sits far under the
24,576-byte assembled-set budget.

The agent gets the 16-tool catalogue as OpenAI function tools — each with an
`intent` parameter (one short sentence, why) and an `args` object.
`tool_choice: "required"` — the model must pick a tool; it cannot chat at
the loop.

### 8.1 Iteration 1 — "what topics exist?"

The LLM's literal view for this call:

```
SYSTEM  ← the assembled planning context above
USER    Goal: I have WASSCE Physics in three weeks. Can you help me prepare?

        Iteration: 1.

        No observations yet — start by inspecting what you need.

        Choose exactly one tool for this iteration.
```

The model returns one tool call:

```json
{ "tool": "syllabus.resolve",
  "intent": "I need the approved WASSCE Physics topic list before I can plan.",
  "args": { "subject": "Physics", "classLevel": "SS2", "exam": "WAEC" } }
```

The loop records it **before** executing (intent is shaped: collapsed,
profanity-masked, ≤ 240 chars):

```
seq 1 · agent_tool_call · origin: agent_stated_intent · iteration 1
      tool: syllabus.resolve
      agent_intent: "I need the approved WASSCE Physics topic list before I can plan."
      thought_type: research          ← stamped by the HARNESS, not the model
      facts: { args: { subject: "Physics", classLevel: "SS2", exam: "WAEC" } }
```

`registry.execute("syllabus.resolve", …)` routes to
`readTools.resolveSyllabus` → the resolver reads real `edu.syllabus_*` rows
(class-scoped, exam-scoped, graceful fallbacks) and the loop appends the
bounded observation:

```
seq 2 · observation · origin: harness
      facts: { ok: true, result: {
        subject: "Physics", classLevel: "SS2",
        topics: [
          { id: "measurement-and-units", label: "Measurement and Units" },
          { id: "motion",                label: "Motion" },
          { id: "waves",                 label: "Waves" },
          { id: "electromagnetism",      label: "Electromagnetism" } ] } }
```

Four topics exist. The plan may only contain these ids — nothing invented.

### 8.2 Iteration 2 — "what does Tola already know?"

Observations ride back into the next call (≤ 6,000 chars, JSON-lined). The
model picks `learner.get_state`:

```
seq 3 · agent_tool_call · learner.get_state · thought_type: research
      agent_intent: "I need Tola's recorded mastery before ordering topics."
seq 4 · observation
      facts: { result: {
        scale: "0-1 mastery estimate from recorded evidence; a missing topic means no evidence yet",
        topics: { "measurement-and-units": 0.71, "motion": 0.42 },
        misconceptions: [ "confuses velocity and acceleration" ] } }
```

(Waves and Electromagnetism are absent — MASTERY.md: unknown, not zero.
The misconception is exactly the kind of observation INSPECTION.md says
should change the next action.)

### 8.3 Iteration 3 — "what happened before?"

`learner.get_history` — the prior exam-prep run:

```
seq 5 · agent_tool_call · learner.get_history · thought_type: research
seq 6 · observation
      facts: { result: { runs: [
        { topic: "Motion", status: "teach_back_required", score: 0.4,
          attempts: "1 of 3", at: "…" } ] } }
```

Motion was attempted before and fell short. That is *evidence*, and
LEARNING.md rule 5 says to use it.

### 8.4 Iteration 4 — "does order matter?"

`concept.get_prerequisites` — the approved edges:

```
seq 7 · agent_tool_call · concept.get_prerequisites · thought_type: research
seq 8 · observation
      facts: { result: { edges: [
        { before: "measurement-and-units", after: "motion",
          beforeLabel: "Measurement and Units", afterLabel: "Motion" } ] } }
```

This changes the plan: the agent would have liked to start with Motion
(weakest evidence), but Measurement and Units must come first. Prerequisite
order is a **hard** constraint (Decision 4); weak-first is the soft one.

### 8.5 Iteration 5 — the terminal action

The model has enough (RESEARCH.md: *"after the syllabus, the learner state
and the prerequisites, you have enough to draft"*). It calls:

```json
{ "tool": "propose_plan",
  "intent": "Prerequisites force Measurement first; Motion is weakest and has prior evidence, so it comes right after.",
  "args": { "topics": ["measurement-and-units", "motion", "waves", "electromagnetism"] } }
```

```
seq 9 · agent_action · origin: agent_stated_intent · action: propose_plan
      thought_type: draft
```

Now the harness takes over — `proposePlan`:

1. **Ownership** — the session belongs to Tola (`session_not_found` otherwise).
2. **State** — status is `planning` ✓ (`invalid_state_transition` otherwise).
3. **Hard validation** (`validatePlan`, pure): every topic in the approved
   syllabus ✓ · no duplicates ✓ · prerequisite order holds
   (measurement at position 1 < motion at position 2) ✓ · 4 ≤ 12 topics ✓.
4. **Cost estimate** (deterministic, plan-card snapshot):
   `4 topics × 2 coins × 2 practices = 16 practice coins`, loop overhead
   `1 (planning) + 4 (one settle step per topic) = 5` → **total 21 coins**.
5. **Conditional update** — `WHERE status = 'planning'` flips the session to
   `awaiting_confirmation` with the plan + estimate. A concurrent writer
   loses silently and cleanly.

```
seq 10 · harness_decision · origin: harness · decision_node: plan_validated
       thought_type: verification
       facts: { topicCount: 4, totalCoins: 21 }
       narrative: "Checked the plan against the syllabus, prerequisite order
                   and your coin balance — everything lines up."
```

`propose_plan` is a **terminal action** — the step ends here:
`{ ended: "terminal", iterations: 5, terminal: "propose_plan" }`.

Five iterations, four cheap reads, one validated proposal, ten event rows.
Nothing has been charged. The chat tool result carries the session id, the
plan and the estimate, and the plan card renders in the conversation.

### 8.6 The other endings (all real, all tested)

- **Loop cap** — 6 iterations without a terminal action → the harness
  pauses the session (`agent_loop_cap`) and the learner sees:
  *"I got stuck — tap to retry or adjust."* Never a silent continuation.
- **Malformed model response** — no tool call parsed → a `malformed`
  `agent_action` event is recorded and the loop moves on. The model never
  gets to freestyle state.
- **Session cap** — 40 tool calls in one session → pause
  (`session_tool_call_cap`).
- **Rejection-driven adaptation** — had the agent proposed
  `[motion, measurement-and-units, …]`, the harness would have rejected with
  `prerequisite_violation` ("Measurement and Units should come before
  Motion"), the observation would ride back into the next iteration, and the
  agent reorders. A rejection code is information — repeat-the-same-call is
  the one behaviour the doctrine forbids.

---

## 9. Step 3 — the human gate: the plan card

The session card (`StudyPrepChatCard`) is the session's human-gate surface —
the model never confirms, advances or generates. Tola sees the ordered plan
and the estimate (21 coins):

- **Adjust** — `POST /sessions/:id/adjust` drops topics and re-estimates
  (`plan_adjusted`, nothing charged). Tola keeps all four.
- **Confirm** — `POST /sessions/:id/confirm`:

```
seq 11 · human_gate · origin: harness · decision_node: plan_confirmed
       thought_type: synthesis
       facts: { topicCount: 4, coinsCharged: 0 }
       narrative: "You approved the plan (4 topics). Nothing was charged until now."
```

The session flips `awaiting_confirmation → topic_active`, and four topic
rows are created, all `queued`:

```
measurement-and-units  queued · attempts 0
motion                 queued · attempts 0
waves                  queued · attempts 0
electromagnetism       queued · attempts 0
```

---

## 10. Topic 1 — Measurement and Units (the clean pass)

Tola presses **Move to the next topic** on the card → `advance_topic`:
the next queued topic activates (seq 12 `topic_started`, *"Starting
Measurement and Units. A short diagnostic comes first — it shows what you
already know."*). Then she presses **Start practice** →
`POST …/topics/:id/practice` with `mode: "diagnostic"`. The learner
initiated it, so `intent` is null — the harness narrates, no agent intent
is invented.

`startTopicPractice`, in order:

1. Ownership + state checks (session `topic_active`, this topic `active`).
2. **Attempt-cap gate** — 0 used < 3 max ✓ (`attempt_cap_exceeded` past cap).
3. **Charge first, never on credit** — 2 coins debited (`study_prep_practice`,
   ref `study_prep:<sessionId>`). If the wallet were short: the session
   pauses `insufficient_balance` (HTTP **402**, resumable — progress kept),
   and nothing else changes.
4. **Generation** — `startExamPrepRun`: 5 exam-style questions are generated
   and a run row lands in `learner_exam_prep_runs` with the policy snapshot
   (threshold 0.70, max 3 attempts). **The answer key never leaves the
   server** — the client gets questions only. If generation failed *after*
   the charge, the harness **refunds** and the session stays intact.
5. Topic row: `attempts_used: 1`, `exam_prep_run_id` set.

```
seq 13 · harness_decision · practice_generated
       facts: { topic: "Measurement and Units", mode: "diagnostic",
                attemptNumber: 1, coins: 2 }
       narrative: "Fresh practice generated for Measurement and Units
                   (attempt 1). 2 coins charged."
```

Tola answers 4/5 and submits → `submitPractice`:

- The **Education Engine** scores deterministically (`scoreAttempt`) — the
  LLM never scores. `score = 0.8`.
- `applyThreshold`: 0.8 ≥ 0.70 → **passed**, attempts remaining 2.
- Outcome routing: `understood` → the topic's conditional update
  `active → understood`.
- **Mastery write-back** (deterministic): no prior topic mastery on record →
  first-attempt evidence → `next = max(0.8, 0.7) = 0.8`, recorded via
  `recordMasteryEvidence` into `learner_concept_evidence` with the summary
  "Study-prep passed: score 80% (mastery → 0.8)" and provenance
  `{ source: "study_prep", mastery }`.

```
seq 14 · engine_result · origin: engine · thought_type: reflection
       facts: { topic: "Measurement and Units", score: 0.8, correct: 4, total: 5,
                percentage: 80, passed: true, attemptsRemaining: 2,
                outcome: "understood" }
       narrative: "Scored 4 of 5 (80%). Above the pass mark — topic understood."
```

The card shows the score and a **Next topic** button.

## 11. Topic 2 — Motion (the near-miss → teach-back → retest)

Tola advances → `advance_topic`: the active topic is settled, the next
queued topic activates:

```
seq 15 · harness_decision · topic_started · facts: { topic: "Motion" }
       narrative: "Starting Motion. A short diagnostic comes first — it shows
                   what you already know."
```

- Diagnostic (2 coins, attempt 1): 2/5 = 0.4 → below 0.70 →
  `retest_offered`. The topic **stays active**; the run flips to
  `teach_back_required`.
- Tola does a **teach-back** — explains velocity vs acceleration in her own
  words (the recorded misconception is exactly what the strategy would
  target). When she's done she presses **I've taught it back** → the human
  gate:

```
seq 18 · human_gate · teach_back_confirmed
       narrative: "You confirmed the teach-back for Motion. A fresh retest is
                   unlocked — same standard, new questions."
```

- **Retest** — `POST …/practice` with `mode: "retest"`: the
  **teach-back gate** checks `learner_confirmed_ready === true` — "no
  exceptions, no inference from chat messages" — then charges 2 coins and
  generates fresh questions (attempt 2).
- 4/5 = 0.8 → passed → Motion `understood`, mastery evidence written
  (first-attempt path on the topic: `max(0.8, 0.7) = 0.8`).

Had the score stayed at 0.6, the cycle repeats — teach-back again, attempt
3 — and if attempt 3 also falls short, `attemptsRemaining` hits 0 and the
outcome is `capped_out`. Which is Topic 3's story.

## 12. Topic 3 — Waves (the cap, and what the agent may offer)

Waves had **no evidence** — unknown, not weak. Diagnostic 3/5 = 0.6 →
teach-back → retest 0.6 → teach-back → attempt 3: 0.55. The engine routes:

```
seq 29 · engine_result
       facts: { topic: "Waves", score: 0.55, percentage: 55, passed: false,
                attemptsRemaining: 0, outcome: "capped_out" }
       narrative: "Scored 3 of 5 (55%). Below the 70% pass mark."
```

The topic transitions `active → capped_out`. A capped-out topic is
"information, not failure" (ASSESSMENT.md). The paths from here, in order
of preference:

1. **A strategy offer** — `offer_strategy` proposes ONE from the curated
   five (`teach_back`, `different_analogy`, `interleave`, `space_out`,
   `escalate_human`); anything else is rejected
   `strategy_not_permitted`. For a repeated near-miss with a fixed wrong
   mental model, `different_analogy` is the doctrine's pick. The
   **learner** chooses whether to use it — the agent offers, never applies.
2. **Flag the gap** — Tola flags it (or the agent proposes `topic.flag`):

```
seq 30 · harness_decision · topic_flagged
       facts: { topic: "Waves", reason: "repeated near-miss on wave properties" }
       narrative: "Waves flagged as a knowledge gap — repeated near-miss on
                   wave properties."
```

   A flagged gap is **recorded for Tola's teacher and for future sessions**
   — naming a gap honestly is a service, not a judgement.
3. **Replan around it** — `session.replan` re-enters planning for the
   remaining topics with everything the session has learned so far.

## 13. Topic 4 — Electromagnetism (defer, and the one retry)

Tola is tired (three topics deep, 12 coins spent). Diagnostic attempt 1:
0.5, below threshold. Rather than push, she **defers**:

```
seq 34 · harness_decision · topic_deferred
       facts: { topic: "Electromagnetism", reason: "learner_requested" }
       narrative: "Electromagnetism deferred (learner_requested). It can be
                   retried once this session with attempts reset."
```

**One deferred retry per session** (Decision 5) — a second deferral is
rejected `deferred_retry_used`. Later, rested, Tola taps
**retry deferred**: the topic re-queues with `attempts_used: 0`. Fresh
diagnostic: 4/5 = 0.8 → **understood**.

## 14. Step 9 — conclude

```
POST /sessions/:id/conclude
→ { session: { status: "completed" }, summary: { understood: 3, topics: 4 } }

seq 38 · harness_decision · session_concluded
       narrative: "Session complete — 3 topics understood."
```

What persists after the session ends: the session + topic rows (auditable),
the full event log (replayable), the exam-prep runs, the mastery evidence
(Waves' flagged gap is visible to Tola's teacher; Motion's 0.8 and
Electromagnetism's 0.8 feed the next session's `learner.get_state`), and the
wallet ledger (16 coins spent on practice across the session — 8 generated
practices × 2 coins, all post-confirmation, all refundable on failed
generation).

---

## 15. The complete replay log — "watching it work"

`GET /api/adaptive/study-prep/sessions/:id` returns the whole session view
including the events; the card's Activity drawer renders the narratives
(✓ harness decisions, 📊 engine results, 👤 human gates). The full log of
this session:

| seq | origin | event | node / tool | thought | the learner reads |
|---|---|---|---|---|---|
| 0 | harness | observation | session created | research | — (facts) |
| 1 | agent | tool_call | syllabus.resolve | research | "agent says: I need the approved topic list…" |
| 2 | harness | observation | 4 topics | research | — |
| 3 | agent | tool_call | learner.get_state | research | "…Tola's recorded mastery…" |
| 4 | harness | observation | 0.71 / 0.42 + misconception | research | — |
| 5 | agent | tool_call | learner.get_history | research | "…what happened before…" |
| 6 | harness | observation | Motion 0.4, teach_back_required | research | — |
| 7 | agent | tool_call | concept.get_prerequisites | research | "…does order matter…" |
| 8 | harness | observation | measurement → motion | research | — |
| 9 | agent | action | propose_plan | draft | "…prerequisites force Measurement first…" |
| 10 | harness | decision | plan_validated | verification | "Checked the plan against the syllabus… everything lines up." |
| 11 | harness | human_gate | plan_confirmed | synthesis | "You approved the plan (4 topics). Nothing was charged until now." |
| 12 | harness | decision | topic_started | verification | "Starting Measurement and Units. A short diagnostic comes first…" |
| 13 | harness | decision | practice_generated | verification | "Fresh practice generated for Measurement and Units (attempt 1). 2 coins charged." |
| 14 | engine | engine_result | scored 4/5 | reflection | "Scored 4 of 5 (80%). Above the pass mark — topic understood." |
| 15 | harness | decision | topic_started | verification | "Starting Motion. A short diagnostic comes first…" |
| 16–17 | harness/engine | … | Motion attempt 1 (0.4) | | "Scored 2 of 5 (40%). Below the 70% pass mark." |
| 18 | harness | human_gate | teach_back_confirmed | synthesis | "You confirmed the teach-back for Motion. A fresh retest is unlocked…" |
| 19–20 | harness/engine | … | retest (0.8) → understood | | "Scored 4 of 5 (80%). Above the pass mark — topic understood." |
| 21–28 | … | … | Waves: 0.6 → 0.6 → 0.55 | | … |
| 29 | engine | engine_result | capped_out | reflection | "Scored 3 of 5 (55%). Below the 70% pass mark." |
| 30 | harness | decision | topic_flagged | verification | "Waves flagged as a knowledge gap — repeated near-miss…" |
| 31–34 | … | … | Electromagnetism 0.5 → deferred | | "…deferred. It can be retried once this session…" |
| 35–37 | … | … | retry (attempts reset) 0.8 → understood | | … |
| 38 | harness | decision | session_concluded | verification | "Session complete — 3 topics understood." |

Every row: bounded facts, a `thought_type` stamped by the harness, an
`origin` from a closed enum, and — the only LLM-authored string anywhere in
the log — the one-sentence `agent_intent`, length-capped and
profanity-masked. No raw chat, no answer keys, no nested run rows: the
`shapeFacts` filter refuses `answer_key|answers|system|prompt|transcript`
keys outright.

---

## 16. Honest status — wired vs registered

| Piece | Status |
|---|---|
| Workspace, manifest, budgets, preflight, `contextVersion` | **live** (boot-gated) |
| Planning step with context selection (`planning` set) | **live** — the loop in §8 |
| Chat entry (`start_study_prep_session`, plan-only reads, doctrine) | **live** |
| Full harness op set (confirm/adjust/practice/submit/teach-back/advance/defer/retry/flag/conclude/pause/resume/cancel/replan dry-run) | **live** via REST, learner-driven |
| Deterministic engine (scoring, thresholds, mastery write-back, estimates) | **live** |
| Event log + replay + narration | **live** |
| `research` / `teaching` / `reflection` / `strategies` / `safety` sets | **registered + preflighted**; their LLM steps are the same three-line wiring as planning, not yet switched on |
| `offer_strategy` / `defer_topic` / `topic.flag` / `session.replan` as *agent* proposals | harness ops exist and are contract-tested; today the learner triggers them from the card (the model may read state and, in chat, point at them) |

The context-selection mechanism is proven on the planning step; extending it
is wiring, not architecture.

---

## 17. How to watch it work, live

1. **Boot** — the API logs the context preflight and version
   (`[context-layer] ok v… — 14 sets, manifest v1`). A missing workspace
   file prints `[context-layer] PREFLIGHT FAIL: …` and the process exits.
2. **Syllabus** — `node scripts/ingest-syllabus.mjs` (sample:
   `data/syllabus/wassce-physics.sample.json`). Without ingested rows the
   resolver returns an empty syllabus and every plan fails
   `topic_not_in_syllabus` — the documented safe failure.
3. **The prompts** — in the app chat: "I have WASSCE Physics in three
   weeks, help me prepare", then "how is my prep going?". Watch for the
   plan card and `[agent-chat] tool start_study_prep_session → ok` in the
   Render logs; failures now log `[agent-chat] tool <name> error: <cause>`.
4. **The loop, directly** — `GET /api/adaptive/study-prep/sessions/:id`
   returns topics + the full event log; the card's Activity drawer is the
   friendly view of the same rows.
5. **The pins** — every behaviour above is contract-tested:
   `study-prep/*.contract.test.mjs` (agent loop, harness, state machine,
   events, context layer, deliberate narration snapshot, workflow grouping),
   `tools/registry.contract.test.mjs`, `agent-context/*.test.mjs`
   (manifest, goldens), `migrations.contract.test.mjs` (the registration
   guard that keeps the schema actually running — the outage lesson).

## 18. Invariants (standing)

- One response envelope: `{ success: true, … }` or
  `{ success: false, code, error }` — stable machine-readable `code` on
  every 4xx; money-adjacent pauses are **402** `insufficient_balance`.
- Wallet charges happen **only** through the harness, **only after** the
  learner's plan-card confirmation (or explicit practice button), and are
  refunded if generation fails.
- The model can never change a POLICY number, score an answer, expose an
  answer key, or write state directly — those tools do not exist in its
  catalogue.
- Statuses and narration copy are hardcoded English server-side;
  `gateway_authorization` is never exposed.

---

## File map (source of truth per section)

| § | Files |
|---|---|
| 1–2 | `akoro-api/akoro-agent/**` (the workspace) |
| 3 | `akoro-api/modules/agent-context/manifest.mjs`, `context-manager.js`, `app.js` (preflight), `akoro-agent/channels/STUDY_PREP.md` |
| 4 | `study-prep/agent-loop.js`, `llm-agent.js`, `harness.js`, `state-machine.js`, `education-engine.js`, `read-tools.js`, `events.js`, `narration.js`, `store.js`, `syllabus-resolver.js`, `wiring.js`, `routes.js`, `chat-tool-handlers.js`, `tools/registry.js`, `exam-prep-service.js`, `adaptive-learning/chat.js` |
| 5 | `data/syllabus/wassce-physics.sample.json`, `scripts/ingest-syllabus.mjs`, `migrations/2026-study-prep-sessions-v1.sql` |
| 6 | `chat.js` (study-prep tools + handler), `channels/STUDY_PREP.md`, `agent-chat-intent.js` (the forcing rules) |
| 8 | `wiring.js` (`runStudyPrepPlanningStep`), `agent-loop.js`, `llm-agent.js`, `state-machine.js` (`validatePlan`), `education-engine.js` (`estimateSessionCost`) |
| 9–14 | `harness.js` (every op), `exam-prep-service.js`, `education-engine.js` |
| 15 | `events.js` (`publicEvent`), `routes.js` (`shapeView`), `StudyPrepChatCard.jsx` |
| 16–17 | `wiring.js`, the `*.contract.test.mjs` files listed in §17.5 |

*v3 — compiled from the code at `34da58e` (study-prep outage fix `f872c3d`
included). When the loop grows a wired teaching/reflection step, or
`content.search` is enabled, update §16 and the corresponding iteration
narratives here.*
